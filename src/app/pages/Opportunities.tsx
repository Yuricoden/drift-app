import { useEffect, useState } from 'preact/hooks';
import type { Opportunity } from '../../../shared/types';
import { useSignals } from '../signals';
import { HypothesisEvidence } from '../components/HypothesisEvidence';
import { industryName } from '../../../shared/catalog/industries';
import { api } from '../api';
import { EmptyState, Loading, SaveButton } from '../components/ui';

export function Opportunities() {
  const { signals } = useSignals();
  const signalById = (id: string) => signals.find(s => s.id === id);
  const [error, setError] = useState('');
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api.opportunities(includeLegacy).then(setItems).catch((e: Error) => { setError(e.message); setItems(previous => previous ?? []); });
  }, [includeLegacy]);

  const regenerate = async (opportunity: Opportunity) => {
    setBusyId(opportunity.id);
    setError('');
    try {
      const updated = await api.regenerateOpportunity(opportunity.id);
      setItems((list) => (list ?? []).map((o) => (o.id === updated.id ? updated : o)));
    } catch (e) { setError(e instanceof Error ? e.message : 'Regeneration failed. Existing results are retained.'); } finally {
      setBusyId(null);
    }
  };

  if (items === null) {
    return <div class="page"><Loading label="Gathering opportunities…" /></div>;
  }

  return (
    <div class="page opportunities">
      <header class="page-head">
        <p class="page-head__tag mono">04 / Opportunities</p>
        <h1 class="page-head__title">Concepts at the<br /><em>edge of the shift.</em></h1>
        <p class="page-head__sub">Product, startup, and brand opportunities generated from your transfers and signals.</p>
      </header>

      {error && <p role="alert">{error}</p>}
      {/* <label><input type="checkbox" checked={includeLegacy} onChange={e => setIncludeLegacy(e.currentTarget.checked)} /> Include legacy template items</label> */}
      {items.length === 0 && (
        <EmptyState title="No opportunities yet" body="Generate them from a signal page, the Transfer Lab, or Ask DRIFT.">
          <a class="btn btn--solid" href="/app/transfer"><span class="btn__text">Open the Transfer Lab</span><span class="btn__arrow">↗</span></a>
        </EmptyState>
      )}

      <ol class="opportunities__list">
        {items.map((opportunity, i) => {
          const signal = signalById(opportunity.signalId);
          const open = openId === opportunity.id;
          return (
            <li key={opportunity.id} class={`opportunity${open ? ' is-open' : ''}`}>
              <button type="button" class="opportunity__head" onClick={() => setOpenId(open ? null : opportunity.id)} aria-expanded={open}>
                <span class="opportunity__index mono">{String(i + 1).padStart(2, '0')}</span>
                <span class="opportunity__main">
                  <span class="opportunity__name">{opportunity.name}</span>
                  <span class="opportunity__concept">{opportunity.concept}</span>
                </span>
                <span class="opportunity__side mono">
                  <span>{signal?.name ?? opportunity.signalId} × {industryName(opportunity.industryId)}</span>
                  <span>{opportunity.provenance ? 'Hypothesis' : 'Legacy template'}</span>
                </span>
                <span class="opportunity__toggle" aria-hidden="true">{open ? '−' : '+'}</span>
              </button>

              {open && (
                <div class="opportunity__body">
                  <HypothesisEvidence analysis={opportunity.analysis} provenance={opportunity.provenance} />
                  <dl class="opportunity__fields">
                    <div><dt class="mono">Audience</dt><dd>{opportunity.audience}</dd></div>
                    <div><dt class="mono">Cultural insight</dt><dd>{opportunity.culturalInsight}</dd></div>
                    <div><dt class="mono">Why now</dt><dd>{opportunity.whyNow}</dd></div>
                    <div><dt class="mono">Differentiation</dt><dd>{opportunity.differentiation}</dd></div>
                    <div><dt class="mono">Risk</dt><dd>{opportunity.risk}</dd></div>
                  </dl>
                  <div class="opportunity__actions">
                    <SaveButton type="opportunity" refId={opportunity.id} />
                    <button type="button" class="btn" disabled={busyId !== null || !opportunity.provenance} onClick={() => void regenerate(opportunity)}>
                      <span class="btn__text">{busyId === opportunity.id ? 'Regenerating…' : 'Regenerate'}</span>
                    </button>
                    <a class="btn btn--solid" href={`/app/opportunities/${opportunity.id}`}><span class="btn__text">Develop Further</span><span class="btn__arrow">↗</span></a>
                    {signal && <a class="text-link" href={`/app/signals/${signal.id}`}>View source signal ↗</a>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
