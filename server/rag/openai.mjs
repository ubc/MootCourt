/**
 * The two OpenAI calls the materials pipeline needs: embeddings for retrieval,
 * and a vision model that turns an image inside an uploaded document into text.
 *
 * Deliberately raw `fetch` rather than the `openai` SDK. The realtime relay
 * already speaks the wire protocol directly (see relay.mjs), the installed SDK
 * predates the Responses API these models need, and two endpoints do not
 * justify pinning a dependency that would have to move in lockstep with model
 * releases.
 */

const API_BASE = 'https://api.openai.com/v1';

/** Vectors are useless without the text they came from, so both fail together. */
class OpenAIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OpenAIError';
    this.status = status;
  }
}

async function postJSON(path, body, apiKey, { timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new OpenAIError(
      error.name === 'AbortError'
        ? `OpenAI request to ${path} timed out after ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach OpenAI (${path}).`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The body can echo the request — including document text — so only the
    // status and OpenAI's own short message are surfaced.
    let detail = '';
    try {
      detail = (await response.json())?.error?.message || '';
    } catch { /* non-JSON error body */ }
    throw new OpenAIError(`OpenAI ${path} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`, response.status);
  }
  return response.json();
}

/**
 * Embeds a batch of strings in one request, in order.
 *
 * The API returns results with an `index` rather than in submission order, so
 * the batch is reordered here; a silent mismatch would attach every chunk's
 * text to the wrong vector and produce retrieval that looks plausible and is
 * wrong.
 *
 * @returns {Promise<number[][]>} One vector per input, parallel to `inputs`.
 */
export async function embedBatch(inputs, { apiKey, model }) {
  if (!inputs.length) return [];
  const data = await postJSON('/embeddings', { model, input: inputs }, apiKey);
  const vectors = new Array(inputs.length);
  for (const item of data.data || []) vectors[item.index] = item.embedding;
  if (vectors.some(vector => !Array.isArray(vector))) {
    throw new OpenAIError('OpenAI returned fewer embeddings than inputs.');
  }
  return vectors;
}

export async function embedOne(input, options) {
  const [vector] = await embedBatch([input], options);
  return vector;
}

const IMAGE_PROMPT = [
  'You are extracting the content of an image embedded in a legal document so it',
  'can be searched as text. Describe what the image actually contains: transcribe',
  'every word of visible text verbatim, read out the values and relationships in',
  'any chart, table, or diagram, and state what a figure or photograph depicts.',
  'Do not interpret, evaluate, or add legal commentary. If the image is purely',
  'decorative — a logo, seal, border, or divider — reply with exactly: SKIP',
].join(' ');

/**
 * Describes one embedded image. Wired into the document parser as its
 * `imageDescriber`, which inlines the returned text at the point in the
 * document where the image sat.
 *
 * @returns {Promise<string|null>} null for a decorative image or an empty reply,
 *   which the parser treats as "omit this image" rather than as a failure.
 */
export async function describeImage(imageBuffer, mimeType, { apiKey, model, reasoningEffort = 'medium' }) {
  const data = await postJSON('/responses', {
    model,
    reasoning: { effort: reasoningEffort },
    // Reasoning tokens are drawn from the same budget as the reply, so a
    // description-sized ceiling here would return an empty `output` with
    // status `incomplete` rather than a short description.
    max_output_tokens: 4096,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: IMAGE_PROMPT },
        { type: 'input_image', image_url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` },
      ],
    }],
  }, apiKey, { timeoutMs: 120000 });

  const text = (data.output || [])
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text)
    .join('')
    .trim();

  if (!text || text === 'SKIP') return null;
  return text;
}

export { OpenAIError };
