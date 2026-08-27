import { readConfig } from './config.mjs';
import { createRelay } from './relay.mjs';

const config = readConfig();
const relay = createRelay(config);
try {
  await relay.listen();
  console.log(`Local OpenAI WebSocket service: ws://127.0.0.1:${config.port}/realtime`);
  if (!config.apiKey) console.warn('OPENAI_API_KEY is missing. Add it to .env.server.local and restart.');
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? `Port ${config.port} is already in use.` : 'Could not start the local WebSocket service.');
  process.exit(1);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await relay.close(); process.exit(0); });
