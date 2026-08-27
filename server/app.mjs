import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicAuthRouter, createAuthRouter } from './routes/auth.mjs';
import { createSessionsRouter } from './routes/sessions.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds the HTTP side of the server: API, CWL auth when enabled, and the built
 * frontend in production. The WebSocket relay attaches to the same underlying
 * server (see relay.mjs) so everything lives on one origin.
 */
export async function createApp(config, databaseService) {
  const app = express();
  const db = databaseService.getDb();

  // Behind a reverse proxy in production, req.secure is false without this and
  // express-session then refuses to send a secure cookie — logins would appear
  // to succeed and then silently fail to stick.
  if (config.auth.secureCookie) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      realtimeConfigured: Boolean(config.apiKey),
      showLogin: config.auth.showLogin,
      database: databaseService.getConnectionInfo(),
    });
  });

  // Always available, both modes — this is how the frontend decides whether to
  // render a login screen at all.
  app.use(createPublicAuthRouter(config));

  if (config.auth.showLogin) {
    if (!db) throw new Error('SHOW_LOGIN is on but the database is not connected.');

    const { createSessionMiddleware } = await import('./auth/session.mjs');
    const { configurePassport } = await import('./auth/passport.mjs');

    app.use(createSessionMiddleware(config, databaseService.client));
    const passport = configurePassport(config, db);
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(createAuthRouter(config, passport));
    console.log(`CWL login enabled (${config.auth.saml.environment}) — IdP ${config.auth.saml.entryPoint}`);
  } else {
    console.log('CWL login disabled (SHOW_LOGIN is off). Sessions are anonymous and no CWL data is collected.');
  }

  if (db) {
    app.use(createSessionsRouter(config, databaseService));
  } else {
    console.warn('No MONGODB_URI configured — practice sessions will not be saved.');
  }

  // In production this server also serves the compiled React app. In
  // development react-scripts serves it and proxies here instead.
  const buildDir = path.join(projectRoot, 'build');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(buildDir)) {
    app.use(express.static(buildDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
      res.sendFile(path.join(buildDir, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Last-resort handler: without it an async failure would surface as a hung
  // request rather than a response the frontend can act on.
  app.use((error, req, res, next) => {
    console.error('Unhandled request error:', error.message);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
