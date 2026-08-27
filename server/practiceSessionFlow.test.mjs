import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readConfig } from './config.mjs';
import { createApp } from './app.mjs';

// Exercises the sequence App.tsx performs: open a session on entering the
// courtroom, then write the transcript on reaching the assessment page. This
// existed as an API before but nothing called it, so a real practice run saved
// nothing — these assertions cover the wiring, not just the endpoints.

const memory = { sessions: new Map() };

// Minimal in-memory stand-in for the two collections the routes touch, so the
// flow can be tested without a MongoDB running.
function fakeDb() {
  return {
    collection: () => ({
      insertOne: async doc => { memory.sessions.set(doc.sessionId, { ...doc }); return { insertedId: '1' }; },
      findOne: async filter => {
        const found = memory.sessions.get(filter.sessionId);
        if (!found) return null;
        if (filter.anonymous !== undefined && found.anonymous !== filter.anonymous) return null;
        return found;
      },
      findOneAndUpdate: async (filter, update) => {
        const found = memory.sessions.get(filter.sessionId);
        if (!found) return null;
        Object.assign(found, update.$set);
        return found;
      },
      find: () => ({ project: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }),
      createIndex: async () => {},
    }),
  };
}

async function withServer(run) {
  memory.sessions.clear();
  const config = readConfig({});
  const db = fakeDb();
  const app = await createApp(config, {
    getDb: () => db,
    getConnectionInfo: () => ({ connected: true, uri: null }),
    client: null,
  });
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('a full practice run is stored: open on entry, transcript on completion', async () => {
  await withServer(async base => {
    // App.tsx: Landing -> Scene
    const started = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerPosition: 'Appellant', settings: { totalTime: 1500, isInteliJudge: true } }),
    });
    assert.equal(started.status, 201);
    const { sessionId } = await started.json();

    // App.tsx: Scene -> EndPage, with what AudioComponent accumulated on config
    const saved = await fetch(`${base}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation: [
          { role: 'user', content: 'May it please the court' },
          { role: 'assistant', content: 'Counsel, where are you in your factum?' },
        ],
        runningTimestamps: [['May it please the court', 1200]],
        wordCount: 5,
        judgeElapsedTime: 4200,
        ended: true,
      }),
    });
    assert.equal(saved.status, 200);

    const stored = memory.sessions.get(sessionId);
    assert.equal(stored.playerPosition, 'Appellant');
    assert.equal(stored.conversation.length, 2);
    assert.equal(stored.runningTimestamps.length, 1);
    assert.equal(stored.judgeElapsedTime, 4200);
    assert.ok(stored.endedAt, 'completing a run must stamp endedAt');
    // Anonymous mode: recorded, but not attributable.
    assert.equal(stored.anonymous, true);
    assert.equal(stored.userId, null);
    assert.equal(stored.puid, null);
  });
});

test('an abandoned run leaves the opened session with no transcript', async () => {
  await withServer(async base => {
    const { sessionId } = await (await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerPosition: 'Respondent' }),
    })).json();

    const stored = memory.sessions.get(sessionId);
    assert.equal(stored.endedAt, null);
    assert.deepEqual(stored.conversation, []);
  });
});
