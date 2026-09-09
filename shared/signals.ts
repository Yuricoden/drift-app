import type { ExtractedSignal } from './types';
import { INDUSTRY_MAP } from './catalog/industries';

export const validIndustries = (ids: string[]) => [...new Set(ids.filter(id => INDUSTRY_MAP.has(id)))];
export function momentumLabel(signal: ExtractedSignal): string {
  const measured = signal.momentumEvidence.filter(m => m.slope12Month !== null);
  return measured.length ? measured.map(m => `${m.term}: ${m.slope12Month! > 0 ? '+' : ''}${m.slope12Month} index points/month (Google Trends, US, 12 months)`).join(' · ') : 'Not measured';
}
export function signalAssociations(signals: ExtractedSignal[]) {
  return signals.flatMap(s => validIndustries(s.industries).map(industryId => ({ signalId: s.id, industryId, label: 'AI-classified association' as const })));
}
