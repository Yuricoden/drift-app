import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as repos from '../repos';
import { getStore } from '../db';
import { toSignal } from '../llm/extract';
import { createGenerationService, validateAnalysis, WORKSPACE_KEYS } from './generation';
import { analysisChat } from '../llm/analysis';
import { LlmError, type ChatResult, type Gateway } from '../llm/openrouter';
import type { Evidence } from '../../shared/types';

const source: Evidence = { source: 'web', provider: 'perplexity-sonar', title: 'Repair clubs', url: 'https://example.com/repair', snippet: 'People meet to repair items.', metrics: {}, date: null, reason: null };
const signal = toSignal({ name: 'Repair gatherings', summary: 'Observed repair meetings', industries: [] }, 0, 1, [source]);
const analysis = { label: 'Hypothesis', observations: [{ text: 'Repair meetings were reported.', evidenceUrls: [source.url] }], assumptions: ['Retail customers might attend.'] };
const interpretation = { meaning: 'A possible repair service', whyTransfer: 'Shared skills may be useful', changingBehavior: 'Retail adoption is unverified', unmetNeeds: ['Repair access'], productImplications: ['Test a booking service'], brandImplications: ['Test trust'], risks: ['Demand unverified'], opportunitySpaces: ['Repair workshops'] };
const opportunity = { name: 'Repair workshop', concept: 'Test a local workshop', audience: 'Assumed local customers', culturalInsight: 'Repair gatherings reported', whyNow: 'Test interest', differentiation: 'Unverified', risk: 'Demand unknown', workspace: Object.fromEntries(WORKSPACE_KEYS.map(k => [k, `Hypothesis ${k}`])), analysis };
const result = (content: unknown): ChatResult => ({ content: JSON.stringify(content), citations: [], provider: 'mock', model: 'mock-analysis', generationId: 'mock', promptTokens: 0, completionTokens: 0, cost: 0, toolCalls: [] });

test('full transfer → opportunities → workspace → Saved; regeneration/refinement, citations, ownership and failure preservation', async () => {
  const owner = 'generation-owner'; const store = await getStore();
  await repos.mergeSignal(owner, signal);
  let response: unknown = { interpretation, analysis }; let calls = 0;
  const service = createGenerationService({ chat: async opts => {
    calls++;
    assert.equal(opts.plugins, undefined); assert.equal(opts.tools, undefined);
    const input = JSON.parse(opts.user!); assert.deepEqual(input.evidence, [source]);
    assert.deepEqual(input.targetIndustry, { id: 'retail', name: 'Retail & Commerce' });
    assert.equal('behaviors' in input.targetIndustry, false);
    return result(response);
  } });
  await assert.rejects(service.transfer('another-owner', signal.id, 'retail'));
  await assert.rejects(service.transfer(owner, 'digital-minimalism', 'retail'));
  assert.equal(calls, 0);
  const transfer = await service.transfer(owner, signal.id, 'retail');
  assert.equal(transfer.analysis?.label, 'Hypothesis'); assert.deepEqual(transfer.provenance?.evidenceSnapshot, [source]);
  assert.equal(transfer.provenance?.model, 'mock-analysis');
  response = { opportunities: [opportunity, opportunity, opportunity] };
  const opportunities = await service.opportunities(owner, signal.id, 'retail', transfer.id);
  assert.equal(opportunities.length, 3);
  const first = opportunities[0];
  await repos.saveItem(owner, 'transfer', transfer.id, 'Inbox');
  await repos.saveItem(owner, 'opportunity', first.id, 'Inbox');
  await repos.saveItem(owner, 'signal', signal.id, 'Inbox');
  assert.equal((await repos.listSaved(owner)).length, 3);
  assert.equal(await repos.getOpportunity('other', first.id), null);
  await assert.rejects(repos.saveItem('other', 'signal', signal.id, 'Inbox'));
  response = { opportunities: [{ ...opportunity, name: 'Updated hypothesis' }] };
  const regenerated = await service.regenerate(owner, first.id);
  assert.equal(regenerated?.id, first.id); assert.equal(regenerated?.name, 'Updated hypothesis');
  response = { text: 'Refined validation hypothesis', analysis };
  const refined = await service.refine(owner, first.id, 'validationExperiment');
  assert.equal(refined.opportunity?.workspace.validationExperiment, 'Refined validation hypothesis');
  assert.equal(refined.opportunity?.refinements?.validationExperiment?.provenance.model, 'mock-analysis');
  const before = structuredClone(await repos.getOpportunity(owner, first.id));
  response = { opportunities: [{ ...opportunity, analysis: { ...analysis, observations: [{ text: 'Fabricated', evidenceUrls: ['https://evil.example/invented'] }] } }] };
  await assert.rejects(service.regenerate(owner, first.id));
  assert.deepEqual(await repos.getOpportunity(owner, first.id), before);
  response = { text: 'Bad reference https://evil.example/invented', analysis };
  await assert.rejects(service.refine(owner, first.id, 'concept'));
  assert.deepEqual(await repos.getOpportunity(owner, first.id), before);
  await store.opportunities.updateOne({ owner, id: first.id }, { provenance: undefined });
  const paidBefore = calls;
  await assert.rejects(service.regenerate(owner, first.id)); await assert.rejects(service.refine(owner, first.id, 'concept'));
  assert.equal(calls, paidBefore, 'legacy generation is rejected before AI');
  assert.ok(await repos.getOpportunity(owner, first.id), 'legacy record stays accessible');
});

test('reanalyzing replaces classifications and deduplicates measured evidence without changing signal IDs', async () => {
  const owner = 'classification-owner';
  await repos.mergeSignal(owner, { ...signal, industries: ['software'] });
  await repos.mergeSignal(owner, { ...signal, industries: [] });
  const updated = await repos.getSignal(owner, signal.id);
  assert.equal(updated?.id, signal.id); assert.deepEqual(updated?.industries, []);
  assert.deepEqual(updated?.path, []); assert.equal(updated?.evidence.length, 1);
  assert.deepEqual(updated?.momentumEvidence, []);
});

test('analysis retries timeout/5xx once, never credentials, rate limits or invalid output', async () => {
  for (const kind of ['credentials', 'rate_limited', 'budget', 'timeout', 'transient', 'empty', 'unsupported'] as const) {
    let calls = 0;
    const gateway: Gateway = { chat: async () => { calls++; throw new LlmError(kind, 'Mock error'); }, chatStream: async () => { throw new Error('No stream'); } };
    await assert.rejects(analysisChat({ model: 'mock', user: 'test' }, { gateway }));
    assert.equal(calls, ['timeout', 'transient'].includes(kind) ? 2 : 1, kind);
  }
});

test('hypothesis label and all citations are mandatory', () => {
  assert.throws(() => validateAnalysis({ ...analysis, label: 'Proven' }, signal));
  assert.throws(() => validateAnalysis({ ...analysis, observations: [] }, signal));
  assert.throws(() => validateAnalysis({ ...analysis, assumptions: ['See https://evil.example'] }, signal));
});
