import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, COLLECTIONS, type HydratedSaved } from '../api';
import { industryName } from '../../../shared/catalog/industries';
import { Chip, EmptyState, Loading } from '../components/ui';

function hrefFor(entry: HydratedSaved): string {
  if (entry.item.type === 'signal') return `/app/signals/${entry.item.refId}`;
  if (entry.item.type === 'transfer') {
    const t = entry.transfer;
    return t ? `/app/transfer?transfer=${t.id}` : '/app/transfer';
  }
  return `/app/opportunities/${entry.item.refId}`;
}

function titleFor(entry: HydratedSaved): string {
  if (entry.signal) return entry.signal.name;
  if (entry.transfer) return `${entry.transfer.provenance?.sourceSignalName ?? entry.transfer.signalId} × ${industryName(entry.transfer.industryId)}`;
  if (entry.opportunity) return entry.opportunity.name;
  return `Unavailable saved signal (${entry.item.refId})`;
}

function subFor(entry: HydratedSaved): string {
  if (entry.signal) return entry.signal.summary;
  if (entry.transfer) return entry.transfer.provenance ? 'Saved transfer hypothesis.' : 'Legacy template experiment — not research-backed.';
  if (entry.opportunity) return `${entry.opportunity.provenance ? 'Hypothesis' : 'Legacy template'} · ${entry.opportunity.concept}`;
  return '';
}

export function Saved() {
  const [entries, setEntries] = useState<HydratedSaved[] | null>(null);
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [error, setError] = useState('');
  const [collection, setCollection] = useState<string | null>(null);

  const load = () => api.saved().then(setEntries).catch((e: Error) => { setError(e.message); setEntries(previous => previous ?? []); });
  useEffect(() => {
    void load();
  }, []);

  const collections = useMemo(() => {
    const names = new Set<string>(COLLECTIONS);
    (entries ?? []).forEach((e) => names.add(e.item.collection));
    return Array.from(names);
  }, [entries]);

  const visible = (entries ?? []).filter(e => (includeLegacy || (e.signal || e.transfer?.provenance || e.opportunity?.provenance)) && (!collection || e.item.collection === collection));

  const remove = async (id: string) => {
    await api.unsave(id).catch(() => {});
    setEntries((list) => (list ?? []).filter((e) => e.item.id !== id));
  };

  const move = async (id: string, next: string) => {
    const updated = await api.moveSaved(id, next).catch(() => null);
    if (updated) setEntries((list) => (list ?? []).map((e) => (e.item.id === id ? { ...e, item: updated } : e)));
  };

  if (entries === null) {
    return <div class="page"><Loading label="Opening your collection…" /></div>;
  }

  return (
    <div class="page saved">
      <header class="page-head">
        <p class="page-head__tag mono">06 / Saved</p>
        <h1 class="page-head__title">Your field<br /><em>notes.</em></h1>
        <p class="page-head__sub">Signals, transfer experiments, and opportunities you kept. Organised into collections.</p>
      </header>

      {error && <p role="alert">{error}</p>}
      {/* <label><input type="checkbox" checked={includeLegacy} onChange={e => setIncludeLegacy(e.currentTarget.checked)} /> Include legacy and unavailable items</label> */}
      <div class="filters__row" role="group" aria-label="Filter by collection">
        <Chip active={collection === null} onClick={() => setCollection(null)}>All saved</Chip>
        {collections.map((c) => (
          <Chip key={c} active={collection === c} onClick={() => setCollection(collection === c ? null : c)}>{c}</Chip>
        ))}
      </div>

      {visible.length === 0 && (
        <EmptyState
          title={entries.length === 0 ? 'Nothing saved yet' : 'This collection is empty'}
          body={entries.length === 0 ? 'Save signals, transfers, and opportunities as you explore — they will live here.' : 'Move something here from another collection.'}
        >
          {entries.length === 0 && <a class="btn btn--solid" href="/app/discover"><span class="btn__text">Explore signals</span><span class="btn__arrow">↗</span></a>}
        </EmptyState>
      )}

      <ul class="saved__list">
        {visible.map((entry) => (
          <li key={entry.item.id} class="saved__row">
            <span class={`saved__type mono saved__type--${entry.item.type}`}>
              {entry.item.type === 'signal' ? 'Signal' : entry.item.type === 'transfer' ? 'Transfer' : 'Opportunity'}
            </span>
            <a class="saved__main" href={hrefFor(entry)}>
              <span class="saved__title">{titleFor(entry)}</span>
              <span class="saved__sub">{subFor(entry)}</span>
            </a>
            <span class="saved__meta">
              <select
                class="saved__collection mono"
                value={entry.item.collection}
                aria-label="Move to collection"
                onChange={(e) => void move(entry.item.id, (e.target as HTMLSelectElement).value)}
              >
                {collections.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" class="saved__remove" aria-label="Remove from saved" onClick={() => void remove(entry.item.id)}>✕</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
