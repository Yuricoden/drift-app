import type { Evidence, ProviderReport } from '../../shared/evidence.js';
import type { ResearchResult } from '../llm/research.js';

export function evidenceResult(evidence: Evidence[], reports: ProviderReport[], answer?: string): ResearchResult {
  const providers = [...new Set(reports.map((r) => r.provider))];
  const unique = [...new Map(evidence.map((e) => [`${e.provider}:${e.url}`, e])).values()];
  return {
    answer: answer ?? unique.map((e) => `${e.title}\n${e.snippet}\nSource: ${e.url}\nMetrics: ${JSON.stringify(e.metrics)}`).join('\n\n'),
    evidence: unique,
    citations: unique.map((e) => ({ url: e.url, title: e.title, content: e.snippet })),
    provider: providers.length === 1 ? providers[0] : 'mixed',
    providers: reports,
    reason: reports.some((r) => r.error) ? 'partial-results' : reports.find((r) => r.reason)?.reason ?? null,
    fallbackReason: null,
    insufficientEvidence: unique.length === 0,
    primaryCost: null, fallbackCost: null, totalCost: null,
  };
}
