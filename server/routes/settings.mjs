import express from 'express';

/**
 * Site-wide instructor settings.
 *
 * GET is public: the app reads it on load to know the pace thresholds and the
 * default state of the student's toggle. PUT is currently open as well because
 * this deployment has no identity at all (SHOW_LOGIN off, no database). Once
 * CWL login is on, gate PUT on `req.user.role === 'instructor'`; the role is
 * already derived in auth/cwlProfile.mjs.
 */
export function createSettingsRouter(store) {
  const router = express.Router();

  router.get('/api/settings', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ settings: store.get(), defaults: store.defaults() });
  });

  router.put('/api/settings', express.json({ limit: '64kb' }), async (req, res) => {
    const result = await store.save(req.body);
    if (result.errors) return res.status(400).json({ errors: result.errors });
    res.json({ settings: result.value });
  });

  return router;
}
