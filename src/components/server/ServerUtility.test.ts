import { getRealtimeUrl, ServerUtility } from './ServerUtility';
import { floatToPcm16, wavToFloat32 } from './audio';
import { useMootCourtStore } from '../MootCourtState';

class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    onmessage: ((event: { data: any }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send = jest.fn();
    close = jest.fn(() => { this.readyState = 3; this.onclose?.(); });
    constructor(public url: string) {}
    receive(data: any) { this.onmessage?.({ data: data instanceof Blob ? data : JSON.stringify(data) }); }
}

class FakeBufferSource {
    buffer: any = null;
    startedAt = -1;
    onended: (() => void) | null = null;
    connect = jest.fn();
    disconnect = jest.fn();
    stop = jest.fn();
    start = jest.fn((when: number) => { this.startedAt = when; });
}

class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    state = 'suspended';
    currentTime = 0;
    destination = {};
    sources: FakeBufferSource[] = [];
    resume = jest.fn(async () => { this.state = 'running'; });
    suspend = jest.fn(async () => { this.state = 'suspended'; });
    close = jest.fn(async () => { this.state = 'closed'; });
    constructor(public options: { sampleRate: number }) { FakeAudioContext.instances.push(this); }
    createBuffer(channels: number, length: number, sampleRate: number) {
        return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, copyToChannel: jest.fn() };
    }
    createBufferSource() { const source = new FakeBufferSource(); this.sources.push(source); return source; }
}

// jsdom does not decode Blobs, so keep the bytes we handed each one.
const blobBytes = new WeakMap<Blob, Uint8Array>();
function wavBlob(sampleCount: number): Blob {
    const bytes = new Uint8Array(44 + sampleCount * 2);
    const view = new DataView(bytes.buffer);
    const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
    write(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); write(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, sampleCount * 2, true);
    for (let i = 0; i < sampleCount; i++) view.setInt16(44 + i * 2, 1000 + i, true);
    const blob = new Blob([bytes]);
    blobBytes.set(blob, bytes);
    return blob;
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const context = () => FakeAudioContext.instances[FakeAudioContext.instances.length - 1];

const originalSocket = window.WebSocket;
const originalAudioContext = window.AudioContext;
const originalArrayBuffer = Blob.prototype.arrayBuffer;
let socket: FakeSocket;
beforeEach(() => {
    Object.assign(window, { WebSocket: FakeSocket, AudioContext: FakeAudioContext });
    Blob.prototype.arrayBuffer = function () { return Promise.resolve(blobBytes.get(this)!.buffer); };
    FakeAudioContext.instances.length = 0;
    socket = ServerUtility.initializeWebSocket() as unknown as FakeSocket;
});
afterEach(() => {
    ServerUtility.disconnect();
    window.WebSocket = originalSocket;
    window.AudioContext = originalAudioContext;
    Blob.prototype.arrayBuffer = originalArrayBuffer;
});

test('connects to the same origin and only becomes ready after upstream configuration', () => {
    expect(socket.url).toBe('ws://localhost/realtime');
    expect(ServerUtility.isWebSocketConnected()).toBe(false);
    socket.receive({ type: 'ready' });
    expect(ServerUtility.isWebSocketConnected()).toBe(true);
});

test('uses a secure same-origin WebSocket on HTTPS', () => {
    expect(getRealtimeUrl(undefined, { protocol: 'https:', host: 'mootcourt.example.ubc.ca' }))
        .toBe('wss://mootcourt.example.ubc.ca/realtime');
});

test('allows an explicitly configured realtime URL to override the same-origin default', () => {
    expect(getRealtimeUrl('ws://127.0.0.1:43128/realtime', { protocol: 'https:', host: 'mootcourt.example.ubc.ca' }))
        .toBe('ws://127.0.0.1:43128/realtime');
});

test('converts/clamps microphone samples to signed little-endian PCM16', () => {
    const pcm = floatToPcm16(new Float32Array([-2, -1, 0, 1, 2]));
    const data = new DataView(pcm.buffer);
    expect(Array.from({ length: 5 }, (_, i) => data.getInt16(i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
});

test('reads reply samples back out of the WAV container the relay sends', () => {
    const wav = new Uint8Array(blobBytes.get(wavBlob(3))!);
    expect(Array.from(wavToFloat32(wav))).toEqual([1000 / 32768, 1001 / 32768, 1002 / 32768]);
    expect(wavToFloat32(new Uint8Array(12))).toHaveLength(0);
});

test('one audio submission produces one assessment transcript with the existing duration value', () => {
    socket.receive({ type: 'ready' });
    const listener = jest.fn();
    const unsubscribe = ServerUtility.subscribeTranscript(listener);
    const pcm = new Uint8Array(4800);
    ServerUtility.sendRecordingToServer(pcm, 1234);
    socket.receive({ type: 'transcript', text: 'My argument' });
    socket.receive({ type: 'transcript', text: 'duplicate' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('My argument', 1234);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(pcm);
    expect(useMootCourtStore.getState().subtitles).toBe('My argument');
    unsubscribe();
});

test('consecutive chunks are scheduled end to end on one clock so boundaries do not click', async () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    socket.receive(wavBlob(12000));
    await flush();
    socket.receive(wavBlob(6000));
    await flush();
    const [first, second] = context().sources;
    expect(context().options.sampleRate).toBe(24000);
    expect(first.startedAt).toBeGreaterThan(0);
    expect(second.startedAt).toBeCloseTo(first.startedAt + first.buffer.duration, 9);
    expect(context().resume).toHaveBeenCalled();
});

test('input remains locked between chunks and until the final audio finishes', async () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    socket.receive(wavBlob(1200));
    await flush();
    context().sources[0].onended!();
    expect(useMootCourtStore.getState().isInputLocked).toBe(true);
    socket.receive(wavBlob(1200));
    await flush();
    socket.receive({ type: 'response.done' });
    expect(useMootCourtStore.getState().isInputLocked).toBe(true);
    context().sources[1].onended!();
    expect(useMootCourtStore.getState().isInputLocked).toBe(false);
    expect(ServerUtility.getStatus().speaking).toBe(false);
});

test('pause retains queued audio; resume starts it without generating another reply', async () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    ServerUtility.setAudioPaused(true);
    socket.receive(wavBlob(1200));
    await flush();
    socket.receive({ type: 'response.done' });
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(useMootCourtStore.getState().isInputLocked).toBe(true);
    ServerUtility.setAudioPaused(false);
    await flush();
    expect(context().sources).toHaveLength(1);
    expect(context().sources[0].start).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledTimes(1);
});

test('errors release input and surface setup instructions; a new scene resets the session', async () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    socket.receive({ type: 'error', message: 'Check .env.server.local' });
    expect(useMootCourtStore.getState().isInputLocked).toBe(false);
    expect(ServerUtility.getStatus().error).toBe('Check .env.server.local');
    socket.receive(wavBlob(1200));
    await flush();
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(ServerUtility.initializeWebSocket()).toBe(socket);
    ServerUtility.disconnect();
    expect(ServerUtility.initializeWebSocket()).not.toBe(socket);
});

test('pausing mid-reply suspends the same scheduled audio instead of restarting it', async () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    socket.receive(wavBlob(12000));
    await flush();
    ServerUtility.setAudioPaused(true);
    expect(context().suspend).toHaveBeenCalled();
    expect(ServerUtility.getStatus().speaking).toBe(false);
    ServerUtility.setAudioPaused(false);
    await flush();
    expect(context().sources).toHaveLength(1);
    expect(context().sources[0].start).toHaveBeenCalledTimes(1);
    expect(ServerUtility.getStatus().speaking).toBe(true);
});
