import { readConfig } from './config.mjs';
import { startServer } from './bootstrap.mjs';

const config = readConfig();

let started;
try {
  started = await startServer(config);
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${config.port} is already in use.`
    : `Could not start the local service: ${error.message}`);
  process.exit(1);
}

console.log(`Local OpenAI WebSocket service: ws://127.0.0.1:${config.port}/realtime`);
console.log(`API and auth: http://127.0.0.1:${config.port}`);
if (!config.apiKey) console.warn('OPENAI_API_KEY is missing. Add it to .env.server.local and restart.');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await started.close(); process.exit(0); });
}
