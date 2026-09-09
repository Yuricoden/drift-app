import type { AskResult, OnboardingPrefs } from '../../shared/types';
import { listSignals } from '../repos';
import { momentumLabel } from '../../shared/signals';
import { runResearch } from '../llm/research';

/** Read-only compatibility answer: no seeded experiments or implicit generation. */
export async function askDrift(owner: string, question: string, _prefs: OnboardingPrefs, opts: { useWeb?: boolean } = {}): Promise<AskResult> {
  if (opts.useWeb) {
    const research = await runResearch(question);
    return { question, answer: research.answer, signalIds: [], opportunities: [], references: [], engine: 'openrouter',
      research: { provider: research.provider, fallbackReason: null, citations: research.citations, evidence: research.evidence, providers: research.providers, reason: research.reason, insufficientEvidence: research.insufficientEvidence } };
  }
  const words = question.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const signals = (await listSignals(owner)).filter(s => words.some(w => `${s.name} ${s.summary}`.toLowerCase().includes(w))).slice(0, 4);
  return { question, answer: signals.length ? signals.map(s => `${s.name}: ${s.summary} Momentum: ${momentumLabel(s)}.`).join('\n\n') + '\n\nOpen Transfer Lab to explicitly generate a hypothesis.' : 'No matching saved research signals. Analyze saved research or start research explicitly. AI generation requires the configured analysis gateway.',
    signalIds: signals.map(s => s.id), opportunities: [], references: signals.map(s => ({ kind: 'signal', label: s.name, href: `/app/signals/${s.id}` })), engine: 'drift', research: null };
}
