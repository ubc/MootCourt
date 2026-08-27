import { randomUUID } from 'node:crypto';

/**
 * CWL user records.
 *
 * Every document here exists only because SHOW_LOGIN was on when the person
 * logged in. In anonymous mode this collection is never written to and never
 * read, because the routes that call it are not mounted.
 *
 * Document shape:
 * {
 *   userId:        String,    // internal id; what the session cookie carries
 *   puid:          String,    // ubcEduCwlPuid — the CWL identifier, unique
 *   cwlLoginName:  String,    // CWL username, e.g. 'bio_student'
 *   email:         String,
 *   displayName:   String,
 *   givenName:     String,
 *   surname:       String,
 *   affiliations:  [String],  // eduPersonAffiliation as released by the IdP
 *   role:          String,    // 'student' | 'instructor', derived from affiliation
 *   samlNameId:    String,    // transient nameID, kept for single logout
 *   authProvider:  'cwl',
 *   isActive:      Boolean,
 *   lastLogin:     Date,
 *   createdAt:     Date,
 *   updatedAt:     Date
 * }
 */

const COLLECTION = 'users';

/** The subset that may travel to the browser. */
export function toPublicUser(user) {
  if (!user) return null;
  return {
    userId: user.userId,
    puid: user.puid,
    cwlLoginName: user.cwlLoginName,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    authProvider: user.authProvider,
  };
}

/**
 * Upserts the person behind a CWL login, keyed on PUID.
 *
 * Attributes are refreshed on every login because a name can change and an
 * affiliation can change — a student who becomes faculty must pick up the
 * instructor role without an administrator editing the database.
 */
export async function createOrUpdateCwlUser(db, cwlProfile) {
  const collection = db.collection(COLLECTION);
  const now = new Date();

  const existing = await collection.findOne({ puid: cwlProfile.puid });

  const attributes = {
    cwlLoginName: cwlProfile.cwlLoginName,
    email: cwlProfile.email,
    displayName: cwlProfile.displayName,
    givenName: cwlProfile.givenName,
    surname: cwlProfile.surname,
    affiliations: cwlProfile.affiliations,
    role: cwlProfile.role,
    samlNameId: cwlProfile.samlNameId,
    lastLogin: now,
    updatedAt: now,
  };

  if (existing) {
    await collection.updateOne({ puid: cwlProfile.puid }, { $set: attributes });
    return { ...existing, ...attributes };
  }

  const user = {
    userId: `user_${randomUUID()}`,
    puid: cwlProfile.puid,
    authProvider: 'cwl',
    isActive: true,
    createdAt: now,
    ...attributes,
  };
  await collection.insertOne(user);
  return user;
}

export async function getUserById(db, userId) {
  if (!userId) return null;
  return db.collection(COLLECTION).findOne({ userId, isActive: true });
}

export async function getUserByPuid(db, puid) {
  if (!puid) return null;
  return db.collection(COLLECTION).findOne({ puid, isActive: true });
}
