export const REALTIME_SAMPLE_RATE = 24000;

export function floatToPcm16(samples: Float32Array): Uint8Array {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    return bytes;
}

export async function audioBufferToPcm16(buffer: AudioBuffer): Promise<Uint8Array> {
    const context = new OfflineAudioContext(1, Math.ceil(buffer.duration * REALTIME_SAMPLE_RATE), REALTIME_SAMPLE_RATE);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    const mono = await context.startRendering();
    return floatToPcm16(mono.getChannelData(0));
}

// The relay streams a reply as consecutive WAV chunks cut from one PCM stream.
// Reading their samples out directly lets them be re-joined on a single clock;
// decoding each chunk as an independent clip is what clicks at every boundary.
export function wavToFloat32(wav: Uint8Array): Float32Array {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const chunkId = (at: number) => String.fromCharCode(wav[at], wav[at + 1], wav[at + 2], wav[at + 3]);
    for (let offset = 12; offset + 8 <= wav.length;) {
        const size = view.getUint32(offset + 4, true);
        if (chunkId(offset) !== "data") { offset += 8 + size + (size % 2); continue; }
        const count = Math.min(size, wav.length - offset - 8) >> 1;
        const samples = new Float32Array(count);
        for (let i = 0; i < count; i++) samples[i] = view.getInt16(offset + 8 + i * 2, true) / 32768;
        return samples;
    }
    return new Float32Array(0);
}
