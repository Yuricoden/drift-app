import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSignals, toSignal } from './extract';
import { LlmError, type Gateway } from './openrouter';
import { ResearchError } from '../research/errors';
import { createExtractionService, evidenceRevision } from '../signals/extraction';
import { memoryCollection, STORE_NAMES, type Store } from '../db';
import type { Evidence } from '../../shared/types';

const source = (n = 0): Evidence => ({ source: 'web', provider: 'perplexity-sonar', title: `Source ${n}`, url: `https://example.com/${n}`, snippet: 'Observed US repair behavior.', metrics: {}, date: null, reason: null });
const draft = (evidenceUrls: unknown = [source().url]) => ({ name: 'Repair gatherings', summary: 'People meet to repair items.', evidenceUrls });
function mock(content: string | Error) {
  let calls = 0;
  const gateway: Gateway = {
    chat: async () => {
      calls++;
      if (content instanceof Error) throw content;
      return { content, citations: [], provider: 'test', model: 'test', generationId: null, promptTokens: 0, completionTokens: 0, cost: 0, toolCalls: [] };
    },
    chatStream: async () => { throw new Error('Unexpected streaming request'); },
  };
  return { gateway, calls: () => calls };
}
const input = { query: 'Saved research', answer: '', evidence: [source(), source(1)] };

test('mixed citations keep only exact supplied evidence without retrying or adding fabricated metrics', async () => {
  const provider = mock(JSON.stringify({ signals: [{ ...draft([
    source().url, source().url, 'https://invented.example/claim', `${source(1).url}/`, source(1).url,
    null, 1, { url: source().url },
  ]), momentum: 99, momentumEvidence: [{ slope12Month: 99 }] }] }));
  const signals = await extractSignals(input, provider);
  assert.equal(signals.length, 1);
  assert.deepEqual(signals[0].evidence, input.evidence);
  assert.equal(signals[0].sourceCount, 2);
  assert.equal(signals[0].momentum, null);
  assert.deepEqual(signals[0].momentumEvidence, []);
  assert.equal(provider.calls(), 1);
});

test('unsupported signals are omitted while valid neighbors survive', async () => {
  const provider = mock(JSON.stringify({ signals: [
    draft(['https://invented.example/claim']), draft([]), draft('not an array'),
    { ...draft(), name: ' ' }, draft(),
  ] }));
  const signals = await extractSignals(input, provider);
  assert.equal(signals.length, 1);
  assert.deepEqual(signals[0].evidence, [source()]);
  assert.equal(provider.calls(), 1);
});

test('valid response with all entries rejected is a successful empty extraction', async () => {
  for (const entries of [
    [draft(['https://invented.example/claim']), draft([`${source().url}/`]), draft([])],
    [{ summary: 'No name' }, { name: 'No summary' }, { ...draft(), summary: ' ' }],
    [null, false, 'not a signal', []], [],
  ]) {
    const provider = mock(JSON.stringify({ signals: entries }));
    assert.deepEqual(await extractSignals(input, provider), []);
    assert.equal(provider.calls(), 1);
  }
});

test('malformed responses still fail instead of being mistaken for all-rejected signals', async () => {
  for (const response of ['not JSON', '{"signals": [', '{}', '{"signals": null}', '{"signals": [] broken}', 'null']) {
    const provider = mock(response);
    await assert.rejects(() => extractSignals(input, provider), (e: unknown) => e instanceof ResearchError && /invalid response/.test(e.message));
    assert.equal(provider.calls(), 1);
  }
});

test('provider failures propagate; credentials/rate limits do not retry, transient errors retry once', async () => {
  for (const kind of ['credentials', 'rate_limited', 'timeout', 'transient'] as const) {
    const error = new LlmError(kind, 'Mock provider failure');
    const provider = mock(error);
    await assert.rejects(() => extractSignals(input, provider), e => e === error);
    assert.equal(provider.calls(), ['timeout', 'transient'].includes(kind) ? 2 : 1);
  }
});

test('resume preserves 44 processed revisions and saved signals; all-rejected batches finish and genuine failures stay pending', async () => {
  for (const outcome of ['mixed', 'all-rejected', 'malformed', 'credentials', 'storage'] as const) {
    const store = Object.assign({ kind: 'memory' as const }, Object.fromEntries(STORE_NAMES.map(name => [name, memoryCollection()]))) as unknown as Store;
    const evidence = Array.from({ length: 74 }, (_, n) => source(n));
    const processed = evidence.slice(0, 44).map(evidenceRevision);
    await store.trendTopics.insertOne({ owner: 'a', sources: evidence.map(e => ({ evidence: e })) });
    for (let i = 0; i < 6; i++) await store.trendTopics.insertOne({ owner: 'a', sources: [{ url: `https://example.com/legacy-${i}` }] });
    await store.extractionStates.insertOne({ owner: 'a', token: '', leaseUntil: 0, processed, updatedAt: null,
      failures: [{ evidenceRevisions: evidence.slice(44).map(evidenceRevision), kind: 'invalid', message: 'Extraction cited evidence not supplied. Batch remains pending.' }] });
    const previous = { owner: 'a', ...toSignal({ name: 'Previously saved', summary: 'Existing findings' }, 0, 1, [source()]) };
    await store.signals.insertOne(previous);
    let calls = 0;
    const service = createExtractionService({
      store: async () => store,
      extract: async batch => {
        calls++;
        assert.equal(batch.evidence.length, 30);
        assert.ok(batch.evidence.every(e => !processed.includes(evidenceRevision(e))));
        const response = outcome === 'malformed' ? '{"signals": [] broken}'
          : outcome === 'credentials' ? new LlmError('credentials', 'Mock credentials failure')
          : JSON.stringify({ signals: [draft(outcome === 'all-rejected' ? ['https://invented.example/claim'] : [batch.evidence[0].url, 'https://invented.example/claim']), draft([])] });
        return extractSignals(batch, mock(response));
      },
      merge: async (owner, signal) => {
        if (outcome === 'storage') throw new Error('Mock storage failure');
        await store.signals.updateOne({ owner, id: signal.id }, { owner, ...signal }, true);
      },
    });
    const initial = await service.status('a');
    assert.equal(initial.processedEvidence, 44);
    assert.equal(initial.pendingEvidence, 30);
    assert.equal(calls, 0, 'reading status cannot retry analysis');
    await service.start('a');
    await service.waitForIdle('a');
    const status = await service.status('a');
    const success = outcome === 'mixed' || outcome === 'all-rejected';
    assert.equal(status.state, success ? 'complete' : 'partial', outcome);
    assert.equal(status.processedEvidence, success ? 74 : 44, outcome);
    assert.equal(status.pendingEvidence, success ? 0 : 30, outcome);
    assert.equal(status.unavailableTopics, 6);
    assert.equal(status.failures.length, success ? 0 : 1);
    if (!success) assert.doesNotMatch(status.failures[0].message, /Extraction cited evidence not supplied/);
    assert.deepEqual(await store.signals.findOne({ owner: 'a', id: previous.id }), previous);
    assert.equal((await store.signals.find({ owner: 'a' })).length, outcome === 'mixed' ? 2 : 1);
    assert.equal(calls, 1);
    if (success) {
      await service.start('a'); await service.waitForIdle('a');
      assert.equal(calls, 1, 'completed batches are not analyzed again');
    }
  }
});
