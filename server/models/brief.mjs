import { randomUUID } from 'node:crypto';

/**
 * A brief: the set of materials a student uploads before one practice run.
 *
 * Scoping is per brief rather than per practice session because the upload
 * happens before the student enters the courtroom, and the practice session row
 * is not created until they do (see App.tsx). The brief is created at upload,
 * and its id is attached to the practice session when the run starts — so the
 * two are still linked, without moving a session lifecycle that is careful
 * about not orphaning rows.
 *
 * What is stored, and what is not:
 *   - The extracted text IS stored, because the "view uploaded text" modal
 *     reads it and re-parsing would mean re-paying for image description.
 *   - The original .pdf/.docx is NOT stored anywhere. It exists in memory
 *     during the request and in a temp file during parsing, and is gone after.
 *   - The chunk vectors live in Qdrant keyed by this briefId, which is why
 *     deleting a brief has to delete from both stores.
 *
 * Document shape:
 * {
 *   briefId:    String,   // unique, server-generated
 *   userId:     String|null,
 *   puid:       String|null,
 *   anonymous:  Boolean,
 *   title:      String,
 *   documents:  [{ documentId, filename, mimeType, size, characterCount,
 *                  chunkCount, describedImageCount, text, uploadedAt }],
 *   createdAt:  Date,
 *   updatedAt:  Date,
 *   expiresAt:  Date|null  // swept by pruneExpiredBriefs; null = keep
 * }
 */

const COLLECTION = 'briefs';

/** Guards the 16MB document ceiling: a long thesis plus image descriptions adds up. */
const MAX_TEXT_CHARS = 2_000_000;
const MAX_DOCUMENTS_PER_BRIEF = 10;

/** Same identity rule the practice sessions use: no login means no owner column. */
function ownerFilter(identity) {
  return identity?.userId ? { userId: identity.userId } : { anonymous: true };
}

export async function createBrief(db, { identity, title, retentionDays }) {
  const now = new Date();
  const brief = {
    briefId: `brief_${randomUUID()}`,
    userId: identity?.userId || null,
    puid: identity?.puid || null,
    anonymous: !identity?.userId,
    title: String(title || 'Practice materials').slice(0, 200),
    documents: [],
    createdAt: now,
    updatedAt: now,
    expiresAt: retentionDays > 0 ? new Date(now.getTime() + retentionDays * 86400000) : null,
  };
  await db.collection(COLLECTION).insertOne(brief);
  return brief;
}

export async function getBrief(db, briefId, identity) {
  return db.collection(COLLECTION).findOne({ briefId, ...ownerFilter(identity) });
}

/** The list view never needs the full text, and sending it would be megabytes. */
export async function getBriefSummary(db, briefId, identity) {
  return db.collection(COLLECTION).findOne(
    { briefId, ...ownerFilter(identity) },
    { projection: { 'documents.text': 0 } },
  );
}

/**
 * Appends an ingested document.
 *
 * Returns null when the brief does not exist or is not the caller's, so a
 * mistyped or guessed briefId cannot grow someone else's brief.
 */
export async function addDocument(db, briefId, identity, document) {
  const brief = await db.collection(COLLECTION).findOne(
    { briefId, ...ownerFilter(identity) },
    { projection: { documents: { $slice: 0 } } },
  );
  if (!brief) return null;

  const result = await db.collection(COLLECTION).findOneAndUpdate(
    {
      briefId,
      ...ownerFilter(identity),
      [`documents.${MAX_DOCUMENTS_PER_BRIEF - 1}`]: { $exists: false },
    },
    {
      $push: {
        documents: {
          documentId: document.documentId,
          filename: String(document.filename || 'document').slice(0, 260),
          mimeType: document.mimeType,
          size: document.size,
          characterCount: document.characterCount,
          chunkCount: document.chunkCount,
          describedImageCount: document.describedImageCount,
          text: String(document.text || '').slice(0, MAX_TEXT_CHARS),
          uploadedAt: new Date(),
        },
      },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: 'after', projection: { 'documents.text': 0 } },
  );
  // The filter matched the brief but not the size guard: it is already full.
  if (!result) throw new Error(`A brief holds at most ${MAX_DOCUMENTS_PER_BRIEF} documents.`);
  return result;
}

export async function removeDocument(db, briefId, identity, documentId) {
  return db.collection(COLLECTION).findOneAndUpdate(
    { briefId, ...ownerFilter(identity) },
    { $pull: { documents: { documentId } }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after', projection: { 'documents.text': 0 } },
  );
}

export async function deleteBrief(db, briefId, identity) {
  const result = await db.collection(COLLECTION).deleteOne({ briefId, ...ownerFilter(identity) });
  return result.deletedCount > 0;
}

/**
 * Deletes briefs past their retention window from MongoDB and Qdrant together.
 *
 * A MongoDB TTL index would be simpler but would delete only half of a brief:
 * the vectors are in Qdrant and nothing in MongoDB can reach them, so expired
 * thesis text would keep answering searches indefinitely. The sweep therefore
 * drives the deletion from here and removes both.
 *
 * @returns {Promise<number>} How many briefs were removed.
 */
export async function pruneExpiredBriefs(db, store) {
  const expired = await db.collection(COLLECTION)
    .find({ expiresAt: { $ne: null, $lte: new Date() } }, { projection: { briefId: 1 } })
    .limit(200)
    .toArray();

  let removed = 0;
  for (const { briefId } of expired) {
    try {
      // Vectors first: a brief with no MongoDB row and stale vectors is
      // unreachable and unauditable, while the reverse is merely retryable.
      await store.deleteBrief(briefId);
      await db.collection(COLLECTION).deleteOne({ briefId });
      removed += 1;
    } catch (error) {
      console.warn(`Could not prune expired brief ${briefId}: ${error.message}`);
    }
  }
  return removed;
}

export const __testing = { COLLECTION, MAX_DOCUMENTS_PER_BRIEF, ownerFilter };
