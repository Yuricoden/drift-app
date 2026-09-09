import type { GenerationProvenance, HypothesisAnalysis } from '../../../shared/types';
import { EvidenceList } from './EvidenceList';

export function HypothesisEvidence({ analysis, provenance }: { analysis?: HypothesisAnalysis; provenance?: GenerationProvenance }) {
  if (!analysis || !provenance) return <p class="trend-notice">Legacy template item — not research-backed. Preserved for reference; AI regeneration and refinement are unavailable.</p>;
  return <section class="hypothesis-evidence">
    <p class="mono">Hypothesis · Not a validated business opportunity</p>
    <h3 class="section-label mono">Supported observations</h3>
    <ul>{analysis.observations.map((o, i) => <li key={i}>{o.text} {o.evidenceUrls.map(url => <a class="text-link" key={url} href={url} target="_blank" rel="noopener noreferrer">{provenance.evidenceSnapshot.find(e => e.url === url)?.title ?? 'Source'} ↗</a>)}</li>)}</ul>
    <h3 class="section-label mono">Target-industry assumptions to test</h3>
    <ul>{analysis.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
    <details><summary>Evidence snapshot and generation provenance</summary>
      <p class="mono">{provenance.sourceSignalName} · {provenance.model} · {new Date(provenance.generatedAt).toLocaleString()} · {provenance.analysisVersion}</p>
      <EvidenceList evidence={provenance.evidenceSnapshot} />
    </details>
  </section>;
}
