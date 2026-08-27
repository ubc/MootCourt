import session from 'express-session';
import MongoStore from 'connect-mongo';

/**
 * Session cookie backed by MongoDB.
 *
 * The store is MongoDB rather than memory so sessions survive a restart and so
 * a future multi-process deployment does not log everyone out on every request
 * that lands on the wrong worker — the same reasoning BiocBot and GRASP use.
 *
 * Only created when SHOW_LOGIN is on; anonymous mode issues no cookie at all.
 */
export function createSessionMiddleware(config, mongoClient) {
  const { auth, mongo } = config;

  return session({
    secret: auth.sessionSecret,
    resave: false,
    // Do not persist a session row for a visitor who never logs in.
    saveUninitialized: false,
    store: MongoStore.create({
      client: mongoClient,
      dbName: mongo.dbName,
      collectionName: 'sessions',
      ttl: auth.sessionTtlHours * 60 * 60,
      touchAfter: 3600,
    }),
    cookie: {
      // Secure only in production: the local IdP runs over plain HTTP, and a
      // secure cookie there would be dropped and the login would loop.
      secure: auth.secureCookie,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: auth.sessionTtlHours * 60 * 60 * 1000,
    },
    name: 'mootcourt.sid',
  });
}
