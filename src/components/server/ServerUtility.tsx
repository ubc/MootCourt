import { useMootCourtStore } from "../MootCourtState";

type Status = { connected: boolean; error: string; speaking: boolean };
type TranscriptListener = (text: string, duration: number | null) => void;

// One owner for socket events and queued playback. The local service holds the API key.
export class ServerUtility {
    static socket: WebSocket | null = null;
    static Blobs: Blob[] = [];
    static audioPlayer: HTMLAudioElement | null = null;
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
    private static audioUrl: string | null = null;
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
        const socket = new WebSocket(process.env.REACT_APP_REALTIME_URL || "ws://127.0.0.1:43128/realtime");
        this.socket = socket;
        socket.onmessage = event => {
            if (this.socket !== socket) return;
            if (event.data instanceof Blob) {
                if (!this.ready || !this.awaitingResponse) return;
                this.Blobs.push(event.data);
                this.playNextBlob();
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
        if (this.awaitingResponse || this.audioPlayer || this.Blobs.length) throw new Error("Wait for the judge to finish replying.");
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
        if (paused) this.audioPlayer?.pause();
        else if (this.audioPlayer) this.resumePlayer();
        else this.playNextBlob();
        this.notify();
    }

    private static resumePlayer() {
        const player = this.audioPlayer;
        player?.play().catch(() => {
            if (this.audioPlayer === player) this.fail("Audio playback failed. Check browser audio permissions and start a new session.");
        });
    }

    private static playNextBlob() {
        if (this.audioPlayer || this.paused || !this.Blobs.length) return;
        this.audioUrl = URL.createObjectURL(this.Blobs.shift()!);
        const player = new Audio(this.audioUrl);
        this.audioPlayer = player;
        this.isAudioPlaying = true;
        player.onended = () => {
            if (this.audioPlayer !== player) return;
            this.releasePlayer();
            this.playNextBlob();
            this.unlockIfFinished();
        };
        player.onerror = () => this.fail("Could not play the judge's audio. Start a new session.");
        this.notify();
        this.resumePlayer();
    }

    private static releasePlayer() {
        if (this.audioPlayer) {
            this.audioPlayer.onended = null;
            this.audioPlayer.onerror = null;
            this.audioPlayer.pause();
            this.audioPlayer.removeAttribute("src");
        }
        if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;
        this.audioPlayer = null;
        this.isAudioPlaying = false;
    }

    private static stopPlayback() {
        this.releasePlayer();
        this.Blobs = [];
    }

    private static unlockIfFinished() {
        // A temporary gap between chunks does not mean the judge has finished.
        if (!this.awaitingResponse && !this.audioPlayer && !this.Blobs.length) {
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
        useMootCourtStore.getState().setInputLock(false);
        this.notify();
    }

    static countWords(text: string): number {
        return text ? text.split(/\s+/).filter(Boolean).length : 0;
    }
}
