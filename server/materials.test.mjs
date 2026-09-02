import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { once } from 'node:events';
import { readConfig } from './config.mjs';
import { chunkText } from './rag/chunking.mjs';
import { collectionNameFor } from './rag/qdrant.mjs';
import { createMaterialsRouter } from './routes/materials.mjs';
import { createBrief, addDocument, pruneExpiredBriefs } from './models/brief.mjs';
import { IngestError } from './rag/ingest.mjs';

// Covers the parts of the materials feature that are easy to get quietly wrong:
// the brief filter that separates one student's uploads from another's, and what
// happens when half of a two-store write succeeds.

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const materialsEnv = {
  OPENAI_API_KEY: 'test-only-key',
  QDRANT_URL: 'http://127.0.0.1:6333',
  MATERIALS_MAX_FILES: '2',
  MATERIALS_MAX_FILE_BYTES: '2048',
};

// --- chunking --------------------------------------------------------------

test('chunks break on paragraphs, overlap, and never split a word', () => {
  const paragraphs = Array.from({ length: 10 }, (_, i) => `Para${i + 1}. ${'Short sentence here. '.repeat(4)}`);
  const chunks = chunkText(paragraphs.join('\n\n'), { size: 400, overlap: 120, min: 50 });

  assert.ok(chunks.length > 1 && chunks.length < paragraphs.length, 'paragraphs are grouped, not one chunk each');
  assert.equal(new Set(chunks.map(chunk => chunk.text)).size, chunks.length, 'no chunk is emitted twice');
  for (let i = 1; i < chunks.length; i += 1) {
    const previous = chunks[i - 1].text.split('\n\n');
    const current = chunks[i].text.split('\n\n');
    assert.ok(current.some(paragraph => previous.includes(paragraph)), `chunk ${i} carries context from ${i - 1}`);
  }
  // Every paragraph survives somewhere, so no content is lost between chunks.
  const all = chunks.map(chunk => chunk.text).join('\n\n');
  for (const paragraph of paragraphs) assert.ok(all.includes(paragraph.trim()));
});

test('a paragraph longer than the target is cut on word boundaries', () => {
  const [chunk] = chunkText('word '.repeat(400), { size: 300, overlap: 0, min: 10 });
  assert.ok(chunk.text.length <= 300);
  assert.ok(!/\bwor$|^ord\b/.test(chunk.text), 'no word was cut in half');
});

test('a document too short to meet the minimum is kept rather than dropped', () => {
  assert.deepEqual(chunkText('One line.', { min: 500 }), [{ text: 'One line.', index: 0 }]);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

// --- configuration ---------------------------------------------------------

test('uploads stay off until Qdrant is configured, and refuse to guess a vector size', () => {
  assert.equal(readConfig({ OPENAI_API_KEY: 'k' }).materials.enabled, false, 'no QDRANT_URL means off');
  assert.equal(readConfig({ QDRANT_URL: 'http://x' }).materials.enabled, false, 'no API key means off');
  assert.equal(readConfig({ QDRANT_URL: 'http://x', MATERIALS_STUB: '1' }).materials.enabled, true, 'stub needs no key');
  assert.throws(
    () => readConfig({ QDRANT_URL: 'http://x', OPENAI_API_KEY: 'k', OPENAI_EMBEDDING_MODEL: 'unknown-model' }),
    /QDRANT_VECTOR_SIZE/,
  );
});

test('collections are separated by embedding model and by stub mode', () => {
  const real = collectionNameFor('m', 'text-embedding-3-small', 1536, false);
  assert.notEqual(real, collectionNameFor('m', 'text-embedding-3-large', 3072, false), 'models do not share vectors');
  assert.notEqual(real, collectionNameFor('m', 'text-embedding-3-small', 1536, true), 'stub vectors are kept apart');
});

// --- brief ownership -------------------------------------------------------

/** In-memory stand-in for the briefs collection, matching the fakeDb in practiceSessionFlow.test.mjs. */
function fakeDb() {
  const rows = new Map();
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (key.startsWith('documents.')) {
      const index = Number(key.split('.')[1]);
      return value.$exists === false ? row.documents.length <= index : row.documents.length > index;
    }
    if (value && typeof value === 'object' && '$ne' in value) return row[key] !== value.$ne && row[key] <= value.$lte;
    return row[key] === value;
  });
  const find = filter => [...rows.values()].find(row => matches(row, filter)) || null;
  return {
    rows,
    collection: () => ({
      insertOne: async doc => { rows.set(doc.briefId, { ...doc }); return { insertedId: doc.briefId }; },
      findOne: async filter => find(filter),
      deleteOne: async filter => { const row = find(filter); if (row) rows.delete(row.briefId); return { deletedCount: row ? 1 : 0 }; },
      find: filter => ({ project: () => ({}), limit: () => ({ toArray: async () => [...rows.values()].filter(row => matches(row, filter)) }) }),
      findOneAndUpdate: async (filter, update) => {
        const row = find(filter);
        if (!row) return null;
        if (update.$push?.documents) row.documents.push(update.$push.documents);
        if (update.$pull?.documents) {
          row.documents = row.documents.filter(document => document.documentId !== update.$pull.documents.documentId);
        }
        Object.assign(row, update.$set);
        return row;
      },
      createIndex: async () => {},
    }),
  };
}

test('a brief cannot be read or grown by someone else', async () => {
  const db = fakeDb();
  const mine = await createBrief(db, { identity: { userId: 'u1' }, title: 'Mine', retentionDays: 0 });
  const document = { documentId: 'd1', filename: 'f.pdf', text: 'x', characterCount: 1, chunkCount: 1, describedImageCount: 0 };

  assert.ok(await addDocument(db, mine.briefId, { userId: 'u1' }, document), 'the owner can add to their own brief');
  assert.equal(await addDocument(db, mine.briefId, { userId: 'u2' }, document), null, 'another user cannot');
  assert.equal(await addDocument(db, mine.briefId, null, document), null, 'an anonymous caller cannot');
});

test('expiring a brief removes its vectors as well as its text', async () => {
  const db = fakeDb();
  const deleted = [];
  const brief = await createBrief(db, { identity: null, title: 'Old', retentionDays: 7 });
  db.rows.get(brief.briefId).expiresAt = new Date(Date.now() - 1000);

  const removed = await pruneExpiredBriefs(db, { deleteBrief: async id => { deleted.push(id); } });
  assert.equal(removed, 1);
  assert.deepEqual(deleted, [brief.briefId], 'Qdrant was told too — a MongoDB TTL alone would orphan the vectors');
  assert.equal(db.rows.size, 0);
});

// --- routes ----------------------------------------------------------------

async function withRoutes(run, { ingest, addDocumentFails = false } = {}) {
  const config = readConfig(materialsEnv);
  const db = fakeDb();
  if (addDocumentFails) {
    const real = db.collection;
    db.collection = () => ({ ...real(), findOneAndUpdate: async () => { throw new Error('brief is full'); } });
  }

  const store = { deleted: [], deleteDocument: async (b, d) => { store.deleted.push(`${b}/${d}`); }, deleteBrief: async b => { store.deleted.push(b); } };
  const app = express();
  app.use(createMaterialsRouter(config, { getDb: () => db }, {
    store,
    providers: { stub: true },
    ingest: ingest || (async ({ originalName }) => ({
      documentId: 'doc_1', text: `text of ${originalName}`, chunkCount: 3, describedImageCount: 2, characterCount: 42,
    })),
  }));

  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, store, db });
  } finally {
    server.close();
  }
}

const upload = (base, briefId, { name = 'f.docx', type = DOCX, bytes = 64 } = {}) => {
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
  return fetch(`${base}/api/materials/briefs/${briefId}/documents`, { method: 'POST', body });
};

const newBrief = async base =>
  (await (await fetch(`${base}/api/materials/briefs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).json()).brief.briefId;

test('upload indexes a file, lists it without its text, and serves the text on request', async () => {
  await withRoutes(async ({ base }) => {
    const briefId = await newBrief(base);
    const response = await upload(base, briefId);
    assert.equal(response.status, 201);

    const { brief, document } = await response.json();
    assert.equal(document.describedImageCount, 2, 'image descriptions are reported to the student');
    assert.equal(brief.documents.length, 1);
    assert.equal('text' in brief.documents[0], false, 'the list view never carries document text');

    const text = await (await fetch(`${base}/api/materials/briefs/${briefId}/documents/doc_1/text`)).json();
    assert.equal(text.text, 'text of f.docx');
  });
});

test('files that are not a PDF or Word document, or are too large, are refused by kind', async () => {
  await withRoutes(async ({ base }) => {
    const briefId = await newBrief(base);
    assert.equal((await upload(base, briefId, { name: 'notes.txt', type: 'text/plain' })).status, 415);
    assert.equal((await upload(base, briefId, { bytes: 4096 })).status, 413);
  });
});

test('an upload against someone else\'s or a missing brief is a 404, not a new brief', async () => {
  await withRoutes(async ({ base, db }) => {
    assert.equal((await upload(base, 'brief_does_not_exist')).status, 404);
    assert.equal(db.rows.size, 0);
  });
});

test('indexing failures are reported as retryable or not, and leave nothing stored', async () => {
  const permanent = async () => { throw new IngestError('No text could be read from that file.'); };
  await withRoutes(async ({ base }) => {
    const briefId = await newBrief(base);
    const response = await upload(base, briefId);
    assert.equal(response.status, 422, 'a file that cannot be read is the student\'s problem to fix');
    assert.match((await response.json()).error, /No text could be read/);

    const { brief } = await (await fetch(`${base}/api/materials/briefs/${briefId}`)).json();
    assert.equal(brief.documents.length, 0);
  }, { ingest: permanent });

  const transient = async () => { throw new IngestError('Qdrant is unreachable', { retryable: true }); };
  await withRoutes(async ({ base }) => {
    const briefId = await newBrief(base);
    assert.equal((await upload(base, briefId)).status, 502, 'a broken index is the server\'s problem, and retryable');
  }, { ingest: transient });
});

test('vectors are removed when the database write that should have recorded them fails', async () => {
  await withRoutes(async ({ base, store }) => {
    const briefId = await newBrief(base);
    const response = await upload(base, briefId);
    assert.equal(response.status, 409);
    // Without this the brief would keep answering the judge's searches with a
    // document the student cannot see listed and cannot delete.
    assert.deepEqual(store.deleted, [`${briefId}/doc_1`]);
  }, { addDocumentFails: true });
});

test('deleting a document clears it from both stores', async () => {
  await withRoutes(async ({ base, store }) => {
    const briefId = await newBrief(base);
    await upload(base, briefId);
    const response = await fetch(`${base}/api/materials/briefs/${briefId}/documents/doc_1`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).brief.documents, []);
    assert.deepEqual(store.deleted, [`${briefId}/doc_1`]);
  });
});
