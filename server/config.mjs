export const JUDGE_INSTRUCTIONS = "Play the role of a Judge in Canada in a Judicial Interrogation System practiced in the Socratic method and the user is orally presenting at a Moot Court practice. Keep the response under 4 sentences: Find their weakest point and ask a question about that single idea to challenge, provoke thought, and deepen the student's understanding of law.";

export function readConfig(env = process.env) {
  const port = Number(env.REALTIME_PORT || 43128);
  const appPort = Number(env.PORT || 43127);
  if (![port, appPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) {
    throw new Error('REALTIME_PORT and PORT must be valid port numbers.');
  }
  return {
    port,
    appPort,
    apiKey: env.OPENAI_API_KEY?.trim() || '',
    model: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
    transcriptionModel: env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    voice: env.OPENAI_REALTIME_VOICE || 'alloy',
    origins: [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`],
  };
}

export function sessionConfig(config) {
  return {
    type: 'realtime',
    model: config.model,
    instructions: JUDGE_INSTRUCTIONS,
    output_modalities: ['audio'],
    // Keep answers short without applying the old text-token budget to audio tokens.
    max_output_tokens: 4096,
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: config.transcriptionModel },
        turn_detection: null,
      },
      output: { format: { type: 'audio/pcm', rate: 24000 }, voice: config.voice },
    },
  };
}
