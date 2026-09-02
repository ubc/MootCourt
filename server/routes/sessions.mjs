import express from 'express';
import { getIdentity, requireAuth } from './auth.mjs';
import {
  createSession,
  saveSessionData,
  getSession,
  listSessionsForUser,
} from '../models/practiceSession.mjs';

/**
 * Practice session persistence.
 *
 * Mounted whenever a database is configured, in both anonymous and login mode.
 * requireAuth is a passthrough while SHOW_LOGIN is off, so an anonymous
 * deployment still saves runs — just with no identity attached to them.
 */
export function createSessionsRouter(config, databaseService) {
  const router = express.Router();
  const auth = requireAuth(config);

  // A configured database can still be unreachable — a stopped container, a
  // network blip. Practice must not become impossible because saving is
  // broken, so these fail with a clear signal the frontend can shrug off.
  const withDb = handler => async (req, res) => {
    const db = databaseService.getDb();
    if (!db) return res.status(503).json({ error: 'Session storage is unavailable' });
    try {
      await handler(req, res, db);
    } catch (error) {
      console.error(`Session route ${req.method} ${req.path} failed:`, error.message);
      res.status(500).json({ error: 'Session storage failed' });
    }
  };

  router.post('/api/sessions', auth, express.json({ limit: '1mb' }), withDb(async (req, res, db) => {
    const session = await createSession(db, {
      identity: getIdentity(req),
      playerPosition: req.body?.playerPosition,
      settings: req.body?.settings,
      briefId: req.body?.briefId,
    });
    res.status(201).json({ sessionId: session.sessionId, startedAt: session.startedAt });
  }));

  // The timing array from a full practice run is large, hence the raised limit.
  router.patch('/api/sessions/:sessionId', auth, express.json({ limit: '25mb' }), withDb(async (req, res, db) => {
    const updated = await saveSessionData(db, req.params.sessionId, getIdentity(req), req.body || {});
    if (!updated) return res.status(404).json({ error: 'Session not found' });
    res.json({ sessionId: updated.sessionId, updatedAt: updated.updatedAt });
  }));

  router.get('/api/sessions/:sessionId', auth, withDb(async (req, res, db) => {
    const session = await getSession(db, req.params.sessionId, getIdentity(req));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ session });
  }));

  router.get('/api/sessions', auth, withDb(async (req, res, db) => {
    const sessions = await listSessionsForUser(db, getIdentity(req), req.query.limit);
    res.json({ sessions });
  }));

  return router;
}
