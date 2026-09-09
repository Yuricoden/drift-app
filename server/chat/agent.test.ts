import { test, before } from 'node:test';
import { mergeSignal } from '../repos';
import { toSignal } from '../llm/extract';

before(async () => {
  const signal = toSignal({ name: 'Saved repair research', summary: 'Evidence about dating and repair communities.' }, 0, 1, [{ source: 'web', provider: 'perplexity-sonar', title: 'Saved evidence', url: 'https://example.com/saved', snippet: 'Community repair gatherings', metrics: {}, date: null, reason: null }]);
  for (const owner of ['o', 'owner']) await mergeSignal(owner, signal);
});
import assert from 'node:assert/strict';
import { runAgent, seededAnswer } from './agent';
import { LlmError, type ChatOptions, type ChatResult, type Gateway } from '../llm/openrouter';
import type { OnboardingPrefs } from '../../shared/types';

const prefs: OnboardingPrefs = { completed: true, completedAt: null, exploring: [], purposes: [], interests: [] };

function result(over: Partial<ChatResult>): ChatResult {
  return {
    content: '', citations: [], provider: 'google', model: 'm', generationId: null,
    promptTokens: 0, completionTokens: 0, cost: 0, toolCalls: [], ...over,
  };
}

/** A gateway that scripts tool-call rounds then a final answer. */
function scripted(opts: {
  rounds: Array<{ toolCalls?: { name: string; argumentsJson: string }[]; content?: string }>;
  finalContent: string;
  capturedTools?: { specs: string[] }[];
}): Gateway {
  const capturedTools: { specs: string[] }[] = [];
  let round = 0;
  return {
    async chat(o: ChatOptions) {
      capturedTools.push({ specs: (o.tools ?? []).map((t) => t.function.name) });
      // If we've exhausted scripted tool rounds, answer directly (no tool calls).
      if (round >= opts.rounds.length) {
        return result({ content: opts.finalContent, toolCalls: [] });
      }
      const step = opts.rounds[round];
      round++;
      return result({
        content: step.content ?? '',
        toolCalls: (step.toolCalls ?? []).map((t, i) => ({ id: `c${round}-${i}`, ...t })),
      });
    },
    async chatStream(o, onToken) {
      capturedTools.push({ specs: (o.tools ?? []).map((t) => t.function.name) });
      onToken(opts.finalContent);
      return result({ content: opts.finalContent });
    },
  };
}

test('agent grounds answer via a tool round and links the used signal', async () => {
  const gw = scripted({
    rounds: [{ toolCalls: [{ name: 'search_signals', argumentsJson: '{"query":"dating"}' }] }],
    finalContent: 'Physical Reconnection is the strongest signal for dating.',
  });
  const out = await runAgent({ owner: 'o', prefs, history: [], userText: 'What could reshape dating?', useWeb: false, deps: { gateway: gw } });
  assert.equal(out.content, 'Physical Reconnection is the strongest signal for dating.');
  assert.equal(out.toolEvents.length, 1);
  assert.match(out.toolEvents[0].summary, /Searched/);
  assert.ok(out.references.length > 0, 'should reference used signals');
  assert.ok(out.references.some((r) => r.href.startsWith('/app/signals/')));
});

test('web_research tool is NOT available when useWeb is false', async () => {
  const seen: string[][] = [];
  const gw = scripted({ rounds: [{ content: 'An answer.' }], finalContent: 'An answer.' });
  const wrapped: Gateway = {
    ...gw,
    async chat(o) { seen.push((o.tools ?? []).map((t) => t.function.name)); return gw.chat(o); },
  };
  await runAgent({ owner: 'o', prefs, history: [], userText: 'hi', useWeb: false, deps: { gateway: wrapped } });
  assert.ok(seen.length > 0);
  for (const specs of seen) assert.ok(!specs.includes('web_research'), 'web_research must be absent when web is off');
});

test('suggest tools produce a proposal and never write to the catalog', async () => {
  const gw = scripted({
    rounds: [{ toolCalls: [{ name: 'suggest_generate_opportunities', argumentsJson: '{"signal_id":"saved-repair-research","industry_id":"dating"}' }] }],
    finalContent: 'I can generate three opportunities — confirm below.',
  });
  const out = await runAgent({ owner: 'o', prefs, history: [], userText: 'Find opportunities in dating', useWeb: false, deps: { gateway: gw } });
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].kind, 'generate_opportunities');
  assert.equal(out.proposals[0].params.signalId, 'saved-repair-research');
  assert.match(out.content, /confirm/i);
});

test('cancellation aborts the loop and throws a cancelled error', async () => {
  const controller = new AbortController();
  const gw: Gateway = {
    async chat() { controller.abort(); throw new LlmError('cancelled', 'Cancelled.'); },
    async chatStream(_o, onToken) { onToken('x'); return result({ content: 'x' }); },
  };
  await assert.rejects(
    () => runAgent({ owner: 'o', prefs, history: [], userText: 'hi', useWeb: false, signal: controller.signal, deps: { gateway: gw } }),
    (e: unknown) => e instanceof LlmError && e.kind === 'cancelled',
  );
});

test('seeded fallback answers without any gateway when no key is set', async () => {
  const out = await seededAnswer('owner', prefs, 'What signals could reshape dating?', false);
  assert.ok(out.content.length > 0);
  assert.ok(out.references.length > 0);
  assert.equal(out.proposals.length, 0);
});
