import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import AudioComponent from './AudioComponent';
import { ServerUtility } from '../server/ServerUtility';
import { useMootCourtStore } from '../MootCourtState';

jest.mock('@react-three/drei', () => ({ Html: ({ children }) => <>{children}</> }));
jest.mock('../server/audio', () => ({ audioBufferToPcm16: async () => new Uint8Array(4800) }));
let mockTranscriptListener: (text: string, duration: number) => void;
jest.mock('../server/ServerUtility', () => ({ ServerUtility: {
    getStatus: () => ({ connected: true, error: '', speaking: false }),
    subscribeStatus: () => () => {},
    subscribeTranscript: listener => { mockTranscriptListener = listener; return () => {}; },
    waitForConnection: jest.fn(async () => true),
    getMimeType: () => 'audio/webm',
    startTalking: jest.fn(), stopTalking: jest.fn(), talkDuration: 1234,
    sendRecordingToServer: jest.fn(), reportError: jest.fn(),
} }));

const recorders: FakeRecorder[] = [];
class FakeRecorder {
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: any;
    onstop: any;
    onerror: any;
    constructor(public stream: MediaStream) { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['recording']) });
        this.onstop?.();
    }
}
const stopTrack = jest.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const getUserMedia = jest.fn();
const closeContext = jest.fn(async () => {});
const originalRecorder = window.MediaRecorder;
const originalContext = window.AudioContext;
const originalMediaDevices = navigator.mediaDevices;
const originalArrayBuffer = Blob.prototype.arrayBuffer;
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ServerUtility.waitForConnection).mockResolvedValue(true);
    recorders.length = 0;
    useMootCourtStore.getState().setInputLock(false);
    getUserMedia.mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.assign(window, { MediaRecorder: FakeRecorder, AudioContext: jest.fn(() => ({
        decodeAudioData: async () => ({ getChannelData: () => new Float32Array([0.5, 0.5]) }),
        close: closeContext,
    })) });
    Blob.prototype.arrayBuffer = jest.fn(async () => new ArrayBuffer(8));
});
afterEach(() => {
    Object.assign(window, { MediaRecorder: originalRecorder, AudioContext: originalContext });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
    Blob.prototype.arrayBuffer = originalArrayBuffer;
});

function mount(config: any = {}, onTranscriptChange = jest.fn()) {
    return render(<AudioComponent config={config} appPaused={false} onTranscriptChange={onTranscriptChange} elapsedTime={0} />);
}

test('hold Enter records, key repeat is ignored, release submits exactly one turn', async () => {
    mount();
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(recorders[0]?.state).toBe('recording'));
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(recorders).toHaveLength(1);
    expect(ServerUtility.sendRecordingToServer).not.toHaveBeenCalled();
    fireEvent.keyUp(window, { key: 'Enter' });
    await waitFor(() => expect(ServerUtility.sendRecordingToServer).toHaveBeenCalledTimes(1));
    expect(ServerUtility.sendRecordingToServer).toHaveBeenCalledWith(new Uint8Array(4800), 1234);
    expect(stopTrack).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
});

test('release while microphone permission is pending does not leave a recording running', async () => {
    let grant: (stream: MediaStream) => void = () => {};
    getUserMedia.mockReturnValue(new Promise(resolve => { grant = resolve; }));
    mount();
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    fireEvent.keyUp(window, { key: 'Enter' });
    await act(async () => { grant(stream); });
    expect(recorders).toHaveLength(0);
    expect(stopTrack).toHaveBeenCalled();
    expect(ServerUtility.sendRecordingToServer).not.toHaveBeenCalled();
});

test('assessment still receives transcript/duration pairs and existing conversation objects', () => {
    const config: any = {};
    const onTranscriptChange = jest.fn();
    mount(config, onTranscriptChange);
    act(() => mockTranscriptListener('My submission', 1234));
    expect(config.runningTimestamps).toEqual([['My submission', 1234]]);
    expect(config.conversation).toEqual([{ role: 'user', content: 'My submission' }]);
    expect(onTranscriptChange).toHaveBeenCalledWith('My submission');
});

test('leaving the scene stops the microphone without sending unfinished audio', async () => {
    const view = mount();
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(recorders[0]?.state).toBe('recording'));
    view.unmount();
    expect(recorders[0].state).toBe('inactive');
    expect(stopTrack).toHaveBeenCalled();
    expect(ServerUtility.sendRecordingToServer).not.toHaveBeenCalled();
});

test('input stays disabled while the judge is replying', () => {
    useMootCourtStore.getState().setInputLock(true);
    mount();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyUp(window, { key: 'Enter' });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(ServerUtility.sendRecordingToServer).not.toHaveBeenCalled();
});
