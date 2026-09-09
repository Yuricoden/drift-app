import type { Evidence, ProviderReport, ResearchSource } from '../../shared/evidence.js';
import type { ResearchDeps, ResearchResult } from '../llm/research.js';
import { researchReddit, researchWeb } from './openrouter-web.js';
import { researchTrends, researchYoutube, type YoutubeDeps } from './serpapi.js';
import { evidenceResult } from './evidence.js';
import { ResearchError } from './errors.js';

export const ALL_SOURCES: ResearchSource[] = ['web', 'reddit', 'youtube', 'trends'];
/** SerpApi serves YouTube and Google Trends; OpenRouter serves web and Reddit. */
export const SERP_SOURCES: ResearchSource[] = ['youtube', 'trends'];
const serpProvider = (source: ResearchSource) => source === 'trends' ? 'serpapi-trends' as const : 'serpapi-youtube' as const;

export interface CollectDeps {
  web?: typeof researchWeb;
  reddit?: typeof researchReddit;
  youtube?: typeof researchYoutube;
  trends?: typeof researchTrends;
  webOptions?: ResearchDeps;
  serpOptions?: YoutubeDeps;
  signal?: AbortSignal;
}

export function parseSources(value: unknown): ResearchSource[] {
  if (value === undefined) return ['web'];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || !values.length || values.length > ALL_SOURCES.length || values.some((v) => !ALL_SOURCES.includes(v))) {
    throw new ResearchError('invalid', 'sources must contain web, reddit, youtube, and/or trends.');
  }
  return [...new Set(values)] as ResearchSource[];
}

/**
 * Collect evidence from the requested sources. Each source keeps its own
 * provider: a failure is reported per service and never silently re-routed to a
 * different one, and one service's bad credentials cannot burn another's quota.
 */
export async function collectResearch(query: string, sources: ResearchSource[] = ['web'], deps: CollectDeps = {}): Promise<ResearchResult> {
  const selected = parseSources(sources);
  const evidence: Evidence[] = [];
  const reports: ProviderReport[] = [];
  const answers: string[] = [];
  const results: ResearchResult[] = [];
  let blockedSerp: ResearchError | null = null;
  let failure: ResearchError | null = null;
  for (const source of selected) {
    if (deps.signal?.aborted) throw new ResearchError('cancelled', 'Research cancelled.');
    const serp = SERP_SOURCES.includes(source);
    try {
      if (serp && blockedSerp) throw new ResearchError(blockedSerp.kind, blockedSerp.message, serpProvider(source), 'shared-credentials-or-rate-limit', 0);
      const result = serp
        ? await (source === 'trends' ? deps.trends ?? researchTrends : deps.youtube ?? researchYoutube)(query, { ...deps.serpOptions, signal: deps.signal })
        : await (source === 'reddit' ? deps.reddit ?? researchReddit : deps.web ?? researchWeb)(query, { ...deps.webOptions, signal: deps.signal });
      results.push(result); evidence.push(...result.evidence); reports.push(...result.providers);
      if (result.answer) answers.push(result.answer);
    } catch (error) {
      if (!(error instanceof ResearchError)) throw error;
      if (error.kind === 'cancelled') throw error;
      failure = error;
      if (serp && ['credentials', 'rate_limited'].includes(error.kind)) blockedSerp = error;
      evidence.push(...error.partialEvidence);
      reports.push({ provider: error.provider, reason: error.reason, attempts: error.attempts, status: error.partialEvidence.length ? 'partial' : 'failed', error: { kind: error.kind, message: error.message } });
    }
  }
  if (failure && !results.length && !evidence.length) {
    failure.reports = reports;
    throw failure;
  }
  const merged = evidenceResult(evidence, reports, answers.join('\n\n') || undefined);
  merged.totalCost = results.some((r) => r.totalCost !== null) ? results.reduce((sum, r) => sum + (r.totalCost ?? 0), 0) : null;
  merged.primaryCost = merged.totalCost;
  return merged;
}
