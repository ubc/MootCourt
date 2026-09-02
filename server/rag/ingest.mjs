import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DocumentParsingModule } from 'ubc-genai-toolkit-document-parsing';
import { chunkText } from './chunking.mjs';

/**
 * Turns an uploaded file into searchable text and vectors.
 *
 * parse -> chunk -> embed -> store, the same shape BiocBot's documentIngestion.js
 * uses. The step that matters most here is the first: the toolkit parser is
 * handed an `imageDescriber`, so a chart, a scanned exhibit, or a screenshot
 * inside a PDF or Word file is sent to the vision model and its description is
 * inlined into the text at the point the image sat. Everything downstream then
 * treats that description as ordinary prose — it is chunked, embedded, and
 * retrievable exactly like body text, which is what makes an image-heavy brief
 * usable by a judge that can only read.
 *
 * The extracted text is returned to the caller to store in MongoDB. The
 * original binary is never persisted (see docs/materials.md).
 */

/**
 * The parser logs every internal step at debug level unconditionally, which
 * buries a real warning under a page of temp-file paths on every upload. Debug
 * is dropped unless MATERIALS_DEBUG is set; warnings and errors always show.
 */
const parserLogger = {
  debug: process.env.MATERIALS_DEBUG ? (message, meta) => console.debug(`[materials] ${message}`, meta || '') : () => {},
  info: () => {},
  warn: (message, meta) => console.warn(`[materials] ${message}`, meta || ''),
  error: (message, meta) => console.error(`[materials] ${message}`, meta || ''),
};

/** Only what the thesis programme needs today. The parser also handles PPTX/HTML/MD. */
export const SUPPORTED_MIME_TYPES = Object.freeze({
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
});

export function isSupportedMimeType(mimeType) {
  return Object.hasOwn(SUPPORTED_MIME_TYPES, String(mimeType || '').toLowerCase());
}

class IngestError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'IngestError';
    this.retryable = retryable;
  }
}

/**
 * Parses one buffer, describing embedded images along the way.
 *
 * The parser reads from disk only, so the upload is staged in the OS temp
 * directory and removed in a `finally` — a thesis chapter must not be left
 * lying in /tmp because embedding failed.
 */
async function parseBuffer(buffer, { mimeType, originalName, providers, onImage }) {
  const extension = SUPPORTED_MIME_TYPES[mimeType.toLowerCase()];
  const tempPath = path.join(os.tmpdir(), `mootcourt_${randomUUID()}${extension}`);
  let describedImageCount = 0;

  const parser = new DocumentParsingModule({
    logger: parserLogger,
    imageConcurrency: 4,
    imageDescriber: async image => {
      try {
        const description = await providers.describeImage(image.data, image.mimeType);
        if (description) {
          describedImageCount += 1;
          onImage?.(describedImageCount);
        }
        return description;
      } catch (error) {
        // One unreadable image must not cost the student the whole upload; the
        // page it sat on is still parsed, just without that figure.
        const where = image.pageNumber ? `page ${image.pageNumber}` : `image ${image.imageIndex}`;
        console.warn(`Image description failed (${originalName}, ${where}): ${error.message}`);
        return null;
      }
    },
  });

  try {
    await fs.writeFile(tempPath, buffer);
    const result = await parser.parse({ filePath: tempPath }, 'text');
    const text = (result?.content || '').trim();
    if (!text) {
      throw new IngestError(
        `No text could be read from "${originalName}". If it is a scan, it needs to be run through OCR first.`,
      );
    }
    return { text, describedImageCount };
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new IngestError(`Could not read "${originalName}": ${error.message}`);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

/**
 * Full pipeline for one document.
 *
 * @param {object} params
 * @param {Buffer} params.buffer
 * @param {string} params.briefId Scopes the vectors; see MaterialsStore.
 * @returns {Promise<{documentId, text, chunkCount, describedImageCount, characterCount}>}
 */
export async function ingestDocument({
  buffer,
  originalName,
  mimeType,
  briefId,
  store,
  providers,
  chunking,
  onProgress,
}) {
  if (!isSupportedMimeType(mimeType)) {
    throw new IngestError(`${originalName} is not a PDF or Word document.`);
  }
  const documentId = `doc_${randomUUID()}`;
  const emit = phase => { try { onProgress?.(phase); } catch { /* a listener must never fail an upload */ } };

  emit('parsing');
  const { text, describedImageCount } = await parseBuffer(buffer, {
    mimeType, originalName, providers, onImage: () => emit('describing'),
  });

  emit('chunking');
  const chunks = chunkText(text, chunking);
  if (!chunks.length) {
    throw new IngestError(`"${originalName}" produced no usable text to index.`);
  }

  emit('embedding');
  let vectors;
  try {
    // One request per batch rather than per chunk: a 60-page factum is a few
    // hundred chunks, and that many round trips is the slowest part of an upload.
    vectors = [];
    const BATCH = 96;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH).map(chunk => chunk.text);
      vectors.push(...await providers.embedBatch(batch));
    }
  } catch (error) {
    throw new IngestError(`Could not index "${originalName}": ${error.message}`, { retryable: true });
  }

  emit('storing');
  try {
    await store.upsertChunks({ briefId, documentId, filename: originalName }, chunks, vectors);
  } catch (error) {
    throw new IngestError(`Could not save "${originalName}" to the search index: ${error.message}`, { retryable: true });
  }

  emit('done');
  return {
    documentId,
    text,
    chunkCount: chunks.length,
    describedImageCount,
    characterCount: text.length,
  };
}

export { IngestError };
