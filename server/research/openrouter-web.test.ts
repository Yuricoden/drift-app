import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchReddit, researchWeb } from './openrouter-web';
import { ResearchError } from './errors';
import { LlmError, type ChatOptions, type ChatResult, type Citation, type Gateway } from '../llm/openrouter';

const thread = 'https://www.reddit.com/r/AskAnAmerican/comments/1abc/us_repair_clubs/';
const comment = 'https://www.reddit.com/r/AskAnAmerican/comments/1abc/us_repair_clubs/xyz9/';

function gateway(citations: Citation[], content = 'Findings [1].', failure?: { kind: 'rate_limited' | 'credentials' | 'transient' }): { gateway: Gateway; calls: ChatOptions[] } {
  const calls: ChatOptions[] = [];
  return {
    calls,
    gateway: {
      async chat(options: ChatOptions): Promise<ChatResult> {
        calls.push(options);
        if (failure) throw new LlmError(failure.kind, `OpenRouter ${failure.kind}`, failure.kind === 'rate_limited' ? 429 : failure.kind === 'credentials' ? 401 : 503);
        return { content, citations, provider: 'perplexity', model: 'sonar', generationId: null, promptTokens: 10, completionTokens: 5, cost: 0.005, toolCalls: [] };
      },
      async chatStream(): Promise<ChatResult> { throw new Error('Research never streams'); },
    },
  };
}

const citation = (url: string, title: string, content: string): Citation => ({ url, title, content });

test('Reddit search is restricted to site:reddit.com and rejects every non-thread citation', async () => {
  const { gateway: gw, calls } = gateway([
    citation(thread, 'US repair clubs: what would help?', 'In the United States, neighbors discuss repairs.'),
    citation(comment, 'comment on US repair clubs', 'A local event would help us find repair skills.'),
    citation('https://www.reddit.com/r/AskAnAmerican/', 'subreddit front page', 'Not a thread.'),
    citation('https://www.reddit.com/search/?q=repair', 'reddit search', 'Not a thread.'),
    citation('https://reddit.com.evil.example/r/x/comments/1/y/', 'lookalike host', 'Spoofed.'),
    citation('https://www.business.reddit.com/blog/research', 'Reddit marketing', 'Not a community thread.'),
  ]);
  const result = await researchReddit('repair clubs', { gateway: gw });
  assert.equal(calls.length, 1);
  assert.match(calls[0].user!, /^site:reddit\.com repair clubs/, 'the query itself is domain-restricted');
  const plugin = calls[0].plugins![0];
  assert.equal(plugin.id, 'web');
  assert.equal(plugin.engine, 'perplexity');
  assert.deepEqual(plugin.include_domains, ['reddit.com']);
  assert.equal(result.provider, 'openrouter-reddit');
  assert.deepEqual(result.evidence.map((e) => e.url), [thread, comment], 'only real thread and comment permalinks survive');
  assert.equal(result.evidence[0].source, 'reddit');
  assert.equal(result.evidence[0].metrics.subreddit, 'AskAnAmerican');
  assert.equal(result.evidence[0].metrics.kind, 'post');
  assert.equal(result.evidence[1].metrics.kind, 'comment');
  assert.equal(result.evidence[0].metrics.score, null, 'no vote counts are invented from search citations');
  assert.equal(result.evidence[0].metrics.commentCount, null);
  assert.match(result.evidence[0].metrics.usBasis!, /US-focused community r\/AskAnAmerican/);
});

test('Reddit evidence without explicit US relevance is dropped and reported, not padded', async () => {
  const { gateway: gw } = gateway([
    citation('https://www.reddit.com/r/AskUK/comments/2def/local_repair/', 'Local repair groups', 'Groups in London discuss repairs.'),
  ]);
  const result = await researchReddit('repair clubs', { gateway: gw });
  assert.equal(result.evidence.length, 0);
  assert.equal(result.insufficientEvidence, true);
  assert.equal(result.providers[0].status, 'empty');
  assert.equal(result.providers[0].reason, 'no-us-evidence');
});

test('wider-web search excludes the other three channels so coverage cannot be double-counted', async () => {
  const { gateway: gw, calls } = gateway([
    citation('https://example.com/us-consumer-report', 'US consumer report', 'Reporting on US shoppers.'),
    citation(thread, 'A Reddit thread', 'Should never count as web evidence.'),
    citation('https://www.youtube.com/watch?v=abc123456', 'A video', 'Should never count as web evidence.'),
    citation('https://trends.google.com/trends/explore?q=repair', 'Trends', 'Should never count as web evidence.'),
  ]);
  const result = await researchWeb('repair culture', { gateway: gw });
  const plugin = calls[0].plugins![0];
  assert.equal(plugin.engine, 'perplexity');
  for (const domain of ['reddit.com', 'youtube.com', 'youtu.be', 'trends.google.com']) {
    assert.ok((plugin.exclude_domains as string[]).includes(domain), `${domain} must be excluded from web search`);
  }
  assert.equal(result.provider, 'openrouter-web');
  assert.deepEqual(result.evidence.map((e) => e.url), ['https://example.com/us-consumer-report']);
  assert.equal(result.evidence[0].source, 'web');
});

test('Reddit rate limits are classified and never retried inside the same request', async () => {
  const { gateway: gw, calls } = gateway([], '', { kind: 'rate_limited' });
  await assert.rejects(() => researchReddit('repair', { gateway: gw }),
    (error: unknown) => error instanceof ResearchError && error.kind === 'rate_limited' && error.provider === 'openrouter-reddit');
  assert.equal(calls.length, 1, 'a rate limit is not retried');
});
