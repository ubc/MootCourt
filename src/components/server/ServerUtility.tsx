import { useMootCourtStore } from "../MootCourtState";
import { REALTIME_SAMPLE_RATE, wavToFloat32 } from "./audio";

type Status = { connected: boolean; error: string; speaking: boolean };
type TranscriptListener = (text: string, duration: number | null) => void;

export function getRealtimeUrl(
    configuredUrl = process.env.REACT_APP_REALTIME_URL,
    location: Pick<Location, "protocol" | "host"> = window.location,
): string {
    if (configuredUrl) return configuredUrl;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/realtime`;
}

// One owner for socket events and queued playback. The local service holds the API key.
export class ServerUtility {
    static socket: WebSocket | null = null;
    static Blobs: Blob[] = [];
    static isAudioPlaying = false;
    static accumulatedUserSpeech = "";
    static talkStartTime: number | null = null;
    static talkEndTime: number | null = null;
    static talkDuration: number | null = null;
    static wordCount = 0;
    private static ready = false;
    private static hadSession = false;
    private static awaitingResponse = false;
    private static paused = false;
    private static lastError = "";
    private static audioContext: AudioContext | null = null;
    private static sources = new Set<AudioBufferSourceNode>();
    private static nextStartTime = 0;
    private static draining = false;
    private static submittedDuration: number | null = null;
    private static transcriptReceived = false;
    private static statusListeners = new Set<(status: Status) => void>();
    private static transcriptListeners = new Set<TranscriptListener>();

    static getMimeType() {
        return /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ? "" : "audio/webm";
    }

    static getStatus(): Status {
        return { connected: this.isWebSocketConnected(), error: this.lastError, speaking: this.isAudioPlaying && !this.paused };
    }

    static subscribeStatus(listener: (status: Status) => void) {
        this.statusListeners.add(listener);
        listener(this.getStatus());
        return () => { this.statusListeners.delete(listener); };
    }

    static subscribeTranscript(listener: TranscriptListener) {
        this.transcriptListeners.add(listener);
        return () => { this.transcriptListeners.delete(listener); };
    }

    private static notify() {
        this.statusListeners.forEach(listener => listener(this.getStatus()));
    }

    static reportError(message: string) {
        this.lastError = message;
        this.notify();
    }

    static initializeWebSocket(): WebSocket {
        if (this.socket && (this.socket.readyState <= WebSocket.OPEN || this.hadSession)) return this.socket;
        this.ready = false;
        this.lastError = "";
        const socket = new WebSocket(getRealtimeUrl());
        this.socket = socket;
        socket.onmessage = event => {
            if (this.socket !== socket) return;
            if (event.data instanceof Blob) {
                if (!this.ready || !this.awaitingResponse) return;
                this.Blobs.push(event.data);
                this.scheduleQueuedAudio();
                return;
            }
            try {
                const message = JSON.parse(event.data);
                switch (message.type) {
                    case "ready":
                        this.ready = true;
                        this.hadSession = true;
                        this.lastError = "";
                        useMootCourtStore.getState().setInputLock(false);
                        this.notify();
                        break;
                    case "transcript":
                        if (this.transcriptReceived) break;
                        this.transcriptReceived = true;
                        this.accumulatedUserSpeech = message.text;
                        this.wordCount += this.countWords(message.text);
                        useMootCourtStore.getState().setSubtitles(message.text);
                        this.transcriptListeners.forEach(listener => listener(message.text, this.submittedDuration));
                        break;
                    case "caption":
                        useMootCourtStore.getState().setSubtitles(message.text);
                        break;
                    case "response.done":
                        this.awaitingResponse = false;
                        this.unlockIfFinished();
                        break;
                    case "error":
                        this.fail(message.message);
                        break;
                    default:
                        break;
                }
            } catch {
                this.fail("The local service sent an invalid response. Restart npm run dev.");
            }
        };
        socket.onerror = () => {
            if (this.socket === socket) this.fail("Cannot connect to the local service. Run npm run dev, then start a new session.");
        };
        socket.onclose = () => {
            if (this.socket !== socket) return;
            this.ready = false;
            this.awaitingResponse = false;
            this.stopPlayback();
            if (!this.lastError) this.lastError = "Disconnected. Start a new practice session; earlier context is not restored.";
            useMootCourtStore.getState().setInputLock(false);
            this.notify();
        };
        this.notify();
        return socket;
    }

    static isWebSocketConnected(): boolean {
        return this.ready && this.socket?.readyState === WebSocket.OPEN;
    }

    static async waitForConnection(timeoutMs = 15000): Promise<boolean> {
        this.initializeWebSocket();
        if (this.isWebSocketConnected()) return true;
        if (this.lastError) return false;
        return new Promise(resolve => {
            const finish = (connected: boolean) => {
                clearTimeout(timer);
                this.statusListeners.delete(listener);
                resolve(connected);
            };
            const listener = (status: Status) => {
                if (status.connected || status.error) finish(status.connected);
            };
            const timer = setTimeout(() => finish(false), timeoutMs);
            this.statusListeners.add(listener);
        });
    }

    static sendRecordingToServer(pcm: Uint8Array, duration: number | null) {
        if (!this.isWebSocketConnected() || !this.socket) throw new Error("The local OpenAI session is not connected.");
        if (this.awaitingResponse || this.sources.size || this.Blobs.length) throw new Error("Wait for the judge to finish replying.");
        if (pcm.length < 4800) throw new Error("Please hold Enter for at least a moment before releasing it.");
        if (pcm.length > 24000 * 2 * 600) throw new Error("Please keep each recording under 10 minutes.");
        this.lastError = "";
        this.submittedDuration = duration;
        this.transcriptReceived = false;
        this.accumulatedUserSpeech = "";
        this.awaitingResponse = true;
        useMootCourtStore.getState().setInputLock(true);
        this.socket.send(pcm);
        this.notify();
    }

    static startTalking() {
        this.talkStartTime = Date.now();
    }

    static stopTalking(valid: boolean) {
        if (!valid || this.talkStartTime === null) return;
        this.talkEndTime = Date.now();
        this.talkDuration = this.talkEndTime - this.talkStartTime;
    }

    static setAudioPaused(paused: boolean) {
        this.paused = paused;
        // Suspending freezes the context clock, so everything already scheduled
        // resumes exactly where it stopped instead of being restarted.
        if (paused) this.audioContext?.suspend().catch(() => {});
        else { this.resumeContext(); this.scheduleQueuedAudio(); }
        this.notify();
    }

    private static getAudioContext(): AudioContext | null {
        if (this.audioContext) return this.audioContext;
        const Constructor: typeof AudioContext | undefined = window.AudioContext || (window as any).webkitAudioContext;
        if (!Constructor) {
            this.fail("This browser cannot play the judge's audio. Use a current version of Chrome, Edge, Firefox, or Safari.");
            return null;
        }
        // Matching the stream's own rate stops the browser resampling each chunk in
        // isolation, which would put the boundary artifacts back.
        this.audioContext = new Constructor({ sampleRate: REALTIME_SAMPLE_RATE });
        this.nextStartTime = 0;
        return this.audioContext;
    }

    private static resumeContext() {
        const context = this.audioContext;
        if (this.paused || context?.state !== "suspended") return;
        context.resume().catch(() => {
            if (this.audioContext === context) this.fail("Audio playback failed. Check browser audio permissions and start a new session.");
        });
    }

    // Decode one chunk at a time so the samples stay in arrival order.
    private static async scheduleQueuedAudio() {
        if (this.draining || this.paused || !this.Blobs.length) return;
        this.draining = true;
        try {
            while (!this.paused && this.Blobs.length) {
                const blob = this.Blobs[0];
                const wav = new Uint8Array(await blob.arrayBuffer());
                // An error or disconnect replaces the queue while we were decoding.
                if (this.Blobs[0] !== blob) return;
                this.Blobs.shift();
                this.scheduleChunk(wav);
            }
        } catch {
            this.fail("Could not play the judge's audio. Start a new session.");
        } finally {
            this.draining = false;
        }
    }

    // Chunks are consecutive slices of one PCM stream, so butting them together on a
    // single clock reproduces the original waveform. Playing each as its own clip left
    // a gap and a step at every boundary, and that is what clicked.
    private static scheduleChunk(wav: Uint8Array) {
        const samples = wavToFloat32(wav);
        const context = samples.length ? this.getAudioContext() : null;
        if (!context) return;
        const buffer = context.createBuffer(1, samples.length, REALTIME_SAMPLE_RATE);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => {
            if (!this.sources.delete(source)) return;
            source.disconnect();
            this.isAudioPlaying = this.sources.size > 0;
            this.unlockIfFinished();
        };
        // A short lead absorbs network jitter on the first chunk and after an underrun.
        const startAt = Math.max(this.nextStartTime, context.currentTime + 0.08);
        this.nextStartTime = startAt + buffer.duration;
        this.sources.add(source);
        this.isAudioPlaying = true;
        source.start(startAt);
        this.resumeContext();
        this.notify();
    }

    private static stopPlayback() {
        this.sources.forEach(source => {
            source.onended = null;
            try { source.stop(); } catch { /* already ended */ }
            source.disconnect();
        });
        this.sources.clear();
        this.nextStartTime = 0;
        this.isAudioPlaying = false;
        this.Blobs = [];
    }

    private static unlockIfFinished() {
        // A temporary gap between chunks does not mean the judge has finished.
        if (!this.awaitingResponse && !this.sources.size && !this.Blobs.length) {
            useMootCourtStore.getState().setInputLock(false);
        }
        this.notify();
    }

    private static fail(message: string) {
        this.ready = false;
        this.awaitingResponse = false;
        this.stopPlayback();
        useMootCourtStore.getState().setInputLock(false);
        this.reportError(message);
        this.socket?.close();
    }

    static disconnect() {
        const socket = this.socket;
        this.socket = null;
        socket?.close();
        this.ready = false;
        this.hadSession = false;
        this.awaitingResponse = false;
        this.paused = false;
        this.lastError = "";
        this.accumulatedUserSpeech = "";
        this.talkStartTime = null;
        this.talkEndTime = null;
        this.talkDuration = null;
        this.wordCount = 0;
        this.stopPlayback();
        this.audioContext?.close().catch(() => {});
        this.audioContext = null;
        useMootCourtStore.getState().setInputLock(false);
        this.notify();
    }

    static countWords(text: string): number {
        return text ? text.split(/\s+/).filter(Boolean).length : 0;
    }
}
