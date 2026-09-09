import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { api, COLLECTIONS } from '../api';
import type { SignalStage } from '../../../shared/types';

export function Chip(props: { active?: boolean; onClick?: () => void; children: ComponentChildren }) {
  return (
    <button
      type="button"
      class={`chip${props.active ? ' is-active' : ''}`}
      aria-pressed={props.active ? 'true' : 'false'}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function PageHead(props: { index: string; title: ComponentChildren; sub?: ComponentChildren }) {
  return (
    <header class="page-head">
      <p class="page-head__tag mono">{props.index}</p>
      <h1 class="page-head__title">{props.title}</h1>
      {props.sub && <p class="page-head__sub">{props.sub}</p>}
    </header>
  );
}

export function StageTag(props: { stage: SignalStage }) {
  return <span class={`stage-tag stage-tag--${props.stage.toLowerCase()}`}>{props.stage}</span>;
}

export function MomentumBar(props: { value: number; large?: boolean }) {
  return (
    <span class={`momentum${props.large ? ' momentum--large' : ''}`} title={`Momentum ${props.value}/100`}>
      <span class="momentum__track">
        <span class="momentum__fill" style={{ width: `${props.value}%` }} />
      </span>
      <span class="momentum__value mono">{props.value}</span>
    </span>
  );
}

export function EmptyState(props: { title: string; body: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <p class="empty__mark" aria-hidden="true">✳</p>
      <h2 class="empty__title">{props.title}</h2>
      <p class="empty__body">{props.body}</p>
      {props.children}
    </div>
  );
}

export function Loading(props: { label?: string }) {
  return (
    <div class="loading" role="status">
      <span class="loading__dot" />
      <span class="mono">{props.label ?? 'Reading the field…'}</span>
    </div>
  );
}

/** Save button with a small collection chooser. */
export function SaveButton(props: { type: 'signal' | 'transfer' | 'opportunity'; refId: string; compact?: boolean }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (collection: string) => {
    setBusy(true);
    try {
      const item = await api.save(props.type, props.refId, collection);
      setSaved(item.collection);
    } catch {
      // leave unsaved state; the user can retry
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  if (saved) {
    return (
      <span class={`save-btn is-saved${props.compact ? ' save-btn--compact' : ''}`} title={`Saved to ${saved}`}>
        Saved ✓ <span class="save-btn__collection mono">{saved}</span>
      </span>
    );
  }

  return (
    <span class="save-btn-wrap">
      <button type="button" class={`save-btn${props.compact ? ' save-btn--compact' : ''}`} disabled={busy} onClick={() => setOpen(!open)}>
        {busy ? 'Saving…' : 'Save +'}
      </button>
      {open && (
        <span class="save-btn__menu" role="menu">
          {COLLECTIONS.map((collection) => (
            <button key={collection} type="button" onClick={() => void save(collection)}>{collection}</button>
          ))}
        </span>
      )}
    </span>
  );
}
