import { randomUUID } from 'node:crypto';

/**
 * A saved moot court practice run.
 *
 * This is the data AssessmentPage already computes against but previously only
 * held in React state: the conversation turns and the word-level timing array
 * that drives the speaking-rate plot. Persisting it is what lets a student
 * reopen an assessment after the tab closes.
 *
 * Identity is deliberately optional. With SHOW_LOGIN off, userId and puid are
 * null and `anonymous` is true — the row records a practice run that happened,
 * with no way back to a person.
 *
 * Document shape:
 * {
 *   sessionId:         String,   // unique, server-generated
 *   userId:            String|null,
 *   puid:              String|null,
 *   anonymous:         Boolean,
 *   playerPosition:    String,   // 'Appellant' | 'Respondent'
 *   startedAt:         Date,
 *   endedAt:           Date|null,
 *   judgeElapsedTime:  Number,   // ms of judge speech
 *   wordCount:         Number,
 *   conversation:      [{ role, content, at }],
 *   runningTimestamps: [[word, startTime, endTime]],
 *   settings:          { questionInterval, totalTime, isInteliJudge, ... }
 * }
 */

const COLLECTION = 'practice_sessions';
const MAX_TIMESTAMPS = 100000;
const MAX_CONVERSATION_TURNS = 2000;

/**
 * Trims the two unbounded arrays before they reach MongoDB. A 10-minute turn
 * produces a large timing array, and the 16MB document ceiling is a silent
 * failure mode at the end of a session — exactly when the data matters most.
 */
function boundArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.length > limit ? value.slice(-limit) : value;
}

function normalizePosition(position) {
  return position === 'Respondent' ? 'Respondent' : 'Appellant';
}

export async function createSession(db, { identity, playerPosition, settings }) {
  const now = new Date();
  const session = {
    sessionId: `session_${randomUUID()}`,
    userId: identity?.userId || null,
    puid: identity?.puid || null,
    anonymous: !identity?.userId,
    playerPosition: normalizePosition(playerPosition),
    startedAt: now,
    endedAt: null,
    judgeElapsedTime: 0,
    wordCount: 0,
    conversation: [],
    runningTimestamps: [],
    settings: settings || {},
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(COLLECTION).insertOne(session);
  return session;
}

/**
 * Writes the transcript and timing data collected during a run.
 *
 * Scoped by identity as well as sessionId: with login on, the filter includes
 * userId so one student cannot write into another's session by guessing an id.
 */
export async function saveSessionData(db, sessionId, identity, data) {
  const filter = { sessionId };
  if (identity?.userId) filter.userId = identity.userId;
  else filter.anonymous = true;

  const update = { updatedAt: new Date() };
  if (Array.isArray(data.conversation)) {
    update.conversation = boundArray(data.conversation, MAX_CONVERSATION_TURNS);
  }
  if (Array.isArray(data.runningTimestamps)) {
    update.runningTimestamps = boundArray(data.runningTimestamps, MAX_TIMESTAMPS);
  }
  if (Number.isFinite(data.judgeElapsedTime)) update.judgeElapsedTime = data.judgeElapsedTime;
  if (Number.isFinite(data.wordCount)) update.wordCount = data.wordCount;
  if (data.ended) update.endedAt = new Date();

  const result = await db.collection(COLLECTION).findOneAndUpdate(
    filter,
    { $set: update },
    { returnDocument: 'after' },
  );
  return result || null;
}

export async function getSession(db, sessionId, identity) {
  const filter = { sessionId };
  if (identity?.userId) filter.userId = identity.userId;
  else filter.anonymous = true;
  return db.collection(COLLECTION).findOne(filter);
}

/**
 * Past sessions for one person. Returns nothing in anonymous mode: with no
 * identity there is no defensible way to decide which rows belong to a caller.
 */
export async function listSessionsForUser(db, identity, limit = 25) {
  if (!identity?.userId) return [];
  return db.collection(COLLECTION)
    .find({ userId: identity.userId })
    .project({ conversation: 0, runningTimestamps: 0 })
    .sort({ startedAt: -1 })
    .limit(Math.min(Number(limit) || 25, 100))
    .toArray();
}
