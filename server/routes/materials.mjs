import express from 'express';
import multer from 'multer';
import { getIdentity, requireAuth } from './auth.mjs';
import {
  createBrief,
  getBrief,
  getBriefSummary,
  addDocument,
  removeDocument,
  deleteBrief,
} from '../models/brief.mjs';
import { ingestDocument, isSupportedMimeType, SUPPORTED_MIME_TYPES, IngestError } from '../rag/ingest.mjs';

/**
 * Upload, inspection and deletion of practice materials.
 *
 * Mounted only when both a database and Qdrant are configured — the frontend
 * asks /api/materials/config first and hides the whole upload step when this is
 * off, so a deployment without either behaves exactly as Moot Court did before.
 *
 * `ingest` is injectable for the same reason relay.mjs takes `connectUpstream`:
 * the routes' interesting behaviour is what they do when indexing fails, and
 * that is unreachable through a real parser.
 */
export function createMaterialsRouter(config, databaseService, { store, providers, ingest = ingestDocument }) {
  const router = express.Router();
  const auth = requireAuth(config);
  const { upload: uploadLimits } = config.materials;

  const upload = multer({
    // Memory, never disk: the whole point of this feature's storage decision is
    // that the original file is not persisted. Parsing writes one temp file and
    // removes it in a finally (see ingest.mjs).
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadLimits.maxFileBytes, files: 1 },
    fileFilter: (req, file, callback) => {
      if (isSupportedMimeType(file.mimetype)) return callback(null, true);
      // Surfaced to the student as a 415 below rather than a 500.
      const error = new Error('Only PDF and Word (.docx) files can be uploaded.');
      error.code = 'UNSUPPORTED_FILE_TYPE';
      callback(error);
    },
  }).single('file');

  const withDb = handler => async (req, res) => {
    const db = databaseService.getDb();
    if (!db) return res.status(503).json({ error: 'Materials storage is unavailable' });
    try {
      await handler(req, res, db);
    } catch (error) {
      console.error(`Materials route ${req.method} ${req.path} failed:`, error.message);
      res.status(500).json({ error: 'Materials storage failed' });
    }
  };

  /** What the frontend needs to decide whether to render the upload step at all. */
  router.get('/api/materials/config', (req, res) => {
    res.json({
      enabled: true,
      stub: providers.stub,
      maxFileBytes: uploadLimits.maxFileBytes,
      maxFiles: uploadLimits.maxFiles,
      acceptedExtensions: Object.values(SUPPORTED_MIME_TYPES),
      acceptedMimeTypes: Object.keys(SUPPORTED_MIME_TYPES),
      retentionDays: config.materials.retentionDays,
    });
  });

  router.post('/api/materials/briefs', auth, express.json({ limit: '8kb' }), withDb(async (req, res, db) => {
    const brief = await createBrief(db, {
      identity: getIdentity(req),
      title: req.body?.title,
      retentionDays: config.materials.retentionDays,
    });
    res.status(201).json({ brief: toSummary(brief) });
  }));

  /**
   * Uploads and indexes one file.
   *
   * Synchronous on purpose: a student uploads a factum and then walks straight
   * into the courtroom, so a background job that finishes after they start
   * arguing would give them a judge that cannot see their brief. Image-heavy
   * PDFs are the slow case — the frontend shows progress and the request is
   * allowed to take minutes.
   */
  router.post('/api/materials/briefs/:briefId/documents', auth, withDb(async (req, res, db) => {
    const identity = getIdentity(req);
    const { briefId } = req.params;

    const brief = await getBriefSummary(db, briefId, identity);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    if (brief.documents.length >= uploadLimits.maxFiles) {
      return res.status(409).json({ error: `You can upload at most ${uploadLimits.maxFiles} files.` });
    }

    const file = await readUpload(req, res, upload);
    if (!file) return; // readUpload already answered.

    let result;
    try {
      result = await ingest({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        briefId,
        store,
        providers,
        chunking: config.materials.chunking,
      });
    } catch (error) {
      if (error instanceof IngestError) {
        console.warn(`Ingest rejected ${file.originalname}: ${error.message}`);
        return res.status(error.retryable ? 502 : 422).json({ error: error.message });
      }
      throw error;
    }

    let updated;
    try {
      updated = await addDocument(db, briefId, identity, {
        documentId: result.documentId,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        characterCount: result.characterCount,
        chunkCount: result.chunkCount,
        describedImageCount: result.describedImageCount,
        text: result.text,
      });
    } catch (error) {
      // The vectors are already in Qdrant but nothing in MongoDB points at
      // them; leaving them would make the brief retrieve text the student
      // cannot see listed.
      await store.deleteDocument(briefId, result.documentId).catch(() => {});
      return res.status(409).json({ error: error.message });
    }
    if (!updated) {
      await store.deleteDocument(briefId, result.documentId).catch(() => {});
      return res.status(404).json({ error: 'Brief not found' });
    }

    res.status(201).json({
      brief: toSummary(updated),
      document: {
        documentId: result.documentId,
        filename: file.originalname,
        characterCount: result.characterCount,
        chunkCount: result.chunkCount,
        describedImageCount: result.describedImageCount,
      },
    });
  }));

  router.get('/api/materials/briefs/:briefId', auth, withDb(async (req, res, db) => {
    const brief = await getBriefSummary(db, req.params.briefId, getIdentity(req));
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    res.json({ brief: toSummary(brief) });
  }));

  /** Backs the "view uploaded text" modal — the only route that returns full text. */
  router.get('/api/materials/briefs/:briefId/documents/:documentId/text', auth, withDb(async (req, res, db) => {
    const brief = await getBrief(db, req.params.briefId, getIdentity(req));
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    const document = brief.documents.find(entry => entry.documentId === req.params.documentId);
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json({
      documentId: document.documentId,
      filename: document.filename,
      characterCount: document.characterCount,
      chunkCount: document.chunkCount,
      describedImageCount: document.describedImageCount,
      text: document.text,
    });
  }));

  router.delete('/api/materials/briefs/:briefId/documents/:documentId', auth, withDb(async (req, res, db) => {
    const { briefId, documentId } = req.params;
    // Vectors first: a document still listed but no longer searchable is a
    // smaller lie than one that keeps answering searches after being removed.
    await store.deleteDocument(briefId, documentId);
    const updated = await removeDocument(db, briefId, getIdentity(req), documentId);
    if (!updated) return res.status(404).json({ error: 'Brief not found' });
    res.json({ brief: toSummary(updated) });
  }));

  router.delete('/api/materials/briefs/:briefId', auth, withDb(async (req, res, db) => {
    const { briefId } = req.params;
    await store.deleteBrief(briefId);
    const deleted = await deleteBrief(db, briefId, getIdentity(req));
    if (!deleted) return res.status(404).json({ error: 'Brief not found' });
    res.status(204).end();
  }));

  return router;
}

/**
 * Runs multer and turns its failure modes into answers a student can act on.
 * Multer reports these through a callback rather than a rejected promise, and
 * its default handling would surface a size overrun as a 500.
 *
 * @returns {Promise<object|null>} null once a response has been sent.
 */
function readUpload(req, res, upload) {
  return new Promise(resolve => {
    upload(req, res, error => {
      if (error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'That file is too large.' });
        } else if (error.code === 'UNSUPPORTED_FILE_TYPE') {
          res.status(415).json({ error: error.message });
        } else {
          console.warn(`Upload rejected: ${error.message}`);
          res.status(400).json({ error: 'That file could not be read.' });
        }
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file was attached.' });
        return resolve(null);
      }
      resolve(req.file);
    });
  });
}

/** Never returns document text: the list view is polled and the text is large. */
function toSummary(brief) {
  return {
    briefId: brief.briefId,
    title: brief.title,
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
    expiresAt: brief.expiresAt,
    documents: (brief.documents || []).map(document => ({
      documentId: document.documentId,
      filename: document.filename,
      mimeType: document.mimeType,
      size: document.size,
      characterCount: document.characterCount,
      chunkCount: document.chunkCount,
      describedImageCount: document.describedImageCount,
      uploadedAt: document.uploadedAt,
    })),
  };
}
