import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request } from 'node:http';
import { createApi } from '../app';
import { createSession } from '../auth';
import { gateway } from '../llm/openrouter';
import * as repos from '../repos';
import { toSignal } from '../llm/extract';
import type { ChatResult } from '../llm/openrouter';

// Only localhost HTTP to our Express router; all AI calls are mocked.
test('authenticated routes hydrate the same signal, preserve Saved transfers, and execute owner-validated chat proposals without implicit generation', async () => {
  const owner = 'route-owner'; const other = 'route-other';
  const signal = toSignal({ name: 'Route research', summary: 'Saved observations' }, 0, 1, [{ source: 'web', provider: 'perplexity-sonar', title: 'Evidence', url: 'https://example.com/route', snippet: 'Observation', metrics: {}, date: null, reason: null }]);
  await repos.mergeSignal(owner, signal);
  const { token } = await createSession(owner); const otherSession = await createSession(other);
  const app = express(); app.use('/api', createApi());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (path: string, method = 'GET', body?: unknown, cookie = token) => new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: address.port, path: `/api${path}`, method, headers: { cookie: `drift_session=${cookie}`, 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const original = gateway.chat; let calls = 0;
  gateway.chat = async opts => {
    calls++; assert.equal(opts.plugins, undefined); assert.equal(opts.tools, undefined);
    return { content: JSON.stringify({ analysis: { label: 'Hypothesis', observations: [{ text: 'Observation', evidenceUrls: [signal.evidence[0].url] }], assumptions: ['Target demand untested'] }, interpretation: { meaning: 'Hypothesis', whyTransfer: 'Possible use', changingBehavior: 'Unverified', unmetNeeds: ['Test'], productImplications: ['Test'], brandImplications: ['Test'], risks: ['Unknown'], opportunitySpaces: ['Test'] } }), citations: [], provider: 'mock', model: 'mock', generationId: null, promptTokens: 0, completionTokens: 0, cost: 0, toolCalls: [] } satisfies ChatResult;
  };
  try {
    for (let reload = 0; reload < 2; reload++) {
      const list = await call('/signals'); assert.deepEqual(list.data.map((s: { id: string }) => s.id), [signal.id]);
      assert.equal((await call(`/signals/${signal.id}`)).data.id, signal.id);
      for (const path of ['/signals/status', '/transfers', '/opportunities', '/saved', '/trends']) assert.equal((await call(path)).status, 200);
    }
    assert.equal(calls, 0);
    assert.deepEqual((await call('/signals', 'GET', undefined, otherSession.token)).data, []);
    assert.equal((await call('/transfers', 'POST', { signalId: signal.id, industryId: 'retail' }, otherSession.token)).status, 400);
    assert.equal((await call('/transfers', 'POST', { signalId: 'digital-minimalism', industryId: 'retail' })).status, 400);
    assert.equal(calls, 0);
    const created = await call('/transfers', 'POST', { signalId: signal.id, industryId: 'retail' });
    assert.equal(created.status, 200); assert.equal(calls, 1);
    await call('/saved', 'POST', { type: 'transfer', refId: created.data.id });
    await call('/saved', 'POST', { type: 'signal', refId: signal.id });
    const saved = await call('/saved');
    assert.ok(saved.data.some((e: any) => e.signal?.id === signal.id));
    assert.ok(saved.data.some((e: any) => e.transfer?.id === created.data.id));
    assert.equal((await call(`/transfers/${created.data.id}`)).data.id, created.data.id);
    assert.equal(calls, 1, 'reading Saved/deep links never regenerates');
    const convo = await repos.createConversation(owner);
    await repos.updateConversation(owner, convo.id, { messages: [{ id: 'm', role: 'assistant', content: 'Proposal', createdAt: new Date().toISOString(), proposals: [{ id: 'p', kind: 'transfer', label: 'Research transfer', params: { signalId: signal.id, industryId: 'retail' } }] }] });
    const executed = await call(`/chat/${convo.id}/proposals/p/execute`, 'POST', {});
    assert.equal(executed.status, 200); assert.match(executed.data.links[0].href, /transfer\?transfer=/);
    assert.equal(calls, 2);
    assert.equal((await call(`/chat/${convo.id}/proposals/p/execute`, 'POST', {}, otherSession.token)).status, 404);
    assert.equal(calls, 2);
  } finally {
    gateway.chat = original;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
