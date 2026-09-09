import { useEffect, useState } from 'preact/hooks';
import type { Opportunity, WorkspaceSections } from '../../../shared/types';
import { useSignals } from '../signals';
import { HypothesisEvidence } from '../components/HypothesisEvidence';
import { industryName } from '../../../shared/catalog/industries';
import { api } from '../api';
import { EmptyState, Loading, SaveButton } from '../components/ui';

const SECTIONS: { key: keyof WorkspaceSections; label: string }[] = [
  { key: 'concept', label: 'Concept' },
  { key: 'targetCustomer', label: 'Target customer' },
  { key: 'problem', label: 'Problem' },
  { key: 'productBehavior', label: 'Product behavior' },
  { key: 'whyNow', label: 'Why now' },
  { key: 'differentiation', label: 'Differentiation' },
  { key: 'culturalEvidence', label: 'Cultural evidence' },
  { key: 'assumptions', label: 'Assumptions' },
  { key: 'risks', label: 'Risks' },
  { key: 'validationExperiment', label: 'Validation experiment' },
];

export function Workspace(props: { id?: string }) {
  const { signals } = useSignals();
  const signalById = (id: string) => signals.find(s => s.id === id);
  const [error, setError] = useState('');
  const [opportunity, setOpportunity] = useState<Opportunity | null | 'missing'>(null);
  const [refining, setRefining] = useState<string | null>(null);

  useEffect(() => {
    if (!props.id) return;
    api.opportunity(props.id).then(setOpportunity).catch(() => setOpportunity('missing'));
  }, [props.id]);

  if (opportunity === null) {
    return <div class="page"><Loading label="Opening the workspace…" /></div>;
  }

  if (opportunity === 'missing') {
    return (
      <div class="page">
        <EmptyState title="Opportunity not found" body="It may have been generated in another session.">
          <a class="btn" href="/app/opportunities"><span class="btn__text">Back to Opportunities</span></a>
        </EmptyState>
      </div>
    );
  }

  const signal = signalById(opportunity.signalId);

  const refine = async (section: keyof WorkspaceSections) => {
    setRefining(section);
    setError('');
    try {
      const result = await api.refineSection(opportunity.id, section);
      setOpportunity(result.opportunity);
    } catch (e) { setError(e instanceof Error ? e.message : 'Refinement failed. Existing results are retained.'); } finally {
      setRefining(null);
    }
  };

  return (
    <div class="page workspace">
      <header class="workspace__head">
        <p class="page-head__tag mono">05 / Opportunity workspace</p>
        <h1 class="page-head__title">{opportunity.name}</h1>
        <p class="page-head__sub">
          {signal ? <a class="text-link" href={`/app/signals/${signal.id}`}>{signal.name} ↗</a> : opportunity.signalId}
          {' · '}{industryName(opportunity.industryId)} · {opportunity.provenance ? 'Hypothesis' : 'Legacy template'}
        </p>
        <div class="workspace__head-actions">
          <SaveButton type="opportunity" refId={opportunity.id} />
        </div>
      </header>

      {error && <p role="alert">{error}</p>}
      <HypothesisEvidence analysis={opportunity.analysis} provenance={opportunity.provenance} />
      <div class="workspace__sections">
        {SECTIONS.map(({ key, label }, i) => (
          <section class="workspace__section" key={key}>
            <div class="workspace__section-head">
              <h2 class="workspace__section-label mono">{String(i + 1).padStart(2, '0')} — {label}</h2>
              <button
                type="button"
                class="workspace__refine"
                disabled={refining !== null || !opportunity.provenance}
                onClick={() => void refine(key)}
                title="Refine this section with DRIFT"
              >
                {refining === key ? 'Refining…' : 'Refine ✳'}
              </button>
            </div>
            <p class={`workspace__section-body${refining === key ? ' is-refining' : ''}`}>{opportunity.workspace[key]}</p>
            {opportunity.refinements?.[key] && <HypothesisEvidence {...opportunity.refinements[key]!} />}
          </section>
        ))}
      </div>
    </div>
  );
}
