import { validateConfig } from './config.mjs';
import { createRelay } from './relay.mjs';
import { createApp } from './app.mjs';
import databaseService from './db.mjs';

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

  const app = await createApp(config, databaseService);
  const relay = createRelay(config, { requestListener: app });
  await relay.listen();

  return {
    relay,
    databaseService,
    close: async () => {
      await relay.close();
      await databaseService.disconnect();
    },
  };
}
