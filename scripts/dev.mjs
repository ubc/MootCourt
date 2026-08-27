import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readConfig } from '../server/config.mjs';
import { startServer } from '../server/bootstrap.mjs';

const require = createRequire(import.meta.url);
const config = readConfig();

let started;
try {
  started = await startServer(config);
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? `Cannot start the local service on port ${config.port}. Close the other process or set REALTIME_PORT.`
    : `Cannot start the local service: ${error.message}`);
  process.exit(1);
}

console.log(`Local WebSocket service: ws://127.0.0.1:${config.port}/realtime`);
if (!config.apiKey) console.warn('Add OPENAI_API_KEY to .env.server.local and restart to enable IntelliJudge.');
console.log(config.auth.showLogin
  ? 'CWL login is ON. Sign in at http://localhost:' + config.appPort
  : 'CWL login is OFF (SHOW_LOGIN unset). Practice sessions are anonymous.');

const browserEnv = { ...process.env };
// The key belongs only to this Node process, never the frontend build process.
for (const name of Object.keys(browserEnv)) if (name.startsWith('OPENAI_')) delete browserEnv[name];
// Same for database credentials and the session secret.
for (const name of ['MONGODB_URI', 'SESSION_SECRET']) delete browserEnv[name];

const child = spawn(process.execPath, [require.resolve('react-scripts/scripts/start.js')], {
  stdio: 'inherit',
  env: {
    ...browserEnv,
    PORT: String(config.appPort),
    HOST: '127.0.0.1',
    BROWSER: 'none',
    REACT_APP_REALTIME_URL: `ws://127.0.0.1:${config.port}/realtime`,
    // Read by src/setupProxy.js so /api and /auth reach this process. That
    // proxy is what puts the app and the SAML callback on one origin.
    MOOTCOURT_API_TARGET: `http://127.0.0.1:${config.port}`,
  },
});

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  await started.close();
  process.exit(code);
}
child.once('error', () => stop(1));
child.once('exit', code => stop(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
