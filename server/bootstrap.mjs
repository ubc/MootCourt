import { validateConfig } from './config.mjs';
import { createRelay } from './relay.mjs';
import { createApp } from './app.mjs';
import databaseService from './db.mjs';
import { createMaterialsService } from './rag/materials.mjs';

/**
 * Shared startup for both entry points: `npm run server` (server/index.mjs) and
 * `npm run dev` (scripts/dev.mjs, which also spawns react-scripts).
 *
 * Keeping it in one place means the development server cannot quietly diverge
 * from what production actually does — the difference between the two should
 * only ever be who serves the frontend.
 */
export async function startServer(config, { onFatal } = {}) {
  const fail = message => {
    if (onFatal) return onFatal(message);
    console.error(message);
    process.exit(1);
  };

  const problems = validateConfig(config);
  if (problems.length) {
    return fail(
      `Cannot start — configuration is incomplete:\n${problems.map(p => `  - ${p}`).join('\n')}\n\n` +
      'See .env.server.example, or set SHOW_LOGIN=false to run without login.',
    );
  }

  // Optional while login is off so a developer without Docker still gets a
  // working courtroom; required once login is on, which validateConfig enforces.
  try {
    await databaseService.connect(config.mongo);
  } catch (error) {
    if (config.auth.showLogin) {
      return fail(
        `Cannot start — CWL login needs MongoDB but the connection failed: ${error.message}\n` +
        'Start the shared instance from ubc/tlef-mongodb-docker: docker compose up -d',
      );
    }
    console.warn(`MongoDB unavailable (${error.message}). Continuing without saved sessions.`);
  }

  // Uploads need somewhere to put both halves of a document: the extracted text
  // in MongoDB and the vectors in Qdrant. With either missing the feature is
  // off rather than half-working, and the frontend hides the upload step.
  let materials = null;
  let stopRetentionSweep = () => {};
  if (config.materials.enabled && databaseService.getDb()) {
    materials = createMaterialsService(config, databaseService);
    const health = await materials.store.healthCheck();
    if (health.reachable) {
      console.log(`Materials enabled — Qdrant ${config.materials.qdrant.url}, collection ${health.collection}`);
      stopRetentionSweep = materials.startRetentionSweep();
    } else {
      // Not fatal: the courtroom works without materials, and a student who
      // uploads nothing never notices. Uploading would fail loudly anyway.
      console.warn(`Qdrant unreachable at ${config.materials.qdrant.url} (${health.error}). Uploads are disabled.`);
      materials = null;
    }
  } else if (config.materials.enabled) {
    console.warn('QDRANT_URL is set but MongoDB is not connected. Uploads are disabled.');
  }

  const app = await createApp(config, databaseService, materials);
  const relay = createRelay(config, { requestListener: app, materials });
  await relay.listen();

  return {
    relay,
    databaseService,
    materials,
    close: async () => {
      stopRetentionSweep();
      await relay.close();
      await databaseService.disconnect();
    },
  };
}
