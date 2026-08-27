import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { MAX_RECORDING_BYTES, pcmToWav } from './audio.mjs';
import { sessionConfig } from './config.mjs';

function sendJSON(socket, event) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function closeSocket(socket) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  // terminate also aborts a pending upstream handshake.
  socket.terminate();
}

export function createRelay(config, { connectUpstream, setupTimeoutMs = 15000, turnTimeoutMs = 120000, requestListener } = {}) {
  const connect = connectUpstream || (() => new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.model)}`,
    { headers: { Authorization: `Bearer ${config.apiKey}` }, handshakeTimeout: setupTimeoutMs, maxPayload: 16 * 1024 * 1024 },
  ));
  // Loopback plus whatever hostname the deployment is actually served from,
  // so the same check works locally and behind a real domain in production.
  const allowedHosts = new Set(['127.0.0.1', 'localhost']);
  for (const origin of config.origins || []) {
    try { allowedHosts.add(new URL(origin).hostname); } catch { /* ignore malformed origin */ }
  }
  const validHost = req => {
    try {
      return allowedHosts.has(new URL(`http://${req.headers.host}`).hostname);
    } catch { return false; }
  };
  const server = http.createServer((req, res) => {
    if (!validHost(req)) { res.setHeader('Cache-Control', 'no-store'); res.writeHead(403).end(); return; }
    if (req.method === 'GET' && req.url === '/health') {
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', configured: Boolean(config.apiKey) }));
      return;
    }
    // The Express app (API, auth, and in production the built frontend) shares
    // this server so the browser sees a single origin — which SAML requires,
    // since the IdP posts its assertion back and the session cookie has to be
    // readable by the same origin that serves the app.
    if (requestListener) { requestListener(req, res); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RECORDING_BYTES, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    // Loopback binding alone does not prevent websites from accessing localhost.
    if (!validHost(req) || req.url !== '/realtime' || !config.origins.includes(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client));
  });

  wss.on('connection', client => {
    let upstream;
    let ready = false;
    let busy = false;
    let awaitingTranscript = false;
    let committedItem;
    let chunks = [];
    let chunkBytes = 0;
    let caption = '';
    let setupTimer;
    let turnTimer;
    let failed = false;
    const fail = message => {
      if (failed) return;
      failed = true;
      clearTimeout(setupTimer);
      clearTimeout(turnTimer);
      sendJSON(client, { type: 'error', message });
      client.close(1011, 'Session ended');
      closeSocket(upstream);
    };
    const flushAudio = () => {
      if (!chunkBytes) return;
      if (client.bufferedAmount > 8 * 1024 * 1024) {
        fail('Audio playback could not keep up. Start a new session.');
        return;
      }
      if (client.readyState === WebSocket.OPEN) client.send(pcmToWav(Buffer.concat(chunks)));
      chunks = [];
      chunkBytes = 0;
    };

    client.on('close', () => {
      clearTimeout(setupTimer);
      clearTimeout(turnTimer);
      closeSocket(upstream);
    });
    client.on('error', () => closeSocket(upstream));
    if (!config.apiKey) {
      fail('Add OPENAI_API_KEY to .env.server.local, then restart npm run dev.');
      return;
    }
    try { upstream = connect(); }
    catch { fail('Could not connect to OpenAI. Check your connection and API configuration.'); return; }
    setupTimer = setTimeout(() => fail('OpenAI session setup timed out. Try starting a new session.'), setupTimeoutMs);
    upstream.on('open', () => sendJSON(upstream, { type: 'session.update', session: sessionConfig(config) }));
    upstream.on('unexpected-response', (_req, res) => {
      res.resume();
      fail(`OpenAI rejected the connection (HTTP ${res.statusCode}). Check your API key, model access, and billing.`);
    });
    upstream.on('error', () => fail('OpenAI connection failed. Check your network, API key, and model access.'));
    upstream.on('close', () => fail('OpenAI disconnected. Start a new practice session; previous context is not restored.'));
    upstream.on('message', raw => {
      if (failed) return;
      let event;
      try { event = JSON.parse(raw.toString()); }
      catch { fail('OpenAI sent an unreadable response. Start a new session.'); return; }
      switch (event.type) {
        case 'session.updated':
          if (!ready) {
            ready = true;
            clearTimeout(setupTimer);
            sendJSON(client, { type: 'ready' });
          }
          break;
        case 'input_audio_buffer.committed':
          committedItem = event.item_id;
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (!awaitingTranscript || event.item_id !== committedItem) break;
          awaitingTranscript = false;
          sendJSON(client, { type: 'transcript', text: event.transcript || '' });
          // The audio is already in the conversation. Never resubmit its transcript.
          sendJSON(upstream, { type: 'response.create' });
          break;
        case 'conversation.item.input_audio_transcription.failed':
          fail('OpenAI could not transcribe this recording. Start a new session and try again.');
          break;
        case 'response.output_audio.delta':
          if (!busy || typeof event.delta !== 'string') break;
          {
            const pcm = Buffer.from(event.delta, 'base64');
            if (pcm.length % 2) { fail('OpenAI returned invalid audio.'); break; }
            chunks.push(pcm);
            chunkBytes += pcm.length;
            // Half-second chunks preserve the existing queued audio/pause behavior.
            if (chunkBytes >= 24000) flushAudio();
          }
          break;
        case 'response.output_audio.done':
          flushAudio();
          break;
        case 'response.output_audio_transcript.delta':
          caption += event.delta || '';
          break;
        case 'response.output_audio_transcript.done':
          sendJSON(client, { type: 'caption', text: event.transcript || caption });
          break;
        case 'response.done':
          flushAudio();
          clearTimeout(turnTimer);
          busy = false;
          if (event.response?.status !== 'completed') {
            fail('OpenAI did not complete the reply. Check model limits and try a new session.');
          } else {
            sendJSON(client, { type: 'response.done' });
          }
          break;
        case 'error':
          // Do not forward raw API errors that may echo request contents or credentials.
          fail('OpenAI rejected a session request. Check model/voice settings, API access, and usage limits.');
          break;
        default:
          break;
      }
    });

    client.on('message', async (raw, isBinary) => {
      if (!isBinary || !ready || busy || upstream.readyState !== WebSocket.OPEN) {
        fail('The session is not ready for another recording. Start a new session.');
        return;
      }
      const pcm = Buffer.from(raw);
      if (pcm.length < 4800 || pcm.length > MAX_RECORDING_BYTES || pcm.length % 2) {
        fail('Record between 0.1 seconds and 10 minutes of speech per turn.');
        return;
      }
      busy = true;
      awaitingTranscript = true;
      committedItem = undefined;
      caption = '';
      turnTimer = setTimeout(() => fail('OpenAI took too long to reply. Start a new session and try again.'), turnTimeoutMs);
      try {
        // Keep chunks small; await sends to apply upstream backpressure and preserve order.
        for (let offset = 0; offset < pcm.length; offset += 24000) {
          if (failed || client.readyState !== WebSocket.OPEN) return;
          const payload = JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm.subarray(offset, offset + 24000).toString('base64') });
          await new Promise((resolve, reject) => upstream.send(payload, error => error ? reject(error) : resolve()));
        }
        if (!failed) sendJSON(upstream, { type: 'input_audio_buffer.commit' });
      } catch { fail('Could not send the recording to OpenAI. Start a new session.'); }
    });
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address()); });
    }),
    close: () => new Promise(resolve => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close(resolve);
    }),
  };
}
