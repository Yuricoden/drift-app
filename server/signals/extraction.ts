import { createHash, randomUUID } from 'node:crypto';
import { getStore, type Store } from '../db.js';
import { extractSignals } from '../llm/extract.js';
import { mergeSignal } from '../repos.js';
import type { Evidence, ExtractionStatus, TrendTopic } from '../../shared/types.js';

export const EXTRACTION_VERSION = 'saved-evidence-v2';
const LEASE_MS = 5 * 60 * 1000;
interface State {
  owner: string; token: string; leaseUntil: number; processed: string[];
  failures: ExtractionStatus['failures']; updatedAt: string | null;
}
interface Deps { store: () => Promise<Store>; extract: typeof extractSignals; merge: typeof mergeSignal; now: () => number }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const evidenceRevision = (e: Evidence) => createHash('sha256').update(EXTRACTION_VERSION + stable(e)).digest('hex');

/** Durable owner lease; successful batches checkpoint independently. GETs never claim work. */
export function createExtractionService(overrides: Partial<Deps> = {}) {
  const deps = { store: getStore, extract: extractSignals, merge: mergeSignal, now: Date.now, ...overrides };
  const jobs = new Map<string, Promise<number>>();
  async function input(owner: string) {
    const store = await deps.store();
    const topics = await store.trendTopics.find({ owner }) as TrendTopic[];
    const all = topics.flatMap(t => t.sources.flatMap(s => s.evidence ? [s.evidence] : []));
    const evidence = [...new Map(all.map(e => [evidenceRevision(e), e])).entries()].sort(([a], [b]) => a.localeCompare(b));
    return { evidence, topics, store };
  }
  async function status(owner: string): Promise<ExtractionStatus> {
    const { evidence, topics, store } = await input(owner);
    const state = await store.extractionStates.findOne({ owner }) as State | null;
    const processed = new Set(state?.processed ?? []);
    const processedEvidence = evidence.filter(([r]) => processed.has(r)).length;
    const running = !!state?.token && state.leaseUntil > deps.now();
    const failures = [...(state?.failures ?? [])];
    if (state?.token && !running) failures.push({ evidenceRevisions: [], kind: 'interrupted', message: 'Analysis was interrupted. Analyze saved research to resume pending batches.' });
    return {
      state: running ? 'running' : !evidence.length ? (topics.length ? 'unavailable' : 'idle') : failures.length ? (processedEvidence ? 'partial' : 'failed') : processedEvidence === evidence.length ? 'complete' : 'idle',
      topicCount: topics.length, totalEvidence: evidence.length, processedEvidence,
      pendingEvidence: evidence.length - processedEvidence,
      unavailableTopics: topics.filter(t => !t.sources.some(s => s.evidence)).length,
      failures, updatedAt: state?.updatedAt ?? null, analysisVersion: EXTRACTION_VERSION,
    };
  }
  async function work(owner: string, token: string, previous: State): Promise<number> {
    const { evidence, store } = await input(owner);
    const processed = new Set(previous.processed);
    const pending = evidence.filter(([r]) => !processed.has(r));
    const failures: ExtractionStatus['failures'] = [];
    let count = 0;
    try {
      for (let offset = 0; offset < pending.length; offset += 30) {
        const batch = pending.slice(offset, offset + 30);
        if (!await store.extractionStates.compareAndSet({ owner, token }, { leaseUntil: deps.now() + LEASE_MS })) break;
        try {
          const signals = await deps.extract({ query: 'Analyze saved Trend Research evidence', answer: '', evidence: batch.map(([, e]) => e) });
          if (!await store.extractionStates.compareAndSet({ owner, token }, { leaseUntil: deps.now() + LEASE_MS })) break;
          for (const signal of signals) await deps.merge(owner, signal);
          batch.forEach(([r]) => processed.add(r));
          count += signals.length;
        } catch (error) {
          const kind = String((error as { kind?: string }).kind ?? 'unavailable');
          failures.push({ evidenceRevisions: batch.map(([r]) => r), kind, message: error instanceof Error ? error.message : 'Batch failed. Saved results are retained.' });
          if (['credentials', 'rate_limited', 'budget', 'cancelled'].includes(kind)) break;
        }
        await store.extractionStates.compareAndSet({ owner, token }, { processed: [...processed], failures, updatedAt: new Date(deps.now()).toISOString() });
      }
    } finally {
      await store.extractionStates.compareAndSet({ owner, token }, { token: '', leaseUntil: 0, processed: [...processed], failures, updatedAt: new Date(deps.now()).toISOString() });
    }
    return count;
  }

  async function start(owner: string): Promise<ExtractionStatus> {
    const store = await deps.store();
    await store.extractionStates.insertIfAbsent({ owner }, { owner, token: '', leaseUntil: 0, processed: [], failures: [], updatedAt: null });
    const previous = await store.extractionStates.findOne({ owner }) as State;
    if (previous.token && previous.leaseUntil > deps.now()) return status(owner);
    const token = randomUUID();
    if (!await store.extractionStates.compareAndSet({ owner, token: previous.token, leaseUntil: previous.leaseUntil }, { token, leaseUntil: deps.now() + LEASE_MS, failures: [] })) return status(owner);
    const heartbeat = setInterval(() => { void store.extractionStates.compareAndSet({ owner, token }, { leaseUntil: deps.now() + LEASE_MS }).catch(() => {}); }, 30000);
    const job = work(owner, token, previous).finally(() => { clearInterval(heartbeat); jobs.delete(owner); });
    jobs.set(owner, job);
    void job.catch(() => {});
    return status(owner);
  }
  async function waitForIdle(owner: string): Promise<number> {
    if (jobs.has(owner)) return jobs.get(owner)!;
    // Another Mongo worker may own the lease. Waiting is read-only and keeps
    // Start Research's follow-up from missing evidence saved after that claim.
    while ((await status(owner)).state === 'running') await new Promise(resolve => setTimeout(resolve, 1000));
    return 0;
  }
  return { status, start, waitForIdle };
}
export const extraction = createExtractionService();
export async function extractSignalsFromTopics(owner: string): Promise<number> {
  await extraction.start(owner);
  return extraction.waitForIdle(owner);
}
