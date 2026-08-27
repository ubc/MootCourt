import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readConfig, validateConfig } from './config.mjs';
import { createApp } from './app.mjs';

// SHOW_LOGIN off is the state this will be deployed in while the PIA is
// pending. These tests exist to prove that in that state there is no reachable
// path that receives or stores CWL data — not merely that the UI hides a button.

const noDatabase = {
  getDb: () => null,
  getConnectionInfo: () => ({ connected: false, uri: null }),
  client: null,
};

async function withApp(env, run) {
  const config = readConfig(env);
  const app = await createApp(config, noDatabase);
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base, config);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('the flag is off unless explicitly enabled', () => {
  const off = ['', undefined, 'false', 'False', 'no', '0', 'yes', 'TRUE ish'];
  for (const value of off) {
    assert.equal(readConfig({ SHOW_LOGIN: value }).auth.showLogin, false, `SHOW_LOGIN=${value}`);
  }
});

test('true, True, TRUE and 1 all enable login', () => {
  for (const value of ['true', 'True', 'TRUE', '1', ' true ']) {
    assert.equal(readConfig({ SHOW_LOGIN: value }).auth.showLogin, true, `SHOW_LOGIN=${value}`);
  }
});

test('login mode refuses to start without a database, secret, IdP and certificate', () => {
  const problems = validateConfig(readConfig({ SHOW_LOGIN: 'true' }));
  assert.equal(problems.length, 4);
  assert.ok(problems.some(p => p.includes('MONGODB_URI')));
  assert.ok(problems.some(p => p.includes('SESSION_SECRET')));
  assert.ok(problems.some(p => p.includes('SAML_ENTRY_POINT')));
  assert.ok(problems.some(p => p.includes('SAML_CERT_PATH')));
});

test('anonymous mode reports no login and offers no login URL', async () => {
  await withApp({}, async base => {
    const response = await fetch(`${base}/api/auth/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { showLogin: false, loginUrl: null, provider: null });
  });
});

test('anonymous mode does not expose the CWL routes at all', async () => {
  await withApp({}, async base => {
    // Not merely unauthorized — the routes are never mounted, so there is no
    // endpoint that could receive a SAML assertion.
    for (const path of ['/auth/login', '/auth/saml/callback', '/api/auth/me']) {
      const response = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.equal(response.status, 404, `${path} should not exist`);
    }

    const posted = await fetch(`${base}/auth/saml/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'SAMLResponse=abc',
      redirect: 'manual',
    });
    assert.equal(posted.status, 404);
  });
});

test('anonymous mode issues no session cookie', async () => {
  await withApp({}, async base => {
    const response = await fetch(`${base}/api/auth/config`);
    assert.equal(response.headers.get('set-cookie'), null);
  });
});

test('health reports the login mode and never leaks database credentials', async () => {
  await withApp({}, async base => {
    const body = await (await fetch(`${base}/api/health`)).json();
    assert.equal(body.showLogin, false);
    assert.equal(body.database.connected, false);
    assert.equal(body.database.uri, null);
  });
});

test('a configured connection string is masked before it is reported', async () => {
  const masked = {
    getDb: () => null,
    getConnectionInfo: () => ({
      connected: true,
      uri: 'mongodb://mongoadmin:secret@127.0.0.1:27017/mootcourt_dev'.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'),
    }),
    client: null,
  };
  const app = await createApp(readConfig({}), masked);
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json();
    assert.ok(!body.database.uri.includes('secret'), 'password must not appear');
    assert.match(body.database.uri, /\/\/\*\*\*:\*\*\*@/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
