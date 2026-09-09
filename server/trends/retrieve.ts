import type { OnboardingPrefs, TrendChannel } from '../../shared/types.js';
import type { Evidence, ProviderReport, ResearchSource } from '../../shared/evidence.js';
import type { ResearchResult } from '../llm/research.js';
import { ResearchError } from '../research/errors.js';
import { evidenceResult } from '../research/evidence.js';
import { researchReddit, researchWeb } from '../research/openrouter-web.js';
import { researchTrends, researchYoutube } from '../research/serpapi.js';

/**
 * Stage 1 of Start Research: retrieve source evidence.
 *
 * Each channel goes to exactly one provider and keeps that provider's label:
 * Google Trends and YouTube use SerpApi; Reddit and the wider web use Perplexity
 * search through OpenRouter. Nothing here analyses or interprets the evidence —
 * synthesis happens afterwards in `synthesize.ts`, so a topic can only ever cite
 * a URL that a provider actually returned.
 */

export const CHANNEL_SOURCE: Record<TrendChannel, ResearchSource> = {
  reddit: 'reddit', youtube: 'youtube', 'google-trends': 'trends', web: 'web',
};

/** Each Google Trends term costs two SerpApi requests (timeseries + related). */
export const MAX_TREND_TERMS = 2;

/** Reported when the user has no usable interest term to measure. */
export const NO_TERMS_REASON = 'no-interest-terms: add an interest in Preferences to measure search momentum';

export interface RetrieveDeps {
  web?: typeof researchWeb;
  reddit?: typeof researchReddit;
  youtube?: typeof researchYoutube;
  trends?: typeof researchTrends;
  signal?: AbortSignal;
}

/**
 * One-term Google Trends queries, taken from the user's interests.
 * Trends rejects comma-separated comparisons, and over-long phrases return no
 * volume, so both are filtered out rather than sent and reported as empty.
 */
export function trendTerms(prefs: OnboardingPrefs, limit = MAX_TREND_TERMS): string[] {
  return [...new Set(
    (prefs.interests ?? []).map((term) => term.trim())
      .filter((term) => term.length >= 3 && term.length <= 60 && !term.includes(',')),
  )].slice(0, limit);
}

/** The retrieval query for a channel. Keyword-shaped, not an instruction. */
export function searchQuery(channel: TrendChannel, prefs: OnboardingPrefs, now: Date): string {
  const interests = (prefs.interests ?? []).slice(0, 4).map((s) => s.trim()).filter(Boolean).join(' OR ');
  const base = interests || 'emerging US consumer culture';
  const month = now.toISOString().slice(0, 7);
  switch (channel) {
    case 'reddit': return `${base} ("United States" OR USA OR American) ${month}`;
    case 'youtube': return `${base} United States ${month}`;
    case 'web': return `${base} emerging US consumer behavior ${month}`;
    case 'google-trends': return trendTerms(prefs)[0] ?? base;
  }
}

/** Retrieve one channel's evidence, tolerating a partial multi-term Trends pull. */
export async function retrieveChannelEvidence(
  channel: TrendChannel, prefs: OnboardingPrefs, now: Date, deps: RetrieveDeps = {},
): Promise<ResearchResult> {
  const source = CHANNEL_SOURCE[channel];
  if (source === 'trends') {
    const terms = trendTerms(prefs);
    if (!terms.length) {
      return evidenceResult([], [{ provider: 'serpapi-trends', reason: NO_TERMS_REASON, attempts: 0, status: 'empty' }]);
    }
    const evidence: Evidence[] = [];
    const reports: ProviderReport[] = [];
    let failure: ResearchError | null = null;
    for (const term of terms) {
      if (deps.signal?.aborted) throw new ResearchError('cancelled', 'Research cancelled.', 'serpapi-trends');
      try {
        const result = await (deps.trends ?? researchTrends)(term, { signal: deps.signal });
        evidence.push(...result.evidence);
        reports.push(...result.providers);
      } catch (error) {
        if (!(error instanceof ResearchError)) throw error;
        if (error.kind === 'cancelled') throw error;
        failure = error;
        evidence.push(...error.partialEvidence);
        reports.push({ provider: error.provider, reason: error.reason, attempts: error.attempts, status: error.partialEvidence.length ? 'partial' : 'failed', error: { kind: error.kind, message: error.message } });
        // Bad credentials or a quota block apply to every remaining term.
        if (['credentials', 'rate_limited', 'budget'].includes(error.kind)) break;
      }
    }
    if (failure && !evidence.length) { failure.reports = reports; throw failure; }
    return evidenceResult(evidence, reports);
  }
  const query = searchQuery(channel, prefs, now);
  if (source === 'youtube') return (deps.youtube ?? researchYoutube)(query, { signal: deps.signal });
  if (source === 'reddit') return (deps.reddit ?? researchReddit)(query, { signal: deps.signal });
  return (deps.web ?? researchWeb)(query, { signal: deps.signal });
}
