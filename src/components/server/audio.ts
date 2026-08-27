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
