import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DocCollection } from '../db';

// Durable fallback for local, single-process deployments. MongoDB is used for
// multiple server workers. Serialize read-modify-write operations by file path.
const queues = new Map<string, Promise<unknown>>();

export function fileCollection<T extends Record<string, unknown>>(path: string): DocCollection<T> {
  function transaction<R>(mutating: boolean, fn: (docs: T[]) => R): Promise<R> {
    const pending = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(async () => {
      let docs: T[];
      try {
        docs = JSON.parse(await readFile(path, 'utf8')) as T[];
        if (!Array.isArray(docs)) throw new Error('Invalid research storage.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        docs = [];
      }
      const result = fn(docs);
      if (mutating) {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(docs), { mode: 0o600 });
        await rename(temporary, path);
      }
      return result;
    });
    queues.set(path, pending);
    return pending;
  }
  const matches = (doc: T, filter: Partial<T>) => Object.entries(filter).every(([key, value]) => doc[key] === value);
  return {
    findOne: (filter) => transaction(false, (docs) => docs.find((doc) => matches(doc, filter)) ?? null),
    find: (filter = {}) => transaction(false, (docs) => docs.filter((doc) => matches(doc, filter))),
    insertOne: (doc) => transaction(true, (docs) => { docs.push(doc); }),
    insertIfAbsent: (filter, doc) => transaction(true, (docs) => {
      if (!docs.some((item) => matches(item, filter))) docs.push(doc);
    }),
    compareAndSet: (filter, set) => transaction(true, (docs) => {
      const index = docs.findIndex((doc) => matches(doc, filter));
      if (index < 0) return false;
      docs[index] = { ...docs[index], ...set };
      return true;
    }),
    updateOne: (filter, set, upsert = false) => transaction(true, (docs) => {
      const index = docs.findIndex((doc) => matches(doc, filter));
      if (index >= 0) docs[index] = { ...docs[index], ...set };
      else if (upsert) docs.push({ ...filter, ...set } as T);
    }),
    deleteOne: (filter) => transaction(true, (docs) => {
      const index = docs.findIndex((doc) => matches(doc, filter));
      if (index < 0) return 0;
      docs.splice(index, 1);
      return 1;
    }),
    deleteMany: (filter) => transaction(true, (docs) => {
      let removed = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], filter)) { docs.splice(i, 1); removed++; }
      }
      return removed;
    }),
  };
}
