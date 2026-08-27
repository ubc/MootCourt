import { ServerUtility } from './ServerUtility';
import { floatToPcm16 } from './audio';
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

const players: any[] = [];
const originalSocket = window.WebSocket;
const originalAudio = window.Audio;
let socket: FakeSocket;
beforeEach(() => {
    Object.assign(window, { WebSocket: FakeSocket });
    window.Audio = jest.fn().mockImplementation(() => {
        const player = { play: jest.fn().mockResolvedValue(undefined), pause: jest.fn(), removeAttribute: jest.fn(), onended: null, onerror: null };
        players.push(player);
        return player;
    });
    URL.createObjectURL = jest.fn(() => 'blob:audio');
    URL.revokeObjectURL = jest.fn();
    players.length = 0;
    socket = ServerUtility.initializeWebSocket() as unknown as FakeSocket;
});
afterEach(() => {
    ServerUtility.disconnect();
    window.WebSocket = originalSocket;
    window.Audio = originalAudio;
});

test('connects locally and only becomes ready after upstream configuration', () => {
    expect(socket.url).toBe('ws://127.0.0.1:8787/realtime');
    expect(ServerUtility.isWebSocketConnected()).toBe(false);
    socket.receive({ type: 'ready' });
    expect(ServerUtility.isWebSocketConnected()).toBe(true);
});

test('converts/clamps microphone samples to signed little-endian PCM16', () => {
    const pcm = floatToPcm16(new Float32Array([-2, -1, 0, 1, 2]));
    const data = new DataView(pcm.buffer);
    expect(Array.from({ length: 5 }, (_, i) => data.getInt16(i * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
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

test('input remains locked between chunks and until the final audio finishes', () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    socket.receive(new Blob(['first']));
    players[0].onended();
    expect(useMootCourtStore.getState().isInputLocked).toBe(true);
    socket.receive(new Blob(['second']));
    socket.receive({ type: 'response.done' });
    expect(useMootCourtStore.getState().isInputLocked).toBe(true);
    players[1].onended();
    expect(useMootCourtStore.getState().isInputLocked).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

test('pause retains queued audio; resume starts it without generating another reply', () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    ServerUtility.setAudioPaused(true);
    socket.receive(new Blob(['audio']));
    socket.receive({ type: 'response.done' });
    expect(players).toHaveLength(0);
    expect(useMootCourtStore.getState().isInputLocked).toBe(true);
    ServerUtility.setAudioPaused(false);
    expect(players).toHaveLength(1);
    expect(players[0].play).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledTimes(1);
});

test('errors release input and surface setup instructions; a new scene resets the session', () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    socket.receive({ type: 'error', message: 'Check .env.server.local' });
    expect(useMootCourtStore.getState().isInputLocked).toBe(false);
    expect(ServerUtility.getStatus().error).toBe('Check .env.server.local');
    socket.receive(new Blob(['late audio']));
    expect(players).toHaveLength(0);
    expect(ServerUtility.initializeWebSocket()).toBe(socket);
    ServerUtility.disconnect();
    expect(ServerUtility.initializeWebSocket()).not.toBe(socket);
});

test('pausing an active chunk resumes that same audio element', () => {
    socket.receive({ type: 'ready' });
    ServerUtility.sendRecordingToServer(new Uint8Array(4800), 100);
    socket.receive(new Blob(['audio']));
    const player = players[0];
    ServerUtility.setAudioPaused(true);
    expect(player.pause).toHaveBeenCalled();
    expect(ServerUtility.getStatus().speaking).toBe(false);
    ServerUtility.setAudioPaused(false);
    expect(players).toHaveLength(1);
    expect(player.play).toHaveBeenCalledTimes(2);
});
