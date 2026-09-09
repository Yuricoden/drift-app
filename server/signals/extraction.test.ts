import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryCollection, STORE_NAMES, type Store } from '../db';
import { createExtractionService, evidenceRevision } from './extraction';
import { toSignal } from '../llm/extract';
import { LlmError } from '../llm/openrouter';
import { momentumLabel, signalAssociations } from '../../shared/signals';
import type { Evidence } from '../../shared/types';

const fixture = (): Store => Object.assign({ kind: 'memory' as const }, Object.fromEntries(STORE_NAMES.map(name => [name, memoryCollection()]))) as unknown as Store;
export const evidence = (n: number): Evidence => ({ source: 'web', provider: 'perplexity-sonar', title: `Source ${n}`, url: `https://example.com/${n}`, snippet: `Observed repair behavior ${n}`, metrics: {}, date: null, reason: null });

test('75 evidence revisions: bounded batches, failure preservation, resume, duplicate requests and owner isolation', async () => {
  const store = fixture();
  const sources = Array.from({ length: 75 }, (_, n) => ({ evidence: evidence(n) }));
  await store.trendTopics.insertOne({ owner: 'a', sources });
  await store.trendTopics.insertOne({ owner: 'b', sources: [{ evidence: evidence(99) }] });
  const sizes: number[] = []; let fail = true;
  const merged: string[] = [];
  const service = createExtractionService({ store: async () => store, merge: async (owner, s) => { assert.equal(owner, 'a'); merged.push(s.id); }, extract: async input => {
    sizes.push(input.evidence.length);
    await new Promise(resolve => setTimeout(resolve, 5));
    if (sizes.length === 2 && fail) throw new Error('batch failure');
    return [toSignal({ name: `Signal ${input.evidence[0].url}`, summary: 'Observation', industries: [] }, 0, 1, input.evidence)];
  } });
  assert.equal((await service.status('a')).pendingEvidence, 75);
  assert.equal(sizes.length, 0, 'status is read-only');
  await Promise.all(Array.from({ length: 12 }, () => service.start('a')));
  await service.waitForIdle('a');
  assert.deepEqual(sizes, [30, 30, 15]);
  const partial = await service.status('a');
  assert.equal(partial.processedEvidence, 45); assert.equal(partial.pendingEvidence, 30);
  assert.equal(partial.failures.length, 1); assert.equal(merged.length, 2);
  assert.equal((await service.status('b')).processedEvidence, 0);
  fail = false;
  await service.start('a'); await service.waitForIdle('a');
  assert.deepEqual(sizes, [30, 30, 15, 30]);
  assert.equal((await service.status('a')).state, 'complete');
  await service.start('a'); await service.waitForIdle('a');
  assert.equal(sizes.length, 4, 'processed revisions never regenerate on duplicate requests');
  const changed = evidence(0); changed.snippet = 'Revised evidence';
  await store.trendTopics.updateOne({ owner: 'a' }, { sources: [{ evidence: changed }, ...sources.slice(1)] });
  assert.equal((await service.status('a')).pendingEvidence, 1);
  await service.start('a'); await service.waitForIdle('a');
  assert.equal(sizes.at(-1), 1);
});

test('credentials and rate limits stop remaining extraction batches; old topics are unavailable', async () => {
  for (const kind of ['credentials', 'rate_limited'] as const) {
    const store = fixture(); let calls = 0;
    await store.trendTopics.insertOne({ owner: 'a', sources: Array.from({ length: 65 }, (_, n) => ({ evidence: evidence(n) })) });
    await store.trendTopics.insertOne({ owner: 'a', sources: [{ url: 'https://example.com/legacy' }] });
    const service = createExtractionService({ store: async () => store, extract: async () => { calls++; throw new LlmError(kind, kind); } });
    await service.start('a'); await service.waitForIdle('a');
    assert.equal(calls, 1); assert.equal((await service.status('a')).pendingEvidence, 65);
    assert.equal((await service.status('a')).unavailableTopics, 1);
  }
});

test('missing classifications and absent measurements remain unknown; map includes only valid undirected associations', () => {
  const signal = toSignal({ name: 'Repair', industries: ['unknown'] }, 0, 1, [evidence(0)]);
  assert.deepEqual(signal.industries, []); assert.equal(momentumLabel(signal), 'Not measured');
  assert.equal(signal.momentum, null); assert.deepEqual(signal.path, []);
  assert.deepEqual(signalAssociations([signal]), []);
  signal.industries = ['retail', 'retail', 'invalid'];
  assert.deepEqual(signalAssociations([signal]), [{ signalId: signal.id, industryId: 'retail', label: 'AI-classified association' }]);
  const e = evidence(0);
  assert.equal(evidenceRevision(e), evidenceRevision({ ...e, metrics: {} }));
  assert.notEqual(evidenceRevision(e), evidenceRevision({ ...e, snippet: 'revision' }));
});
