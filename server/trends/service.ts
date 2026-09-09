import { randomUUID } from 'node:crypto';
import type { OnboardingPrefs, TrendFeed, TrendResearchState, TrendTopic } from '../../shared/types';
import { getStore, type Store } from '../db';
import { env } from '../env';
import { ResearchError } from '../llm/research';
import { CHANNELS, mergeTopic, parseTopics } from './topics';
import { retrieveChannelEvidence, NO_TERMS_REASON } from './retrieve';
import { synthesizeTopics } from './synthesize';
import { extraction } from '../signals/extraction';

export class TrendError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type StateDoc = TrendResearchState & { owner: string; heartbeatAt?: string };
const STALE_MS = 8 * 60 * 1000;
/** $0.05 per channel: bounded retrieval plus one bounded synthesis call. */
const RESERVE_MICROS = 50000;
/** Channels served by SerpApi; the rest go through OpenRouter. */
const serpChannel = (channel: string): boolean => channel === 'youtube' || channel === 'google-trends';

const emptyState = (owner: string): StateDoc => ({
  owner, initialized: false, runId: '', status: 'idle', startedAt: null,
  lastPulledAt: null, coverage: [], error: null,
});

interface Deps {
  store: () => Promise<Store>;
  retrieve: typeof retrieveChannelEvidence;
  synthesize: typeof synthesizeTopics;
  configured: () => boolean;
  now: () => Date;
  budget: () => number;
  analyze: (owner: string) => Promise<void>;
}

/** Requests claim a durable run before work starts, so remounts and tabs cannot
 * trigger duplicate paid pulls. No scheduled research or automatic retries. */
export function createTrendService(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    store: getStore, retrieve: retrieveChannelEvidence, synthesize: synthesizeTopics,
    // OpenRouter is required for Reddit, the wider web and every synthesis step.
    // A missing SERPAPI_API_KEY degrades two channels instead of blocking the pull.
    configured: () => !!env.openrouterKey,
    analyze: async owner => {
      // An explicit analysis may already be processing an older snapshot. Wait,
      // then claim the evidence saved by this pull; never interrupt that job.
      await extraction.waitForIdle(owner);
      await extraction.start(owner); await extraction.waitForIdle(owner);
    },
    now: () => new Date(), budget: () => env.researchMonthlyBudget, ...overrides,
  };
  const jobs = new Map<string, Promise<void>>();

  async function stateFor(owner: string, readOnly = false): Promise<StateDoc> {
    const store = await deps.store();
    if (!readOnly) await store.trendStates.insertIfAbsent({ owner }, emptyState(owner));
    let state = await store.trendStates.findOne({ owner }) as StateDoc | null;
    if (!state) return emptyState(owner);
    if (state.status === 'running' && state.startedAt && deps.now().getTime() - Date.parse(state.heartbeatAt ?? state.startedAt) > STALE_MS) {
      if (readOnly) return { ...state, status: 'failed', error: 'The last pull was interrupted. Existing research is saved.' };
      await store.trendStates.compareAndSet({ owner, runId: state.runId, status: 'running' }, {
        status: 'failed', error: 'The last pull was interrupted. Pull recent research to try again; existing topics are saved.',
      });
      state = await store.trendStates.findOne({ owner }) as StateDoc;
    }
    return state;
  }

  async function feed(owner: string): Promise<TrendFeed> {
    const store = await deps.store();
    const { owner: _owner, ...state } = await stateFor(owner, true);
    const docs = await store.trendTopics.find({ owner });
    const topics = docs.map(({ owner: _o, ...topic }) => topic as TrendTopic)
      .sort((a, b) => b.lastFoundAt.localeCompare(a.lastFoundAt) || a.title.localeCompare(b.title));
    return { state, topics, configured: deps.configured() };
  }

  async function reserve(): Promise<(cost: number | null) => Promise<void>> {
    const store = await deps.store();
    const month = deps.now().toISOString().slice(0, 7);
    const limit = Math.floor(deps.budget() * 1000000);
    await store.trendUsage.insertIfAbsent({ month }, { month, charged: 0 });
    for (;;) {
      const usage = await store.trendUsage.findOne({ month });
      if (!Number.isFinite(limit) || usage.charged + RESERVE_MICROS > limit) {
        throw new ResearchError('budget', 'The monthly Trend Research budget has been reached. Saved research is still available.');
      }
      if (await store.trendUsage.compareAndSet({ month, charged: usage.charged }, { charged: usage.charged + RESERVE_MICROS })) break;
    }
    return async (cost) => {
      // Unknown/ambiguous charges retain the reservation rather than allowing
      // failed requests to bypass the monthly guard.
      if (cost === null || !Number.isFinite(cost) || cost < 0) return;
      const adjustment = Math.ceil(cost * 1000000) - RESERVE_MICROS;
      for (;;) {
        const usage = await store.trendUsage.findOne({ month });
        if (await store.trendUsage.compareAndSet({ month, charged: usage.charged }, { charged: usage.charged + adjustment })) return;
      }
    };
  }

  /** Human-readable reason for a failed channel, naming the responsible service. */
  function failureNote(error: unknown, channel: string): string {
    if (!(error instanceof ResearchError)) return 'Findings could not be processed or saved. Existing research is retained.';
    const service = error.provider.startsWith('serpapi') ? 'SerpApi' : 'OpenRouter';
    switch (error.kind) {
      case 'budget': return error.message;
      case 'credentials': return `${service} credentials need attention${error.provider.startsWith('serpapi') ? ' (SERPAPI_API_KEY)' : ''}.`;
      case 'rate_limited': return `${service} rate limit reached. Existing research is kept.`;
      case 'cancelled': return 'This pull was cancelled.';
      default: return `The ${channel} search could not be completed. Try a manual pull later.`;
    }
  }

  async function work(owner: string, state: StateDoc, prefs: OnboardingPrefs): Promise<void> {
    const store = await deps.store();
    let anySources = false;
    let failed = false;
    let fatal: string | null = null;
    let serpBlocked: string | null = null;
    for (const channel of CHANNELS) {
      const current = await store.trendStates.findOne({ owner });
      if (current.runId !== state.runId || current.status !== 'running') return;
      const coverage = state.coverage.find((c) => c.channel === channel)!;
      const serp = serpChannel(channel);
      if (serp && serpBlocked) {
        failed = true;
        coverage.status = 'failed';
        coverage.note = `Not searched: ${serpBlocked}`;
        await store.trendStates.compareAndSet({ owner, runId: state.runId, status: 'running' }, { coverage: state.coverage });
        continue;
      }
      coverage.status = 'running';
      await store.trendStates.compareAndSet({ owner, runId: state.runId, status: 'running' }, { coverage: state.coverage });
      let settle: ((cost: number | null) => Promise<void>) | null = null;
      let spent: number | null = 0;
      try {
        settle = await reserve();
        const retrieved = await deps.retrieve(channel, prefs, deps.now());
        spent = retrieved.totalCost ?? 0;
        const research = await deps.synthesize(channel, retrieved, prefs, deps.now());
        spent = research.totalCost ?? spent;
        const topics = parseTopics(research, deps.now().toISOString());
        const currentRun = await store.trendStates.findOne({ owner });
        if (currentRun.runId !== state.runId || currentRun.status !== 'running') return;
        for (const topic of topics) {
          const existing = await store.trendTopics.findOne({ owner, id: topic.id });
          await store.trendTopics.updateOne({ owner, id: topic.id }, { owner, ...mergeTopic(existing as TrendTopic | null, topic) }, true);
        }
        anySources ||= topics.length > 0;
        coverage.topicCount = topics.length;
        const direct = topics.some((t) => t.sources.some((s) => s.channel === channel));
        coverage.status = direct ? 'complete' : 'limited';
        coverage.note = !topics.length
          ? retrieved.providers.some((p) => p.reason === NO_TERMS_REASON)
            ? 'No interest terms to measure. Add interests in Preferences.'
            : 'No sufficiently sourced US findings in this pull.'
          : !direct ? 'Related reporting found; direct platform evidence was unavailable.' : null;
      } catch (error) {
        failed = true;
        coverage.status = 'failed';
        coverage.note = failureNote(error, channel);
        const researchError = error instanceof ResearchError ? error : null;
        if (researchError && serp && ['credentials', 'rate_limited'].includes(researchError.kind)) {
          serpBlocked = coverage.note;
        } else if (researchError && ['budget', 'cancelled'].includes(researchError.kind)
          || (researchError && !serp && ['credentials', 'rate_limited'].includes(researchError.kind))) {
          fatal = coverage.note;
          for (const pending of state.coverage.filter((c) => c.status === 'pending')) {
            pending.status = 'failed'; pending.note = 'Not searched because this pull was stopped.';
          }
          await settle?.(spent);
          break;
        }
      } finally {
        await settle?.(spent);
      }
      await store.trendStates.compareAndSet({ owner, runId: state.runId, status: 'running' }, { coverage: state.coverage });
    }
    if (anySources) await deps.analyze(owner);
    await store.trendStates.compareAndSet({ owner, runId: state.runId, status: 'running' }, {
      status: failed ? (anySources ? 'partial' : 'failed') : 'complete',
      coverage: state.coverage,
      lastPulledAt: deps.now().toISOString(),
      error: fatal ?? (failed ? 'Some searches did not finish. Available findings and previous research are saved.' : null),
    });
  }

async function start(owner: string, mode: 'initial' | 'refresh', prefs: OnboardingPrefs): Promise<TrendFeed> {
    // Legacy clients may still send initial. It is now read-only, including
    // accounts that have never researched before.
    if (mode === 'initial') return feed(owner);
    const store = await deps.store();
    const previous = await stateFor(owner);
    if (previous.status === 'running') return feed(owner);
    if (!deps.configured()) throw new TrendError(503, 'Add OPENROUTER_API_KEY on the server to start Trend Research.');
    if (previous.startedAt && deps.now().getTime() - Date.parse(previous.startedAt) < 60000) {
      throw new TrendError(429, 'Please wait a minute between research pulls.');
    }
    const state: StateDoc = {
      ...previous, initialized: true, runId: randomUUID(), status: 'running',
      startedAt: deps.now().toISOString(), heartbeatAt: deps.now().toISOString(), error: null,
      coverage: CHANNELS.map((channel) => ({ channel, status: 'pending', topicCount: 0, note: null })),
    };
    const claimed = await store.trendStates.compareAndSet({ owner, runId: previous.runId, status: previous.status }, state);
    if (!claimed) return feed(owner);
    const heartbeat = setInterval(() => { void store.trendStates.compareAndSet({ owner, runId: state.runId, status: 'running' }, { heartbeatAt: deps.now().toISOString() }).catch(() => {}); }, 30000);
    const job = work(owner, state, prefs).catch(async () => {
      await store.trendStates.compareAndSet({ owner, runId: state.runId, status: 'running' }, {
        status: 'failed', error: 'Research was interrupted. Existing topics are saved; try a manual pull.',
      });
    }).finally(() => { clearInterval(heartbeat); jobs.delete(owner); });
    jobs.set(owner, job);
    void job.catch(() => {});
    return feed(owner);
  }

  return { feed, start, waitForIdle: (owner: string) => jobs.get(owner) ?? Promise.resolve() };
}

export const trends = createTrendService();
