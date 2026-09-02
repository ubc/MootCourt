import { createHash } from 'node:crypto';
import { embedBatch, describeImage } from './openai.mjs';

/**
 * Chooses between the real OpenAI calls and a local stand-in.
 *
 * The stub exists for the same reason BiocBot's embeddingsStub.js does: the
 * ingest → store → retrieve loop has to be developable and testable without
 * spending on a provider, and without a network at all. It is opt-in via
 * MATERIALS_STUB=1 and never engages by accident — a missing API key is an
 * error, not a silent downgrade to fake vectors that would index a real
 * student's thesis into a collection that retrieves nonsense.
 */

/**
 * Deterministic hashed bag-of-words. Not semantic, but genuinely lexical: two
 * chunks sharing vocabulary score higher than two that do not, which is enough
 * to prove the retrieval path end to end.
 */
function stubVector(text, dimensions) {
  const vector = new Array(dimensions).fill(0);
  for (const token of String(text).toLowerCase().match(/[a-z0-9']+/g) || []) {
    const digest = createHash('sha1').update(token).digest();
    vector[digest.readUInt32BE(0) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  // An empty or punctuation-only chunk has no direction; Qdrant rejects an
  // all-zero vector under cosine distance, so give it one fixed axis.
  if (!norm) { vector[0] = 1; return vector; }
  return vector.map(value => value / norm);
}

export function createProviders(ragConfig) {
  if (ragConfig.stub) {
    console.warn('MATERIALS_STUB is on — uploads are indexed with fake vectors and images are not read.');
    return {
      stub: true,
      embedBatch: async inputs => inputs.map(input => stubVector(input, ragConfig.vectorSize)),
      embedOne: async input => stubVector(input, ragConfig.vectorSize),
      describeImage: async (buffer, mimeType) => `[Image omitted: ${mimeType}, ${buffer.length} bytes — stub mode]`,
    };
  }

  const options = { apiKey: ragConfig.apiKey, model: ragConfig.embeddingModel };
  return {
    stub: false,
    embedBatch: inputs => embedBatch(inputs, options),
    embedOne: async input => (await embedBatch([input], options))[0],
    describeImage: (buffer, mimeType) => describeImage(buffer, mimeType, {
      apiKey: ragConfig.apiKey,
      model: ragConfig.visionModel,
      reasoningEffort: ragConfig.visionReasoningEffort,
    }),
  };
}
