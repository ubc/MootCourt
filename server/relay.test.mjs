import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { createRelay } from './relay.mjs';
import { readConfig } from './config.mjs';
import { pcmToWav } from './audio.mjs';

const config = { ...readConfig({ OPENAI_API_KEY: 'test-only-key' }), port: 0 };
const origin = config.origins[0];
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a test event');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

async function fixture(t, options = {}) {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const sessions = [];
  upstream.on('connection', socket => {
    const session = { socket, events: [], id: `item_${sessions.length}` };
    sessions.push(session);
    socket.on('message', raw => {
      const event = JSON.parse(raw.toString());
      session.events.push(event);
      if (options.handle) { options.handle(socket, event, session); return; }
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.commit') {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: session.id }));
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: session.id, transcript: `Argument ${session.id}` }));
      }
      if (event.type === 'response.create') {
        socket.send(JSON.stringify({ type: 'response.output_audio.delta', delta: Buffer.alloc(8000, 1).toString('base64') }));
        socket.send(JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'Why does that follow?' }));
        socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }));
      }
    });
  });
  let upstreamConnections = 0;
  const relay = createRelay({ ...config, ...options.config }, {
    setupTimeoutMs: options.setupTimeoutMs,
    turnTimeoutMs: options.turnTimeoutMs,
    materials: options.materials,
    connectUpstream: () => {
      upstreamConnections++;
      return new WebSocket(`ws://127.0.0.1:${upstream.address().port}`);
    },
  });
  const address = await relay.listen();
  t.after(async () => {
    await relay.close();
    for (const client of upstream.clients) client.terminate();
    await new Promise(resolve => upstream.close(resolve));
  });
  function client(headers = {}, path = '/realtime') {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${path}`, { headers: { Origin: origin, ...headers } });
    const messages = [];
    socket.on('message', (data, binary) => messages.push(binary ? Buffer.from(data) : JSON.parse(data.toString())));
    socket.on('error', () => {});
    return { socket, messages };
  }
  return { relay, address, sessions, client, connections: () => upstreamConnections };
}

test('PCM output has a valid mono 24 kHz WAV header and unchanged samples', () => {
  const pcm = Buffer.from([0, 128, 255, 127]);
  const wav = pcmToWav(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual(wav.subarray(44), pcm);
});

test('recording -> transcription -> exactly one reply, playable audio and captions', async t => {
  const f = await fixture(t);
  const c = f.client();
  await waitFor(() => c.messages.some(m => m.type === 'ready'));
  const pcm = Buffer.alloc(50000, 1);
  c.socket.send(pcm);
  await waitFor(() => c.messages.some(m => m.type === 'response.done'));
  const events = f.sessions[0].events;
  assert.equal(events[0].session.audio.input.turn_detection, null);
  assert.deepEqual(Buffer.concat(events.filter(e => e.type === 'input_audio_buffer.append').map(e => Buffer.from(e.audio, 'base64'))), pcm);
  assert.equal(events.filter(e => e.type === 'input_audio_buffer.commit').length, 1);
  assert.equal(events.filter(e => e.type === 'response.create').length, 1);
  assert.equal(events.filter(e => e.type === 'conversation.item.create').length, 0);
  assert.equal(c.messages.find(m => m.type === 'transcript').text, 'Argument item_0');
  assert.equal(c.messages.find(m => m.type === 'caption').text, 'Why does that follow?');
  const audio = c.messages.find(Buffer.isBuffer);
  assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
  assert.equal(audio.length, 8044);
  // A duplicate/late transcription must not trigger a second response.
  f.sessions[0].socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_0', transcript: 'duplicate' }));
  c.socket.send(Buffer.alloc(4800));
  await waitFor(() => c.messages.filter(m => m.type === 'response.done').length === 2);
  assert.equal(events.filter(e => e.type === 'response.create').length, 2);
});

test('two clients get separate upstream conversations and closing one ends only its session', async t => {
  const f = await fixture(t);
  const a = f.client();
  const b = f.client();
  await waitFor(() => a.messages.some(m => m.type === 'ready') && b.messages.some(m => m.type === 'ready'));
  a.socket.send(Buffer.alloc(4800));
  b.socket.send(Buffer.alloc(4800));
  await waitFor(() => a.messages.some(m => m.type === 'response.done') && b.messages.some(m => m.type === 'response.done'));
  assert.notEqual(a.messages.find(m => m.type === 'transcript').text, b.messages.find(m => m.type === 'transcript').text);
  a.socket.close();
  await waitFor(() => f.sessions[0].socket.readyState === WebSocket.CLOSED);
  assert.equal(f.sessions[1].socket.readyState, WebSocket.OPEN);
});

test('missing API key produces actionable error without opening an upstream connection', async t => {
  const f = await fixture(t, { config: { apiKey: '' } });
  const c = f.client();
  await waitFor(() => c.messages.some(m => m.type === 'error'));
  assert.match(c.messages[0].message, /\.env\.server\.local/);
  assert.equal(f.connections(), 0);
  const health = await fetch(`http://127.0.0.1:${f.address.port}/health`).then(r => r.json());
  assert.deepEqual(health, { status: 'ok', configured: false });
});

test('rejects foreign origins, missing origins, and DNS-rebinding Host headers', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: 'https://untrusted.example' }, { Origin: '' }, { Host: 'untrusted.example' }]) {
    const c = f.client(headers);
    const status = await new Promise(resolve => c.socket.on('unexpected-response', (_req, res) => { res.resume(); c.socket.terminate(); resolve(res.statusCode); }));
    assert.equal(status, 403);
  }
  assert.equal(f.connections(), 0);
});

test('waits for session configuration and times out rather than claiming it is ready', async t => {
  const f = await fixture(t, { handle: () => {}, setupTimeoutMs: 40 });
  const c = f.client();
  await waitFor(() => c.messages.some(m => m.type === 'error'));
  assert.equal(c.messages.some(m => m.type === 'ready'), false);
  assert.match(c.messages[0].message, /timed out/);
});

test('rejects unsupported client messages and too-short audio', async t => {
  const f = await fixture(t);
  for (const payload of ['{"type":"session.update","session":{"instructions":"override"}}', Buffer.alloc(10)]) {
    const c = f.client();
    await waitFor(() => c.messages.some(m => m.type === 'ready'));
    c.socket.send(payload);
    await waitFor(() => c.messages.some(m => m.type === 'error'));
  }
  assert.ok(f.sessions.every(s => s.events.length === 1));
});

test('upstream API errors are sanitized and close the browser session', async t => {
  const f = await fixture(t, { handle: socket => socket.send(JSON.stringify({ type: 'error', error: { message: 'test-only-key secret transcript' } })) });
  const c = f.client();
  await waitFor(() => c.socket.readyState === WebSocket.CLOSED);
  assert.match(c.messages[0].message, /OpenAI rejected/);
  assert.doesNotMatch(JSON.stringify(c.messages), /test-only-key|secret transcript/);
});

test('a stalled transcription times out and closes the upstream conversation', async t => {
  const f = await fixture(t, { turnTimeoutMs: 40, handle: (socket, event) => {
    if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
  } });
  const c = f.client();
  await waitFor(() => c.messages.some(m => m.type === 'ready'));
  c.socket.send(Buffer.alloc(4800));
  await waitFor(() => c.messages.some(m => m.type === 'error'));
  assert.match(c.messages.find(m => m.type === 'error').message, /too long/);
  await waitFor(() => f.sessions[0].socket.readyState === WebSocket.CLOSED);
});

// --- search_materials ------------------------------------------------------
//
// A tool call completes a response without the judge having said anything, so
// these cover the failure that would be invisible otherwise: the browser being
// told the turn is over while the judge is still mid-thought.

/** An upstream that makes one search_materials call, then speaks. */
function toolCallingUpstream(queries) {
  let calls = 0;
  return (socket, event, session) => {
    if (event.type === 'session.update') {
      session.tools = event.session.tools;
      socket.send(JSON.stringify({ type: 'session.updated' }));
    }
    if (event.type === 'input_audio_buffer.commit') {
      socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: session.id }));
      socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: session.id, transcript: 'My submission is X.' }));
    }
    if (event.type === 'conversation.item.create') session.toolOutputs = [...(session.toolOutputs || []), event.item];
    if (event.type === 'response.create') {
      if (calls++ === 0) {
        socket.send(JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'function_call', call_id: 'call_1', name: 'search_materials', arguments: JSON.stringify({ query: queries[0] }) },
        }));
        socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }));
        return;
      }
      socket.send(JSON.stringify({ type: 'response.output_audio.delta', delta: Buffer.alloc(8000, 1).toString('base64') }));
      socket.send(JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'You wrote otherwise at page four.' }));
      socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }));
    }
  };
}

test('a brief on the socket adds the search tool; no brief leaves the judge without one', async t => {
  const materials = { search: async () => ({ passages: [] }) };
  const f = await fixture(t, { materials, handle: toolCallingUpstream(['unused']) });

  const withBrief = f.client({}, '/realtime?brief=brief_abc');
  await waitFor(() => f.sessions.length === 1 && f.sessions[0].tools !== undefined);
  assert.deepEqual(f.sessions[0].tools.map(tool => tool.name), ['search_materials']);

  const without = f.client();
  await waitFor(() => f.sessions.length === 2 && f.sessions[1].events.some(e => e.type === 'session.update'));
  assert.equal(f.sessions[1].tools, undefined);

  withBrief.socket.close();
  without.socket.close();
});

test('a tool call is answered and the turn stays open until the judge actually speaks', async t => {
  const searched = [];
  const materials = {
    search: async (briefId, query) => {
      searched.push({ briefId, query });
      return { passages: [{ filename: 'factum.pdf', text: 'The appellant conceded the point.', score: 0.91 }] };
    },
  };
  const f = await fixture(t, { materials, handle: toolCallingUpstream(['what did they concede']) });
  const c = f.client({}, '/realtime?brief=brief_xyz');
  await waitFor(() => c.messages.some(m => m.type === 'ready'));

  c.socket.send(pcmToWav(Buffer.alloc(48000, 1)).subarray(44));
  await waitFor(() => c.messages.some(m => m.type === 'response.done'));

  // The search ran, scoped to this socket's brief and nothing else.
  assert.deepEqual(searched, [{ briefId: 'brief_xyz', query: 'what did they concede' }]);

  // The output went back upstream under the call id it was asked for.
  const output = f.sessions[0].toolOutputs.at(-1);
  assert.equal(output.type, 'function_call_output');
  assert.equal(output.call_id, 'call_1');
  assert.match(JSON.parse(output.output).passages[0].text, /conceded/);

  // Exactly one turn from the browser's side: the tool leg is invisible to it,
  // and the client was told the turn ended only after audio arrived.
  assert.equal(c.messages.filter(m => m.type === 'response.done').length, 1);
  assert.ok(c.messages.some(m => m.type === 'searching'), 'client is told a search is running');
  assert.ok(c.messages.some(m => Buffer.isBuffer(m)), 'the judge still spoke');
  const doneAt = c.messages.findIndex(m => m.type === 'response.done');
  assert.ok(c.messages.slice(0, doneAt).some(m => Buffer.isBuffer(m)), 'audio arrived before the turn ended');
});

test('a search failure still produces a reply rather than ending the moot', async t => {
  const materials = { search: async () => { throw new Error('qdrant is down'); } };
  const f = await fixture(t, { materials, handle: toolCallingUpstream(['anything']) });
  const c = f.client({}, '/realtime?brief=brief_down');
  await waitFor(() => c.messages.some(m => m.type === 'ready'));

  c.socket.send(pcmToWav(Buffer.alloc(48000, 1)).subarray(44));
  await waitFor(() => c.messages.some(m => m.type === 'response.done' || m.type === 'error'));
  assert.ok(c.messages.some(m => m.type === 'response.done'), 'the turn completed');
  assert.ok(!c.messages.some(m => m.type === 'error'), 'the session was not failed');
});

test('the search loop is bounded: the tool is withheld, and a model that ignores that has its turn ended', async t => {
  const materials = { search: async () => ({ passages: [] }) };
  const f = await fixture(t, {
    materials,
    // Deliberately adversarial: this upstream calls the tool on every request,
    // including the one where tool_choice is 'none'. A real model cannot, but
    // the relay must terminate regardless of what upstream does.
    handle: (socket, event, session) => {
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.commit') {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: session.id }));
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: session.id, transcript: 'X.' }));
      }
      if (event.type === 'conversation.item.create') session.toolOutputs = [...(session.toolOutputs || []), event.item];
      if (event.type === 'response.create') {
        session.requests = [...(session.requests || []), event.response?.tool_choice ?? 'auto'];
        socket.send(JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'function_call', call_id: `call_${session.requests.length}`, name: 'search_materials', arguments: '{"query":"again"}' },
        }));
        socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }));
      }
    },
  });
  const c = f.client({}, '/realtime?brief=brief_loop');
  await waitFor(() => c.messages.some(m => m.type === 'ready'));

  c.socket.send(pcmToWav(Buffer.alloc(48000, 1)).subarray(44));
  await waitFor(() => c.messages.some(m => m.type === 'response.done'));

  const session = f.sessions[0];
  // Three searches, then the tool is taken away, then the turn ends.
  assert.equal(session.toolOutputs.length, 3);
  assert.deepEqual(session.requests, ['auto', 'auto', 'auto', 'none']);
  assert.equal(session.toolOutputs.filter(item => item.type !== 'function_call_output').length, 0);
  // The browser is released rather than left waiting on a turn that never ends.
  assert.equal(c.messages.filter(m => m.type === 'response.done').length, 1);
});

test('malformed tool arguments search for nothing instead of failing the turn', async t => {
  const searched = [];
  const materials = { search: async (briefId, query) => { searched.push(query); return { passages: [] }; } };
  let calls = 0;
  const f = await fixture(t, {
    materials,
    handle: (socket, event, session) => {
      if (event.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }));
      if (event.type === 'input_audio_buffer.commit') {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: session.id }));
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: session.id, transcript: 'X.' }));
      }
      if (event.type === 'response.create') {
        if (calls++ === 0) {
          socket.send(JSON.stringify({
            type: 'response.output_item.done',
            item: { type: 'function_call', call_id: 'call_1', name: 'search_materials', arguments: '{"query": ' },
          }));
        } else {
          socket.send(JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'Continue.' }));
        }
        socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }));
      }
    },
  });
  const c = f.client({}, '/realtime?brief=brief_bad');
  await waitFor(() => c.messages.some(m => m.type === 'ready'));
  c.socket.send(pcmToWav(Buffer.alloc(48000, 1)).subarray(44));
  await waitFor(() => c.messages.some(m => m.type === 'response.done'));
  assert.deepEqual(searched, ['']);
});
