import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchYoutube, researchTrends, calculateSlope } from './serpapi';
import { collectResearch, parseSources } from './collect';
import { ResearchError } from './errors';
import { extractSignals } from '../llm/extract';
import { buildTools } from '../chat/tools';
import { runAgent } from '../chat/agent';
import type { Gateway, ChatOptions } from '../llm/openrouter';

const videoUrl = 'https://www.youtube.com/watch?v=abc123456';
const videos = {
  ads_results: [{ title: 'Sponsored repair', link: 'https://www.youtube.com/watch?v=AD0000001', published_date: '1 day ago' }],
  video_results: [
    { position_on_page: 1, title: 'US repair cafés are spreading', link: `${videoUrl}&list=PL1`, video_id: 'abc123456',
      channel: { name: 'Repair Collective', link: 'https://www.youtube.com/@repaircollective', verified: true },
      views: 21375, published_date: '18 hours ago', length: '9:28', description: 'A United States tour of community repair events.' },
    { title: 'Undated video', link: 'https://www.youtube.com/watch?v=nodate0001', channel: { name: 'Unknown' }, views: 5 },
    { title: 'Old video', link: 'https://www.youtube.com/watch?v=old0000001', published_date: '2 years ago', views: 900 },
    { title: 'Shorts link', link: 'https://www.youtube.com/shorts/xyz123456789', published_date: '2 days ago' },
    { title: 'No views reported', link: 'https://www.youtube.com/watch?v=noviews001', published_date: '3 days ago', views: 'No views', channel: { name: 'Small channel' } },
  ],
};
const start = Date.parse('2025-09-07T00:00:00Z') / 1000;
const timeseries = { interest_over_time: { timeline_data: Array.from({ length: 53 }, (_, i) => ({ timestamp: String(start + i * 7 * 86400), values: [{ query: 'repair cafés', query_index: 0, extracted_value: 10 + i }] })) } };
const related = { related_queries: { rising: [
  { query: 'repair cafe near me', value: '+4,200%', extracted_value: 4200 },
  { query: 'community repair', value: 'Breakout' },
], top: [{ query: 'repair cafe', value: '100', extracted_value: 100 }] } };

function scripted(responses: Array<{ status?: number; data?: unknown }>) {
  const calls: URL[] = [];
  const mock: typeof fetch = async (input) => {
    calls.push(new URL(String(input)));
    const response = responses.shift();
    assert.ok(response, 'No unplanned retry or request should occur');
    return new Response(JSON.stringify(response.data ?? {}), { status: response.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch: mock, apiKey: 'mock-serpapi-secret' };
}

test('YouTube success keeps only recent organic videos and reports provider metrics as given', async () => {
  const deps = scripted([{ data: videos }]);
  const result = await researchYoutube('repair cafés', deps);
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0].searchParams.get('engine'), 'youtube');
  assert.equal(deps.calls[0].searchParams.get('search_query'), 'repair cafés');
  assert.equal(deps.calls[0].searchParams.get('gl'), 'us');
  assert.equal(deps.calls[0].searchParams.get('sp'), 'EgIIBA==', 'upload-date filter is requested from the provider');
  assert.equal(result.provider, 'serpapi-youtube');
  assert.equal(result.evidence.length, 2, 'ads, undated, out-of-window and non-watch links are dropped');
  assert.equal(result.evidence[0].source, 'youtube');
  assert.equal(result.evidence[0].url, videoUrl, 'tracking parameters are stripped to the canonical watch URL');
  const metrics = result.evidence[0].metrics.youtube!;
  assert.equal(metrics.videoId, 'abc123456');
  assert.equal(metrics.channel, 'Repair Collective');
  assert.equal(metrics.channelVerified, true);
  assert.equal(metrics.views, 21375);
  assert.equal(metrics.publishedLabel, '18 hours ago');
  assert.ok(metrics.publishedDaysAgo! < 1, 'relative labels are parsed, not invented');
  assert.equal(metrics.duration, '9:28');
  assert.equal(metrics.searchLocale, 'US');
  assert.equal(result.evidence[1].metrics.youtube!.views, null, '"No views" is not a number');
  assert.match(result.providers[0].reason!, /1 without a published date/);
  assert.match(result.providers[0].reason!, /1 older than 30 days/);
  assert.ok(!JSON.stringify(result).includes('mock-serpapi-secret'));
});

test('Google Trends success returns 12 months of US interest and related/rising queries', async () => {
  const deps = scripted([{ data: timeseries }, { data: related }]);
  const result = await researchTrends('repair cafés', deps);
  assert.equal(result.provider, 'serpapi-trends');
  assert.equal(deps.calls.length, 2);
  for (const url of deps.calls) {
    assert.equal(url.searchParams.get('geo'), 'US');
    assert.equal(url.searchParams.get('date'), 'today 12-m');
    assert.equal(url.searchParams.get('engine'), 'google_trends');
  }
  assert.equal(deps.calls[1].searchParams.get('data_type'), 'RELATED_QUERIES');
  const metrics = result.evidence[0].metrics.trends!;
  assert.equal(metrics.timeline.length, 53);
  assert.equal(metrics.slope12Month, 4.3482);
  assert.equal(metrics.relatedQueries[0].risingPercent, 4200);
  assert.equal(metrics.relatedQueries[1].breakout, true);
  assert.equal(metrics.relatedQueries[1].risingPercent, null, 'Breakout without a reported number is not a made-up percentage');
  assert.equal(metrics.relatedQueries[2].interest, 100);
  assert.equal(metrics.relatedQueries[2].risingPercent, null);
  assert.equal(new URL(result.evidence[0].url).searchParams.get('geo'), 'US');
});

for (const status of [401, 403, 429]) test(`SerpApi ${status} never retries or spends on related queries`, async () => {
  const deps = scripted([{ status }]);
  await assert.rejects(() => researchTrends('repair', deps), (error: unknown) => error instanceof ResearchError && error.kind === (status === 429 ? 'rate_limited' : 'credentials'));
  assert.equal(deps.calls.length, 1);
});

test('transient failure retries once and records provider + reason', async () => {
  const deps = scripted([{ status: 503 }, { data: videos }]);
  const result = await researchYoutube('repair', deps);
  assert.equal(deps.calls.length, 2);
  assert.equal(result.providers[0].attempts, 2);
  assert.match(result.reason!, /retry-after-http-503/);
  assert.equal(result.evidence[0].reason, 'retry-after-http-503');
});

test('two transient failures produce a clear error with no third call', async () => {
  const deps = scripted([{ status: 500 }, { status: 502 }]);
  await assert.rejects(() => researchYoutube('repair', deps), (error: unknown) => error instanceof ResearchError && error.attempts === 2);
  assert.equal(deps.calls.length, 2);
});

test('timeouts retry once; cancellation never retries', async () => {
  let calls = 0;
  const wait: typeof fetch = async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  };
  await assert.rejects(() => researchYoutube('repair', { fetch: wait, apiKey: 'test', timeoutMs: 5 }), (e: unknown) => e instanceof ResearchError && e.kind === 'timeout');
  assert.equal(calls, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => researchYoutube('repair', { fetch: wait, apiKey: 'test', signal: controller.signal }), (e: unknown) => e instanceof ResearchError && e.kind === 'cancelled');
  assert.equal(calls, 2);
});

test('provider payload errors never expose an API key or retry credentials', async () => {
  const deps = scripted([{ data: { error: 'Invalid API key mock-serpapi-secret in https://serpapi.com/search?api_key=mock-serpapi-secret' } }]);
  await assert.rejects(() => researchYoutube('repair', deps), (e: unknown) => e instanceof ResearchError && e.kind === 'credentials' && !e.message.includes('mock-serpapi-secret'));
  assert.equal(deps.calls.length, 1);
});

test('partial Trends failure retains the completed series and does not re-fetch it', async () => {
  const deps = scripted([{ data: timeseries }, { status: 500 }, { status: 503 }]);
  const result = await collectResearch('repair cafés', ['trends'], { serpOptions: deps });
  assert.equal(deps.calls.length, 3);
  assert.equal(result.evidence[0].metrics.trends!.timeline.length, 53);
  assert.equal(result.providers[0].status, 'partial');
  assert.equal(result.reason, 'partial-results');
});

test('source combinations preserve both providers; bad shared SerpApi credentials suppress further SerpApi calls', async () => {
  const deps = scripted([{ data: videos }, { data: timeseries }, { data: related }]);
  const result = await collectResearch('repair cafés', ['youtube', 'trends'], { serpOptions: deps });
  assert.equal(result.provider, 'mixed');
  assert.equal(result.evidence.length, 3);
  assert.deepEqual(result.providers.map((p) => p.provider), ['serpapi-youtube', 'serpapi-trends']);
  const bad = scripted([{ status: 401 }]);
  await assert.rejects(() => collectResearch('repair', ['youtube', 'trends'], { serpOptions: bad }), (e: unknown) => e instanceof ResearchError && e.reports?.length === 2);
  assert.equal(bad.calls.length, 1);
});

test('validates requested sources and leaves missing measurements unknown', () => {
  assert.deepEqual(parseSources(undefined), ['web']);
  assert.deepEqual(parseSources(['web', 'reddit', 'youtube', 'trends']), ['web', 'reddit', 'youtube', 'trends']);
  assert.deepEqual(parseSources('trends'), ['trends']);
  assert.throws(() => parseSources([]), ResearchError);
  assert.throws(() => parseSources(['invalid']), ResearchError);
  assert.equal(calculateSlope([]), null);
  assert.equal(calculateSlope([{ date: '', timestamp: 1, value: 0 }]), null);
});

test('extraction receives structured metrics and cannot invent or overwrite momentum', async () => {
  const research = await researchTrends('repair cafés', scripted([{ data: timeseries }, { data: related }]));
  let captured: ChatOptions | null = null;
  const gw: Gateway = {
    chat: async (options) => {
      captured = options;
      return { content: JSON.stringify({ signals: [{ name: 'Repair culture', summary: 'US search interest in repair.', evidenceUrls: [research.evidence[0].url], momentum: 99, timeline: [{ value: 999 }], momentumEvidence: [{ slope12Month: 9999 }] }] }), citations: [], provider: 'test', model: 'test', generationId: null, promptTokens: 0, completionTokens: 0, cost: 0, toolCalls: [] };
    },
    chatStream: async () => { throw new Error('No streaming extraction'); },
  };
  const signals = await extractSignals({ query: 'repair cafés', answer: research.answer, evidence: research.evidence }, { gateway: gw });
  assert.match((captured as unknown as ChatOptions).user!, /slope12Month/);
  assert.equal(signals[0].momentum, null);
  assert.equal(signals[0].momentumEvidence[0].slope12Month, 4.3482);
  assert.equal(signals[0].momentumEvidence[0].relatedQueries[0].risingPercent, 4200);
  assert.deepEqual(signals[0].evidence, research.evidence);
  assert.deepEqual(signals[0].timeline, []);
});

test('research tools are absent with web off; a blocked service never blocks the other one', async () => {
  let calls = 0;
  const collect: typeof collectResearch = async (_query, sources) => {
    calls++;
    const serp = sources?.[0] === 'youtube' || sources?.[0] === 'trends';
    throw new ResearchError('rate_limited', 'Rate limited.', serp ? 'serpapi-trends' : 'openrouter-reddit');
  };
  const off = buildTools(false, { collect });
  const ctx = { owner: 'owner', interests: [], useWeb: false };
  for (const name of ['web_research', 'reddit_research', 'youtube_research', 'trends_research']) {
    assert.ok(!off.specs.some((tool) => tool.function.name === name), `${name} must not exist with web off`);
    await off.run(name, { query: 'repair' }, ctx);
  }
  assert.equal(calls, 0);
  const on = buildTools(true, { collect });
  assert.deepEqual(on.specs.map((t) => t.function.name).filter((n) => n.endsWith('_research')).sort(),
    ['reddit_research', 'trends_research', 'web_research', 'youtube_research']);
  await on.run('reddit_research', { query: 'repair' }, ctx);
  assert.equal(calls, 0, 'execution also enforces the message toggle');
  await on.run('reddit_research', { query: 'repair' }, { ...ctx, useWeb: true });
  await on.run('reddit_research', { query: 'repair' }, { ...ctx, useWeb: true });
  await on.run('web_research', { query: 'another question' }, { ...ctx, useWeb: true });
  assert.equal(calls, 1, 'OpenRouter tools are rate-limit blocked and de-duplicated');
  await on.run('trends_research', { query: 'different term' }, { ...ctx, useWeb: true });
  await on.run('youtube_research', { query: 'another term' }, { ...ctx, useWeb: true });
  assert.equal(calls, 2, 'SerpApi tools run independently, then block only themselves');
});

test('chat citations retain evidence and metadata from every research tool', async () => {
  const deps = scripted([{ data: videos }, { data: timeseries }, { data: related }]);
  let round = 0;
  const base = { citations: [], provider: 'test', model: 'test', generationId: null, promptTokens: 0, completionTokens: 0, cost: 0 };
  const gw: Gateway = {
    chat: async () => ({ ...base, content: round++ ? 'Grounded answer.' : '', toolCalls: round === 1 ? [
      { id: 'y', name: 'youtube_research', argumentsJson: '{"query":"repair cafés"}' },
      { id: 't', name: 'trends_research', argumentsJson: '{"query":"repair cafés"}' },
    ] : [] }),
    chatStream: async () => { throw new Error('Unexpected stream'); },
  };
  const result = await runAgent({ owner: 'owner', history: [], userText: 'Research repair cafés', useWeb: true,
    prefs: { completed: true, completedAt: null, interests: [], purposes: [], exploring: [] },
    deps: { gateway: gw, collect: (q, s) => collectResearch(q, s, { serpOptions: deps }) } });
  assert.equal(result.research!.provider, 'mixed');
  assert.equal(result.research!.evidence!.length, 3);
  assert.equal(result.research!.citations.length, 3);
  assert.equal(result.research!.providers!.length, 2);
  assert.ok(result.research!.evidence!.some((e) => e.metrics.youtube?.views === 21375), 'video metrics survive into the message');
  assert.ok(result.research!.evidence!.some((e) => e.metrics.trends?.slope12Month === 4.3482), 'trend slope survives into the message');
});
