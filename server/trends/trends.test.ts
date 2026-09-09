import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCollection, type Store } from '../db';
import { ResearchError, type ResearchResult } from '../llm/research';
import { createTrendService } from './service';
import { canonicalUrl, parseTopics, sourceChannel } from './topics';
import { buildSynthesisPrompt, evidenceBrief, synthesizeTopics } from './synthesize';
import { retrieveChannelEvidence, searchQuery, trendTerms } from './retrieve';
import { fileCollection } from './file-store';
import type { TrendChannel } from '../../shared/types';

const prefs = { completed: true, completedAt: null, interests: ['Wellness'], exploring: ['Startups'], purposes: ['Find startup ideas'] };
const now = '2026-09-08T12:00:00.000Z';
const url = 'https://www.reddit.com/r/example/comments/123/community';
function result(title = 'Neighborhood repair clubs', source = url): ResearchResult {
  return {
    answer: JSON.stringify({ topics: [{ title, summary: 'US communities discuss repairing goods [1].', usRelevance: 'US neighborhood communities.', whyUseful: 'A recurring service need for local founders.',
      opportunity: { concept: 'Test a local repair membership.', audience: 'US households.', firstStep: 'Interview five local residents.' }, sourceUrls: [source] }] }),
    citations: [{ url: source, title: 'Public discussion', content: 'Provider excerpt' }],
    evidence: [{ source: 'reddit', provider: 'openrouter-reddit', reason: null, title: 'Public discussion', url: source, snippet: 'Provider excerpt', metrics: { subreddit: 'example', kind: 'post', usBasis: 'Explicit US context in the indexed discussion; author location is unverified.' }, date: null }],
    providers: [{ provider: 'openrouter-reddit', reason: null, attempts: 1, status: 'complete' }], reason: null,
    provider: 'openrouter-reddit', fallbackReason: null, insufficientEvidence: false,
    primaryCost: 0.006, fallbackCost: null, totalCost: 0.006,
  };
}

/**
 * Default stage stubs. Retrieval yields Reddit evidence for every channel, which
 * is exactly the cross-channel case coverage must downgrade to "limited".
 */
function stages(overrides: { retrieve?: (channel: TrendChannel) => Promise<ResearchResult>; synthesize?: (channel: TrendChannel, research: ResearchResult) => Promise<ResearchResult> } = {}) {
  return {
    analyze: async () => {},
    retrieve: overrides.retrieve ?? (async () => result()),
    synthesize: overrides.synthesize ?? (async (_channel: TrendChannel, research: ResearchResult) => research),
  };
}

function store(): Store {
  return Object.fromEntries(['profiles', 'sessions', 'saved', 'transfers', 'opportunities', 'conversations', 'trendStates', 'trendTopics', 'trendUsage']
    .map((name) => [name, memoryCollection()]).concat([['kind', 'memory'] as any])) as Store;
}

test('only citation-backed URLs become evidence; spoofed platform names do not', () => {
  const research = result();
  const parsed = JSON.parse(research.answer);
  parsed.topics[0].sourceUrls.push('https://fabricated.example/article', 'javascript:alert(1)');
  research.answer = JSON.stringify(parsed);
  const topics = parseTopics(research, now);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].sources.length, 1);
  assert.equal(topics[0].sources[0].channel, 'reddit');
  assert.equal(sourceChannel('https://reddit.com.evil.example/a'), 'web');
  assert.equal(sourceChannel('https://www.business.reddit.com/blog/research'), 'web', 'Reddit marketing reports are not community comments');
  assert.equal(sourceChannel('https://trends.google.com.evil.example/a'), 'web');
  assert.equal(canonicalUrl('https://example.com/a?utm_source=test&id=2'), 'https://example.com/a?id=2');
  parsed.topics[0].sourceUrls = ['https://fabricated.example/article'];
  assert.deepEqual(parseTopics({ ...research, answer: JSON.stringify(parsed) }, now), []);
});

test('rejects malformed JSON and never creates topics from an uncited response', () => {
  assert.throws(() => parseTopics({ ...result(), answer: 'Not JSON' }, now), /unreadable/);
  assert.deepEqual(parseTopics({ ...result(), citations: [], insufficientEvidence: true }, now), []);
});

const CHANNEL_URLS: Record<TrendChannel, string> = {
  reddit: 'https://www.reddit.com/r/example/comments/123/community',
  youtube: 'https://www.youtube.com/watch?v=abc123456',
  'google-trends': 'https://trends.google.com/trends/explore?q=wellness&geo=US',
  web: 'https://example.com/us-consumer-report',
};
/** A retrieval result whose cited evidence belongs to the channel itself. */
const channelResult = (channel: TrendChannel): ResearchResult => result('A finding', CHANNEL_URLS[channel]);

function gatewayReturning(content: string, cost = 0.002) {
  const captured: any[] = [];
  return {
    captured,
    gateway: {
      chat: async (options: any) => {
        captured.push(options);
        return { content, citations: [], provider: 'test', model: 'test', generationId: null, promptTokens: 0, completionTokens: 0, cost, toolCalls: [] };
      },
      chatStream: async () => { throw new Error('Synthesis never streams'); },
    },
  };
}

test('synthesis prompt states the real retrieval window, US-only scope, interests and channel limits', () => {
  const prompt = buildSynthesisPrompt('youtube', result(), prefs, new Date(now));
  assert.match(prompt, /2026-08-09 to 2026-09-08/);
  assert.match(prompt, /United States only/);
  assert.match(prompt, /Wellness/);
  assert.match(prompt, /Do not invent views/);
  assert.match(prompt, /no browsing access/i);
  assert.match(prompt, /reddit\.com\/r\/example\/comments\/123/, 'only retrieved URLs may be cited');
  const trends = buildSynthesisPrompt('google-trends', result(), prefs, new Date(now));
  assert.match(trends, /12 months ending 2026-09-08/);
  assert.match(trends, /Never invent search volume/);
});

test('each channel retrieves from its own provider and nothing else', async () => {
  const seen: string[] = [];
  const deps = {
    web: async (q: string) => { seen.push(`web|${q}`); return result(); },
    reddit: async (q: string) => { seen.push(`reddit|${q}`); return result(); },
    youtube: async (q: string) => { seen.push(`youtube|${q}`); return result(); },
    trends: async (q: string) => { seen.push(`trends|${q}`); return result(); },
  };
  for (const channel of ['web', 'reddit', 'youtube', 'google-trends'] as TrendChannel[]) {
    await retrieveChannelEvidence(channel, prefs, new Date(now), deps);
  }
  assert.deepEqual(seen.map((entry) => entry.split('|')[0]), ['web', 'reddit', 'youtube', 'trends']);
  assert.match(seen[1], /United States/, 'Reddit retrieval carries explicit US context');
  assert.equal(seen[3].split('|')[1], 'Wellness', 'Google Trends is measured one interest term at a time');
});

test('Trends retrieval measures one term per request and reports a missing interest instead of guessing', async () => {
  const terms: string[] = [];
  const deps = { trends: async (q: string) => { terms.push(q); return result(); } };
  await retrieveChannelEvidence('google-trends', { ...prefs, interests: ['Repair cafés', 'Cold plunges, saunas', 'x', 'Wellness'] }, new Date(now), deps);
  assert.deepEqual(terms, ['Repair cafés', 'Wellness'], 'comma comparisons and stubs are skipped, capped at two terms');
  const empty = await retrieveChannelEvidence('google-trends', { ...prefs, interests: [] }, new Date(now), deps);
  assert.equal(empty.evidence.length, 0);
  assert.match(empty.providers[0].reason!, /no-interest-terms/);
  assert.equal(terms.length, 2, 'no request is made without a term');
});

test('synthesis is skipped when retrieval found nothing, so no model call is spent', async () => {
  const { gateway, captured } = gatewayReturning('{"topics":[]}');
  const empty = { ...result(), evidence: [], citations: [], insufficientEvidence: true };
  const out = await synthesizeTopics('reddit', empty, prefs, new Date(now), { gateway });
  assert.equal(captured.length, 0);
  assert.deepEqual(out.evidence, []);
});

test('the analysis model sees provider metrics verbatim, cannot search, and costs are summed', async () => {
  const trendsResult: ResearchResult = {
    ...result(), evidence: [{
      source: 'trends', provider: 'serpapi-trends', reason: null, date: null,
      title: 'Repair cafés — US search interest, past 12 months',
      url: 'https://trends.google.com/trends/explore?q=repair+cafes&geo=US',
      snippet: 'Relative 0–100 index.',
      metrics: { trends: { term: 'repair cafés', geo: 'US', range: 'today 12-m',
        timeline: [{ date: '2025-09-08T00:00:00.000Z', timestamp: 1, value: 40 }],
        slope12Month: 4.3482, slopeUnit: 'index-points-per-month',
        relatedQueries: [{ query: 'repair cafe near me', url: 'https://trends.google.com/x', kind: 'rising', label: '+4,200%', risingPercent: 4200, breakout: false, interest: null }] } },
    }],
  };
  const brief = evidenceBrief(trendsResult.evidence);
  assert.match(brief, /4\.3482 index points per month/);
  assert.match(brief, /repair cafe near me \(\+4200%\)/);
  const { gateway, captured } = gatewayReturning('{"topics":[]}');
  const out = await synthesizeTopics('google-trends', trendsResult, prefs, new Date(now), { gateway });
  assert.equal(captured[0].plugins, undefined, 'synthesis performs no web search');
  assert.match(captured[0].user, /4\.3482 index points per month/);
  assert.equal(out.totalCost, 0.008, 'retrieval and synthesis cost are reported together');
});

test('concurrent manual refreshes perform one pull; legacy automatic entry does not research', async () => {
  const db = store();
  let calls = 0;
  const deps = { store: async () => db, configured: () => true, now: () => new Date(now), budget: () => 75,
    ...stages({ retrieve: async () => { calls++; return result(); } }) };
  const service = createTrendService(deps);
  await Promise.all(Array.from({ length: 12 }, () => service.start('owner', 'refresh', prefs)));
  await service.waitForIdle('owner');
  assert.equal(calls, 4);
  assert.equal((await service.feed('owner')).topics.length, 1, 'same topic is merged across searches');
  await createTrendService(deps).start('owner', 'initial', prefs);
  assert.equal(calls, 4, 'persisted initialization prevents a new automatic pull');
  assert.equal((await service.feed('someone-else')).topics.length, 0, 'research stays owner-scoped');
});

test('manual refresh updates existing findings, adds new ones, and retains earlier evidence', async () => {
  const db = store();
  let clock = new Date(now);
  let round = 0;
  const service = createTrendService({ store: async () => db, configured: () => true, budget: () => 75, now: () => clock,
    ...stages({ retrieve: async () => round === 0 ? result() : result('Neighborhood repair clubs', 'https://example.com/new-evidence') }) });
  await service.start('owner', 'refresh', prefs);
  await service.waitForIdle('owner');
  round++;
  clock = new Date(clock.getTime() + 61000);
  await service.start('owner', 'refresh', prefs);
  await service.waitForIdle('owner');
  const feed = await service.feed('owner');
  assert.equal(feed.topics.length, 1);
  assert.equal(feed.topics[0].sources.length, 2);
  assert.equal(feed.topics[0].firstFoundAt, now);
  assert.equal(feed.topics[0].lastFoundAt, clock.toISOString());
});

test('partial platform failures preserve other findings and report missing coverage', async () => {
  const db = store();
  let calls = 0;
  const service = createTrendService({ store: async () => db, configured: () => true, budget: () => 75,
    ...stages({ retrieve: async () => { if (++calls === 2) throw new ResearchError('unavailable', 'down'); return result(); } }) });
  await service.start('owner', 'refresh', prefs);
  await service.waitForIdle('owner');
  const feed = await service.feed('owner');
  assert.equal(feed.state.status, 'partial');
  assert.equal(feed.state.coverage[1].status, 'failed');
  assert.equal(feed.state.coverage[2].status, 'limited', 'a Reddit URL cannot masquerade as Google Trends data');
  assert.equal(feed.topics.length, 1);
});

test('budget reserves before spending and stops subsequent calls', async () => {
  const db = store();
  let calls = 0;
  const service = createTrendService({ store: async () => db, configured: () => true, budget: () => 0.049,
    ...stages({ retrieve: async () => { calls++; return result(); } }) });
  await service.start('owner', 'refresh', prefs);
  await service.waitForIdle('owner');
  assert.equal(calls, 0);
  assert.equal((await service.feed('owner')).state.status, 'failed');
  await service.start('owner', 'initial', prefs);
  assert.equal(calls, 0, 'a failed pull is not retried on entry');
});

test('credential failures stop the batch instead of trying all four searches', async () => {
  const db = store();
  let calls = 0;
  const service = createTrendService({ store: async () => db, configured: () => true, budget: () => 75,
    ...stages({ retrieve: async () => { calls++; throw new ResearchError('credentials', 'bad key'); } }) });
  await service.start('owner', 'refresh', prefs);
  await service.waitForIdle('owner');
  assert.equal(calls, 1);
  assert.equal((await service.feed('owner')).state.status, 'failed');
});

test('a SerpApi credential failure blocks only the SerpApi channels', async () => {
  const db = store();
  const ran: TrendChannel[] = [];
  const service = createTrendService({ store: async () => db, configured: () => true, budget: () => 75, now: () => new Date(now),
    ...stages({ retrieve: async (channel) => {
      ran.push(channel);
      if (channel === 'youtube') throw new ResearchError('credentials', 'bad SerpApi key', 'serpapi-youtube');
      return result();
    } }) });
  await service.start('owner', 'refresh', prefs);
  await service.waitForIdle('owner');
  const feed = await service.feed('owner');
  assert.deepEqual(ran, ['reddit', 'youtube', 'web'], 'Google Trends is skipped but OpenRouter channels still run');
  assert.equal(feed.state.coverage[1].status, 'failed');
  assert.match(feed.state.coverage[1].note!, /SerpApi credentials need attention \(SERPAPI_API_KEY\)/);
  assert.match(feed.state.coverage[2].note!, /^Not searched:/);
  assert.equal(feed.state.status, 'partial');
});

test('a channel is complete only when its own provider returned the cited evidence', async () => {
  const db = store();
  const service = createTrendService({ store: async () => db, configured: () => true, budget: () => 75, now: () => new Date(now),
    ...stages({ retrieve: async (channel) => channelResult(channel) }) });
  await service.start('owner', 'refresh', prefs);
  await service.waitForIdle('owner');
  const feed = await service.feed('owner');
  assert.deepEqual(feed.state.coverage.map((c) => c.status), ['complete', 'complete', 'complete', 'complete']);
  assert.equal(feed.state.status, 'complete');
  assert.equal(feed.topics[0].sources.length, 4, 'one finding corroborated by all four channels');
});

test('an interrupted job becomes manually retryable without automatic spending', async () => {
  const db = store();
  await db.trendStates.insertOne({ owner: 'owner', initialized: true, status: 'running', runId: 'old', startedAt: '2026-01-01T00:00:00Z', lastPulledAt: null, coverage: [], error: null });
  let calls = 0;
  const service = createTrendService({ store: async () => db, now: () => new Date(now), configured: () => true,
    ...stages({ retrieve: async () => { calls++; return result(); } }) });
  const feed = await service.start('owner', 'initial', prefs);
  assert.equal(feed.state.status, 'failed');
  assert.equal(calls, 0);
});

test('disk fallback persists across instances and serializes concurrent claims', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'drift-research-test-'));
  try {
    const path = join(directory, 'states.json');
    const collection = fileCollection<any>(path);
    await collection.insertIfAbsent({ owner: 'owner' }, { owner: 'owner', initialized: false });
    const claims = await Promise.all(Array.from({ length: 10 }, () => fileCollection<any>(path).compareAndSet({ owner: 'owner', initialized: false }, { initialized: true })));
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await fileCollection<any>(path).findOne({ owner: 'owner' }))?.initialized, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Start Research awaits server-side saved-evidence analysis even without a page client', async () => {
  const db = store(); let analyzed = 0; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = createTrendService({ store: async () => db, configured: () => true, budget: () => 75, ...stages(),
    analyze: async owner => { assert.equal(owner, 'job-owner'); analyzed++; assert.ok((await db.trendTopics.find({ owner })).length); await gate; } });
  const started = await service.start('job-owner', 'refresh', prefs);
  assert.equal(started.state.status, 'running');
  while (!analyzed) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await service.feed('job-owner')).state.status, 'running');
  release(); await service.waitForIdle('job-owner');
  assert.equal(analyzed, 1); assert.equal((await service.feed('job-owner')).state.status, 'complete');
  await service.feed('job-owner'); assert.equal(analyzed, 1, 'reading never starts analysis');
});

test('first account entry only reads saved research and makes no research calls', async () => {
 const db = store(); let calls = 0;
 const service = createTrendService({ store: async () => db, configured: () => true, ...stages({ retrieve: async () => { calls++; return result(); } }) });
 const feed = await service.start('new-owner', 'initial', prefs);
 assert.equal(calls, 0); assert.equal(feed.state.status, 'idle');
});
