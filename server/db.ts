import { MongoClient, type Db } from 'mongodb';
import { env } from './env';
import { fileCollection } from './trends/file-store';
import { resolve } from 'node:path';

/**
 * A minimal document-store abstraction over MongoDB with an in-memory
 * fallback so the app can boot without a connection string (with a loud
 * warning — the fallback never persists across restarts).
 */
export interface DocCollection<T extends Record<string, unknown>> {
  findOne(filter: Partial<T>): Promise<T | null>;
  find(filter?: Partial<T>): Promise<T[]>;
  insertOne(doc: T): Promise<void>;
  updateOne(filter: Partial<T>, set: Partial<T>, upsert?: boolean): Promise<void>;
  deleteOne(filter: Partial<T>): Promise<number>;
  deleteMany(filter: Partial<T>): Promise<number>;
  insertIfAbsent(filter: Partial<T>, doc: T): Promise<void>;
  compareAndSet(filter: Partial<T>, set: Partial<T>): Promise<boolean>;
}

export interface Store {
  kind: 'mongo' | 'memory';
  profiles: DocCollection<any>;
  sessions: DocCollection<any>;
  saved: DocCollection<any>;
  transfers: DocCollection<any>;
  opportunities: DocCollection<any>;
  conversations: DocCollection<any>;
  trendStates: DocCollection<any>;
  trendTopics: DocCollection<any>;
  trendUsage: DocCollection<any>;
  signals: DocCollection<any>;
  extractionStates: DocCollection<any>;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => doc[key] === value);
}

/** Used in test fixture helper to build a correct in-memory store. */
export const STORE_NAMES = ['profiles', 'sessions', 'saved', 'transfers', 'opportunities', 'conversations', 'trendStates', 'trendTopics', 'trendUsage', 'signals', 'extractionStates'] as const;

export function memoryCollection<T extends Record<string, unknown>>(): DocCollection<T> {
  const docs: T[] = [];
  return {
    async insertIfAbsent(filter, doc) {
      if (!docs.some((d) => matches(d, filter))) docs.push(structuredClone(doc));
    },
    async compareAndSet(filter, set) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index < 0) return false;
      docs[index] = { ...docs[index], ...set };
      return true;
    },
    async findOne(filter) {
      return docs.find((d) => matches(d, filter)) ?? null;
    },
    async find(filter = {}) {
      return docs.filter((d) => matches(d, filter));
    },
    async insertOne(doc) {
      docs.push(doc);
    },
    async updateOne(filter, set, upsert = false) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index >= 0) {
        docs[index] = { ...docs[index], ...set };
      } else if (upsert) {
        docs.push({ ...filter, ...set } as T);
      }
    },
    async deleteOne(filter) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index < 0) return 0;
      docs.splice(index, 1);
      return 1;
    },
    async deleteMany(filter) {
      let removed = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], filter)) {
          docs.splice(i, 1);
          removed++;
        }
      }
      return removed;
    },
  };
}

function mongoCollection<T extends Record<string, unknown>>(db: Db, name: string): DocCollection<T> {
  const col = db.collection(name);
  return {
    async insertIfAbsent(filter, doc) {
      try {
        await col.updateOne(filter, { $setOnInsert: doc }, { upsert: true });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    },
    async compareAndSet(filter, set) {
      const result = await col.updateOne(filter, { $set: set });
      return result.matchedCount === 1;
    },
    async findOne(filter) {
      const doc = await col.findOne(filter);
      if (!doc) return null;
      const { _id, ...rest } = doc;
      return rest as T;
    },
    async find(filter = {}) {
      const docs = await col.find(filter).toArray();
      return docs.map(({ _id, ...rest }) => rest as T);
    },
    async insertOne(doc) {
      await col.insertOne(doc as Record<string, unknown>);
    },
    async updateOne(filter, set, upsert = false) {
      await col.updateOne(filter, { $set: set }, { upsert });
    },
    async deleteOne(filter) {
      const res = await col.deleteOne(filter);
      return res.deletedCount;
    },
    async deleteMany(filter) {
      const res = await col.deleteMany(filter);
      return res.deletedCount;
    },
  };
}

let storePromise: Promise<Store> | null = null;

export function getStore(): Promise<Store> {
  if (!storePromise) storePromise = createStore();
  return storePromise;
}

async function createStore(): Promise<Store> {
  if (!env.mongoUri) {
    return {
      kind: 'memory',
      profiles: memoryCollection(),
      sessions: memoryCollection(),
      saved: memoryCollection(),
      transfers: memoryCollection(),
      opportunities: memoryCollection(),
      conversations: memoryCollection(),
      trendStates: fileCollection(resolve(env.researchDataDir, 'states.json')),
      trendTopics: fileCollection(resolve(env.researchDataDir, 'topics.json')),
      trendUsage: fileCollection(resolve(env.researchDataDir, 'usage.json')),
      signals: fileCollection(resolve(env.researchDataDir, 'signals.json')),
      extractionStates: fileCollection(resolve(env.researchDataDir, 'extraction.json')),
    };
  }
  const client = new MongoClient(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(env.mongoDb);
  await Promise.all([
    db.collection('sessions').createIndex({ token: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('profiles').createIndex({ owner: 1 }, { unique: true }),
    db.collection('saved').createIndex({ owner: 1, type: 1, refId: 1 }, { unique: true }),
    db.collection('transfers').createIndex({ owner: 1, createdAt: -1 }),
    db.collection('opportunities').createIndex({ owner: 1, createdAt: -1 }),
    db.collection('conversations').createIndex({ owner: 1, updatedAt: -1 }),
    db.collection('trend_states').createIndex({ owner: 1 }, { unique: true }),
    db.collection('trend_topics').createIndex({ owner: 1, id: 1 }, { unique: true }),
    db.collection('trend_usage').createIndex({ month: 1 }, { unique: true }),
    db.collection('extraction_states').createIndex({ owner: 1 }, { unique: true }),
    db.collection('signals').createIndex({ owner: 1, id: 1 }, { unique: true }),
  ]);
  console.log(`[drift] Connected to MongoDB (${env.mongoDb}).`);
  return {
    kind: 'mongo',
    profiles: mongoCollection(db, 'profiles'),
    sessions: mongoCollection(db, 'sessions'),
    saved: mongoCollection(db, 'saved'),
    transfers: mongoCollection(db, 'transfers'),
    opportunities: mongoCollection(db, 'opportunities'),
    conversations: mongoCollection(db, 'conversations'),
    trendStates: mongoCollection(db, 'trend_states'),
    trendTopics: mongoCollection(db, 'trend_topics'),
    trendUsage: mongoCollection(db, 'trend_usage'),
    signals: mongoCollection(db, 'signals'),
    extractionStates: mongoCollection(db, 'extraction_states'),
  };
}
