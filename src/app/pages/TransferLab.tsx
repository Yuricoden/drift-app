import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useSignals, ResearchSignalState } from '../signals';
import { momentumLabel } from '../../../shared/signals';
import { HypothesisEvidence } from '../components/HypothesisEvidence';
import { INDUSTRIES, INDUSTRY_MAP, industryName } from '../../../shared/catalog/industries';
import type { Transfer } from '../../../shared/types';
import { api } from '../api';
import { EmptyState, Loading, SaveButton } from '../components/ui';

export function TransferLab() {
  const { query } = useLocation();
  const { signals: SIGNALS } = useSignals();
  const signalById = (id: string) => SIGNALS.find(s => s.id === id);
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [signalId, setSignalId] = useState<string | null>(typeof query.signal === 'string' ? query.signal : null);
  const [industryId, setIndustryId] = useState<string | null>(typeof query.industry === 'string' ? query.industry : null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [recent, setRecent] = useState<Transfer[]>([]);
  const [busy, setBusy] = useState(false);
  const [opportunitiesBusy, setOpportunitiesBusy] = useState(false);
  const [generated, setGenerated] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.transfers(includeLegacy).then(setRecent).catch((e: Error) => setError(e.message));
  }, [includeLegacy]);
  useEffect(() => {
    if (typeof query.transfer !== 'string') return;
    let active = true;
    api.transfer(query.transfer).then(t => { if (active) { setTransfer(t); setSignalId(t.signalId); setIndustryId(t.industryId); } }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [query.transfer]);
  useEffect(() => {
    if (typeof query.signal === 'string') setSignalId(query.signal);
    if (typeof query.industry === 'string') setIndustryId(query.industry);
  }, [query.signal, query.industry]);

  const signal = signalId ? signalById(signalId) : undefined;
  const industry = industryId ? INDUSTRY_MAP.get(industryId) : undefined;

  const generate = async () => {
    if (!signal || !industry || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.createTransfer(signal.id, industry.id);
      setTransfer(created);
      setGenerated(null);
      setRecent((r) => [created, ...r].slice(0, 6));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed. Existing results are retained.');
    } finally {
      setBusy(false);
    }
  };

  const generateOpportunities = async () => {
    if (!transfer || opportunitiesBusy) return;
    setOpportunitiesBusy(true);
    setError('');
    try {
      const created = await api.transferOpportunities(transfer.id);
      setGenerated(created.map((o) => ({ id: o.id, name: o.name })));
    } catch (e) { setError(e instanceof Error ? e.message : 'Generation failed. Existing results are retained.'); } finally {
      setOpportunitiesBusy(false);
    }
  };

  const t = transfer?.interpretation;
  const transferSignal = transfer ? signalById(transfer.signalId) : undefined;
  const transferIndustry = transfer ? INDUSTRY_MAP.get(transfer.industryId) : undefined;

  return (
    <div class="page transfer">
      <header class="page-head">
        <p class="page-head__tag mono">03 / Transfer Lab</p>
        <h1 class="page-head__title">Move a signal<br /><em>across a border.</em></h1>
        <p class="page-head__sub">Choose saved evidence and a target industry. AI interprets a hypothesis without new web searches. The industry list is taxonomy, not factual evidence.</p>
      </header>

      <ResearchSignalState />
      {signalId && !signal && <p role="status">This signal is not available in your saved research. Select another signal.</p>}
      <div class="transfer__pickers">
        <section>
          <h2 class="section-label mono">01 — Cultural signal</h2>
          <ul class="transfer__signal-list">
            {SIGNALS.map((s) => (
              <li key={s.id}>
                <button type="button" class={signalId === s.id ? 'is-active' : ''} onClick={() => { setSignalId(s.id); }}>
                  <span class="transfer__signal-name">{s.name}</span>
                  <span class="mono">{momentumLabel(s)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 class="section-label mono">02 — Target industry</h2>
          <div class="transfer__industry-grid">
            {INDUSTRIES.map((i) => (
              <button key={i.id} type="button" class={industryId === i.id ? 'is-active' : ''} onClick={() => { setIndustryId(i.id); }}>
                {i.name}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div class="transfer__go">
        <p class="transfer__equation">
          {signal ? signal.name : '——'} <span aria-hidden="true">×</span> {industry ? industry.name : '——'}
        </p>
        <button type="button" class="btn btn--solid" disabled={!signal || !industry || busy} onClick={() => void generate()}>
          <span class="btn__text">{busy ? 'Interpreting…' : 'Generate interpretation'}</span><span class="btn__arrow">↗</span>
        </button>
      </div>
      {error && <p class="form-error">{error}</p>}
      {busy && <Loading label="Transferring the signal…" />}
      {transfer && t && transferIndustry && (
        <article class="transfer__result">
          <header class="transfer__result-head">
            <p class="mono">Transfer experiment · {transferSignal?.name ?? transfer.provenance?.sourceSignalName ?? transfer.signalId} × {transferIndustry.name}</p>
            <h2>What <em>{transferSignal?.name ?? transfer.provenance?.sourceSignalName ?? transfer.signalId}</em> could mean<br />inside {transferIndustry.name}.</h2>
            <SaveButton type="transfer" refId={transfer.id} />
          </header>

          <HypothesisEvidence analysis={transfer.analysis} provenance={transfer.provenance} />
          <div class="transfer__result-grid">
            <section class="prose-block"><h3 class="prose-block__label mono">What the signal could mean here</h3><p>{t.meaning}</p></section>
            <section class="prose-block"><h3 class="prose-block__label mono">Why the transfer could happen</h3><p>{t.whyTransfer}</p></section>
            <section class="prose-block"><h3 class="prose-block__label mono">Hypothesized target behavior</h3><p>{t.changingBehavior}</p></section>
          </div>

          <div class="transfer__result-lists">
            <ListBlock title="Unmet needs" items={t.unmetNeeds} />
            <ListBlock title="Product implications" items={t.productImplications} />
            <ListBlock title="Brand implications" items={t.brandImplications} />
            <ListBlock title="Risks" items={t.risks} tone="risk" />
            <ListBlock title="Opportunity spaces" items={t.opportunitySpaces} tone="space" />
          </div>

          <footer class="transfer__result-foot">
            {generated ? (
              <div class="transfer__generated">
                <p class="mono">Three opportunities generated — saved to Opportunities</p>
                <ol>
                  {generated.map((o) => (
                    <li key={o.id}><a href={`/app/opportunities/${o.id}`}>{o.name} <span aria-hidden="true">↗</span></a></li>
                  ))}
                </ol>
                <a class="btn" href="/app/opportunities"><span class="btn__text">Open Opportunities</span><span class="btn__arrow">↗</span></a>
              </div>
            ) : (
              <button type="button" class="btn btn--solid" disabled={opportunitiesBusy || !transfer.provenance || !transfer.analysis} onClick={() => void generateOpportunities()}>
                <span class="btn__text">{opportunitiesBusy ? 'Generating…' : 'Generate 3 Opportunities'}</span><span class="btn__arrow">↗</span>
              </button>
            )}
          </footer>
        </article>
      )}

      {/* <label><input type="checkbox" checked={includeLegacy} onChange={e => setIncludeLegacy(e.currentTarget.checked)} /> Include legacy template experiments</label> */}
      {!busy && recent.length > 0 && (
        <section class="transfer__recent">
          <h2 class="section-label mono">Recent experiments</h2>
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setTransfer(r); setSignalId(r.signalId); setIndustryId(r.industryId); setGenerated(null); }}>
                  <span>{signalById(r.signalId)?.name ?? r.signalId} × {industryName(r.industryId)}</span>
                  <span class="mono">{r.provenance ? 'Hypothesis' : 'Legacy template'} · {new Date(r.createdAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!transfer && !busy && recent.length === 0 && !signal && (
        <EmptyState title="Start with a signal" body="Pick a signal on the left, an industry on the right, and DRIFT will interpret the crossing." />
      )}
    </div>
  );
}

function ListBlock(props: { title: string; items: string[]; tone?: 'risk' | 'space' }) {
  return (
    <section class={`list-block${props.tone ? ` list-block--${props.tone}` : ''}`}>
      <h3 class="prose-block__label mono">{props.title}</h3>
      <ol>
        {props.items.map((item, i) => (
          <li key={i}>
            <span class="mono">{String(i + 1).padStart(2, '0')}</span>
            <p>{item}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

