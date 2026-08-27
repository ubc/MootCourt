import { MongoClient } from 'mongodb';

/**
 * MongoDB connection for Moot Court.
 *
 * Follows the shape GRASP uses (src/services/database.js): one singleton, an
 * idempotent connect(), indexes built at startup, and credentials masked before
 * anything reports the connection string.
 *
 * Unlike GRASP, a missing database is not fatal. Moot Court ran with no
 * persistence at all before this, and it still must when SHOW_LOGIN is off and
 * no MONGODB_URI is configured — a developer with no Docker gets the courtroom,
 * just no saved sessions. Startup refuses the combination that would be unsafe
 * (login on, database missing) in config.validateConfig instead.
 */
class DatabaseService {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.connectionUri = null;
  }

  /**
   * @returns {Promise<import('mongodb').Db|null>} null when no URI is configured.
   */
  async connect(mongoConfig) {
    if (this.db) return this.db;
    if (!mongoConfig?.uri) return null;

    try {
      this.client = new MongoClient(mongoConfig.uri, {
        connectTimeoutMS: mongoConfig.connectTimeoutMS,
        serverSelectionTimeoutMS: mongoConfig.serverSelectionTimeoutMS,
      });
      await this.client.connect();
      this.db = this.client.db(mongoConfig.dbName);
      this.isConnected = true;
      this.connectionUri = mongoConfig.uri;
      console.log(`MongoDB connected: ${mongoConfig.dbName}`);
      await this.initializeCollections();
      return this.db;
    } catch (error) {
      if (this.client) {
        await this.client.close().catch(() => {});
        this.client = null;
      }
      this.db = null;
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Indexes are created here rather than by a migration step so a fresh
   * database — a new laptop, a CI container, a new staging environment — is
   * correct after one startup.
   */
  async initializeCollections() {
    // PUID is the primary identity for a CWL user, the same choice BiocBot
    // makes. Partial filter because anonymous-mode rows have no PUID at all and
    // a plain unique index would collide them all on null.
    await this.db.collection('users').createIndex(
      { puid: 1 },
      { unique: true, partialFilterExpression: { puid: { $type: 'string' } } },
    );
    await this.db.collection('users').createIndex({ userId: 1 }, { unique: true });

    // Practice sessions are read two ways: "my past sessions" for one student,
    // and a chronological sweep for instructors.
    await this.db.collection('practice_sessions').createIndex({ sessionId: 1 }, { unique: true });
    await this.db.collection('practice_sessions').createIndex({ userId: 1, startedAt: -1 });
    await this.db.collection('practice_sessions').createIndex({ startedAt: -1 });

    console.log('MongoDB indexes ready');
  }

  async disconnect() {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  getDb() {
    return this.db;
  }

  getCollection(name) {
    if (!this.isConnected) throw new Error('Database not connected');
    return this.db.collection(name);
  }

  getConnectionInfo() {
    return {
      connected: this.isConnected,
      // Never let a password reach a log line or a health response.
      uri: this.connectionUri ? this.connectionUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : null,
    };
  }
}

export const databaseService = new DatabaseService();
export default databaseService;
