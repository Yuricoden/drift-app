import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runResearch, ResearchError } from './research';
import { LlmError, parseCitations, type ChatOptions, type ChatResult, type Gateway } from './openrouter';

const cited = (): ChatResult => ({
  content: 'US findings [1]', citations: [{ url: 'https://example.com/research', title: 'Source', content: 'Evidence' }],
  provider: 'perplexity', model: 'perplexity/sonar', generationId: 'test', promptTokens: 10,
  completionTokens: 20, cost: 0.005, toolCalls: [],
});

function fake(answer: () => Promise<ChatResult>) {
  const calls: ChatOptions[] = [];
  const gateway: Gateway = {
    chat: async (opts) => { calls.push(opts); return answer(); },
    chatStream: async () => { throw new Error('Unexpected streaming research'); },
  };
  return { gateway, calls };
}

test('research calls Perplexity directly without Gemini, native search, tools or response_format', async () => {
  const { gateway, calls } = fake(async () => cited());
  const result = await runResearch('What is changing in US culture?', { gateway });
  assert.equal(result.provider, 'perplexity-sonar');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.totalCost, 0.005);
  assert.equal(result.primaryCost, 0.005);
  assert.equal(result.insufficientEvidence, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].model, /^perplexity\//);
  assert.equal('nativeWebSearch' in calls[0], false);
  assert.equal(calls[0].responseFormat, undefined);
  assert.equal(calls[0].tools, undefined);
  assert.equal(calls[0].retry, false);
  assert.match(calls[0].system!, /United States/);
});

test('uncited Perplexity response reports insufficient evidence without extra calls', async () => {
  const { gateway, calls } = fake(async () => ({ ...cited(), citations: [] }));
  const result = await runResearch('q', { gateway });
  assert.equal(result.insufficientEvidence, true);
  assert.equal(calls.length, 1);
});

for (const kind of ['budget', 'credentials', 'cancelled', 'timeout', 'transient', 'rate_limited'] as const) {
  test(`Perplexity ${kind} errors respect the bounded retry policy`, async () => {
    const { gateway, calls } = fake(async () => { throw new LlmError(kind, 'Provider unavailable'); });
    await assert.rejects(() => runResearch('q', { gateway }), ResearchError);
    assert.equal(calls.length, ['timeout', 'transient'].includes(kind) ? 2 : 1);
  });
}

test('normalizes both OpenRouter citations and Perplexity citations without unsafe links', () => {
  const citations = parseCitations({ annotations: [
    { type: 'url_citation', url_citation: { url: 'https://reddit.com/r/example/comments/1', title: 'A thread' } },
    { type: 'url_citation', url_citation: { url: 'javascript:alert(1)' } },
  ] }, {
    citations: ['https://reddit.com/r/example/comments/1', 'https://youtube.com/watch?v=2'],
    search_results: [{ url: 'https://reddit.com/r/example/comments/1', snippet: 'Public excerpt' }],
  });
  assert.equal(citations.length, 2);
  assert.equal(citations[0].content, 'Public excerpt');
});

test('research stays off for Ask DRIFT when web is disabled', async () => {
  const { askDrift } = await import('../intelligence/ask');
  const result = await askDrift('owner', 'What signals could reshape dating?', {
    completed: true, completedAt: null, exploring: [], purposes: [], interests: [],
  }, { useWeb: false });
  assert.equal(result.research, null);
});
