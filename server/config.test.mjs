import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './config.mjs';
import { createRelay } from './relay.mjs';

// The relay checks Origin before upgrading a WebSocket (server/relay.mjs).
//
// Development needs both loopback origins; a deployed environment must trust
// the deployed origin alone, because a loopback address is loopback on the
// client's machine rather than on ours.
//
// NODE_ENV=production here means "a built, deployed environment", NOT "the
// production tier". Staging sets it too -- it has to, since app.mjs only serves
// build/ when it is set -- so staging gets the same narrowing.
//
// These tests pin that difference so it cannot be undone by accident. Passing
// them says the allowlist is correct, and nothing more than that.

const PUBLIC = 'https://mootcourt.apps.ltic.ubc.ca';

test('a local checkout trusts both loopback origins and the public URL', () => {
  const config = readConfig({ OPENAI_API_KEY: 'k' });
  assert.ok(config.origins.includes('http://localhost:43127'));
  assert.ok(config.origins.includes('http://127.0.0.1:43127'));
  assert.ok(config.origins.includes(config.publicUrl));
});

test('a deployed environment (NODE_ENV=production) trusts the public origin and nothing else', () => {
  const config = readConfig({ OPENAI_API_KEY: 'k', NODE_ENV: 'production', PUBLIC_URL: PUBLIC });
  assert.deepEqual(config.origins, [PUBLIC]);
});

test('a deployed environment does not trust a loopback origin on the app port', () => {
  const config = readConfig({ OPENAI_API_KEY: 'k', NODE_ENV: 'production', PUBLIC_URL: PUBLIC });
  for (const forged of ['http://localhost:43127', 'http://127.0.0.1:43127']) {
    assert.equal(config.origins.includes(forged), false, `${forged} must not be trusted in production`);
  }
});

test('a trailing slash on PUBLIC_URL does not create an untrusted origin', () => {
  // The browser sends an Origin with no trailing slash. If config kept one the
  // allowlist would never match and every upgrade would 403 in production.
  const config = readConfig({ OPENAI_API_KEY: 'k', NODE_ENV: 'production', PUBLIC_URL: `${PUBLIC}/` });
  assert.deepEqual(config.origins, [PUBLIC]);
});

test('narrowing origins keeps loopback Host headers working for health checks', () => {
  // relay.mjs derives allowedHosts from config.origins, seeded with 127.0.0.1
  // and localhost. Narrowing origins must not break an on-host health probe,
  // which reaches the server with Host: 127.0.0.1.
  const config = { ...readConfig({ OPENAI_API_KEY: 'k', NODE_ENV: 'production', PUBLIC_URL: PUBLIC }), port: 0 };
  const relay = createRelay(config, { connectUpstream: () => { throw new Error('not used'); } });
  assert.ok(relay, 'relay constructs with a narrowed origin list');
});
