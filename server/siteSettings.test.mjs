import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { createSiteSettingsStore, validateSiteSettings, DEFAULT_SITE_SETTINGS } from './siteSettings.mjs';
import { createApp } from './app.mjs';
import { createRelay } from './relay.mjs';
import { readConfig, JUDGE_INSTRUCTIONS } from './config.mjs';

const noDb = { getDb: () => null, getConnectionInfo: () => ({ configured: false }), client: null };

async function tempFile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mootcourt-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'site-settings.json');
}

async function listen(t, app) {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('validation rejects an empty prompt and non-increasing thresholds, all at once', () => {
  const result = validateSiteSettings({ judgePrompt: '  ', showPaceByDefault: 'yes', wpm: { slowBelow: 160, fastAbove: 120, tooFastAbove: 180 } });
  assert.ok(result.errors);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join(' '), /prompt cannot be empty/);
  assert.match(result.errors.join(' '), /must increase/);
});

test('validation trims the prompt and coerces numeric strings from a form', () => {
  const result = validateSiteSettings({ judgePrompt: '  Be stern.  ', showPaceByDefault: false, wpm: { slowBelow: '100', fastAbove: '150', tooFastAbove: '170' } });
  assert.deepEqual(result.value, { judgePrompt: 'Be stern.', showPaceByDefault: false, wpm: { slowBelow: 100, fastAbove: 150, tooFastAbove: 170 } });
});

test('store starts from defaults with no file, persists a save, and reloads it', async t => {
  const file = await tempFile(t);
  const store = createSiteSettingsStore(file);
  assert.deepEqual(await store.load(), DEFAULT_SITE_SETTINGS);
  assert.equal(store.get().judgePrompt, JUDGE_INSTRUCTIONS);

  const saved = await store.save({ ...DEFAULT_SITE_SETTINGS, judgePrompt: 'Custom prompt', wpm: { ...DEFAULT_SITE_SETTINGS.wpm } });
  assert.equal(saved.value.judgePrompt, 'Custom prompt');
  assert.equal(store.get().judgePrompt, 'Custom prompt');

  const reloaded = createSiteSettingsStore(file);
  await reloaded.load();
  assert.equal(reloaded.get().judgePrompt, 'Custom prompt');
  await assert.rejects(fs.stat(`${file}.tmp`));
});

test('a corrupt settings file falls back to defaults instead of crashing', async t => {
  const file = await tempFile(t);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{ not json');
  const store = createSiteSettingsStore(file);
  await store.load();
  assert.deepEqual(store.get(), DEFAULT_SITE_SETTINGS);
});

test('GET returns settings plus defaults; PUT validates and persists; both work with no database', async t => {
  const file = await tempFile(t);
  const store = createSiteSettingsStore(file);
  await store.load();
  const config = readConfig({});
  const base = await listen(t, await createApp(config, noDb, store));

  const initial = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(initial.settings.judgePrompt, JUDGE_INSTRUCTIONS);
  assert.deepEqual(initial.defaults, DEFAULT_SITE_SETTINGS);

  const bad = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ judgePrompt: '', showPaceByDefault: true, wpm: {} }) });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).errors.length >= 2);

  const good = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ judgePrompt: 'New prompt', showPaceByDefault: false, wpm: { slowBelow: 110, fastAbove: 150, tooFastAbove: 175 } }) });
  assert.equal(good.status, 200);
  const after = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(after.settings.judgePrompt, 'New prompt');
  assert.equal(after.settings.showPaceByDefault, false);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).wpm.fastAbove, 150);
});

test('the relay sends the current instructor prompt when it opens each OpenAI session', async t => {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const sessionUpdates = [];
  upstream.on('connection', socket => socket.on('message', raw => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'session.update') { sessionUpdates.push(event.session); socket.send(JSON.stringify({ type: 'session.updated' })); }
  }));
  const config = { ...readConfig({ OPENAI_API_KEY: 'test-only-key' }), port: 0 };
  let prompt = 'First prompt';
  const relay = createRelay(config, {
    getInstructions: () => prompt,
    connectUpstream: () => new WebSocket(`ws://127.0.0.1:${upstream.address().port}`),
  });
  const address = await relay.listen();
  t.after(async () => { await relay.close(); await new Promise(resolve => upstream.close(resolve)); });

  const connect = async () => {
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/realtime`, { headers: { Origin: config.origins[0] } });
    await new Promise(resolve => client.on('message', data => { if (JSON.parse(data.toString()).type === 'ready') resolve(); }));
    client.close();
  };
  await connect();
  prompt = 'Edited prompt';
  await connect();
  assert.deepEqual(sessionUpdates.map(s => s.instructions), ['First prompt', 'Edited prompt']);
});
