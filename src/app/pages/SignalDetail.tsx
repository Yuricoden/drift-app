import { useSignals, ResearchSignalState } from '../signals';
import { SaveButton } from '../components/ui';
import { EmptyState, StageTag } from '../components/ui';
import { EvidenceList } from '../components/EvidenceList';
import type { ExtractedSignal } from '../../../shared/types';

export function SignalDetail(props: { id?: string }) {
  const { signals, loading } = useSignals();
  const signal = signals.find(s => s.id === props.id);
  if (loading) return <div class="page"><ResearchSignalState /></div>;
  if (!signal) return <div class="page"><ResearchSignalState /><EmptyState title="Signal not found" body="This signal is not in your saved research." /></div>;
  const slope = signal.momentumEvidence[0] && signal.momentumEvidence[0].slope12Month;
  const slopeStr = slope != null ? (slope > 0 ? '+' : '') + slope + ' idx/mo' : 'Not measured';

  return <div class="page signal-detail">
    <header class="signal-detail__head">
      <p class="page-head__tag mono">Signal / {signal.category}</p>
      <h1 class="signal-detail__title">{signal.name}</h1>
      <p class="signal-detail__summary">{signal.summary}</p>
      <div class="signal-detail__meta">
        <span class="mono">{slopeStr}</span>
        <StageTag stage={signal.stage} />
        <span class="mono">Model confidence {Math.round(signal.confidence * 100)}%</span>
        <span class="mono">{signal.sourceCount} source{signal.sourceCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="signal-detail__actions">
        <SaveButton type="signal" refId={signal.id} />
        <a class="btn" href={`/app/map?signal=${signal.id}`}><span class="btn__text">Explore on Map</span><span class="btn__arrow">↗</span></a>
        <a class="btn" href={`/app/transfer?signal=${signal.id}`}><span class="btn__text">Transfer Signal</span><span class="btn__arrow">↗</span></a>
        <a class="btn btn--solid" href={`/app/transfer?signal=${signal.id}`}>Choose industry for opportunities ↗</a>
      </div>
    </header>
    <div class="signal-detail__grid">
      <section class="prose-block"><h2 class="prose-block__label mono">What it means</h2><p>{signal.meaning}</p></section>
      <section class="prose-block"><h2 class="prose-block__label mono">Why it may be emerging</h2><p>{signal.why}</p></section>
      {signal.need && <section class="prose-block prose-block--need"><h2 class="prose-block__label mono">The human need</h2><p>{signal.need}</p></section>}
    </div>
    <section class="signal-detail__evidence">
      <h2 class="section-label mono">Evidence - {signal.sourceCount} source{signal.sourceCount !== 1 ? 's' : ''}</h2>
      <EvidenceList evidence={signal.evidence} />
    </section>
    <section class="signal-detail__movement">
      <h2 class="section-label mono">Industries</h2>
      <div class="chip-row">{!signal.industries.length && <span>Unclassified</span>}{signal.industries.map(id => <span key={id} class="chip is-static">{id}</span>)}</div>
      <p class="signal-detail__origin">Extracted from Trend Research · model classification</p>
    </section>
  </div>;
}
