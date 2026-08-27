import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readConfig } from '../server/config.mjs';
import { createRelay } from '../server/relay.mjs';

const require = createRequire(import.meta.url);
const config = readConfig();
const relay = createRelay(config);
try { await relay.listen(); }
catch {
  console.error(`Cannot start the local service on port ${config.port}. Close the other process or set REALTIME_PORT.`);
  process.exit(1);
}
console.log(`Local WebSocket service: ws://127.0.0.1:${config.port}/realtime`);
if (!config.apiKey) console.warn('Add OPENAI_API_KEY to .env.server.local and restart to enable IntelliJudge.');
const browserEnv = { ...process.env };
// The key belongs only to this Node process, never the frontend build process.
for (const name of Object.keys(browserEnv)) if (name.startsWith('OPENAI_')) delete browserEnv[name];
const child = spawn(process.execPath, [require.resolve('react-scripts/scripts/start.js')], {
  stdio: 'inherit',
  env: { ...browserEnv, PORT: String(config.appPort), HOST: '127.0.0.1', BROWSER: 'none', REACT_APP_REALTIME_URL: `ws://127.0.0.1:${config.port}/realtime` },
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  await relay.close();
  process.exit(code);
}
child.once('error', () => stop(1));
child.once('exit', code => stop(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
