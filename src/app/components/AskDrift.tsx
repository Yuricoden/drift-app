import { useEffect, useRef, useState } from 'preact/hooks';
import { api, streamChatMessage } from '../api';
import { EvidenceList, ResearchIssues, PROVIDER_LABELS } from './EvidenceList';
import type { ActionProposal, ChatMessage, ConversationMeta } from '../../../shared/types';

const EXAMPLES = [
  'What signals could reshape dating?',
  'What is moving from fashion into technology?',
  'What behaviors are emerging around AI and identity?',
  'Find opportunities at the intersection of luxury and digital minimalism.',
  'What signals in my interests are accelerating fastest?',
];

const KIND_LABEL: Record<string, string> = {
  signal: 'Signal',
  map: 'Map',
  transfer: 'Transfer',
  opportunity: 'Opportunity',
};

interface Turn extends ChatMessage {
  streaming?: boolean;
}

export function AskDrift(props: { open: boolean; onClose: () => void }) {
  const [threads, setThreads] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [useWeb, setUseWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setTimeout(() => inputRef.current?.focus(), 250);
    void (async () => {
      try {
        const list = await api.listConversations();
        setThreads(list);
        if (list.length && !activeId) await openThread(list[0].id);
      } catch {
        /* panel still usable */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    if (props.open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open]);

  const scrollDown = () => setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 40);

  async function openThread(id: string) {
    try {
      const convo = await api.getConversation(id);
      setActiveId(id);
      setTurns(convo.messages);
      setError('');
      scrollDown();
    } catch {
      setError('Could not open that conversation.');
    }
  }

  async function newThread() {
    try {
      const convo = await api.createConversation();
      setActiveId(convo.id);
      setTurns([]);
      setError('');
      setThreads(await api.listConversations());
      inputRef.current?.focus();
    } catch {
      setError('Could not start a new conversation.');
    }
  }

  async function removeThread(id: string) {
    try {
      await api.deleteConversation(id);
      const list = await api.listConversations();
      setThreads(list);
      if (activeId === id) {
        setActiveId(null);
        setTurns([]);
        if (list.length) await openThread(list[0].id);
      }
    } catch {
      /* ignore */
    }
  }

  async function ensureThread(): Promise<string | null> {
    if (activeId) return activeId;
    try {
      const convo = await api.createConversation();
      setActiveId(convo.id);
      setThreads(await api.listConversations());
      return convo.id;
    } catch {
      setError('Could not start a conversation.');
      return null;
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const threadId = await ensureThread();
    if (!threadId) return;

    setBusy(true);
    setError('');
    setQuestion('');

    const userTurn: Turn = { id: `u-${Date.now()}`, role: 'user', content: trimmed, createdAt: new Date().toISOString() };
    const assistantTurn: Turn = { id: `a-${Date.now()}`, role: 'assistant', content: '', createdAt: new Date().toISOString(), streaming: true, toolEvents: [] };
    setTurns((t) => [...t, userTurn, assistantTurn]);
    scrollDown();

    const updateAssistant = (fn: (t: Turn) => Turn) => {
      setTurns((all) => all.map((t) => (t.id === assistantTurn.id ? fn(t) : t)));
    };

    abortRef.current = streamChatMessage(threadId, trimmed, useWeb, {
      onToken: (delta) => {
        updateAssistant((t) => ({ ...t, content: t.content + delta }));
        scrollDown();
      },
      onTool: (name, summary) => {
        updateAssistant((t) => ({ ...t, toolEvents: [...(t.toolEvents ?? []), { name, summary }] }));
        scrollDown();
      },
      onDone: (message, proposals) => {
        updateAssistant(() => ({ ...message, proposals, streaming: false }));
        setBusy(false);
        abortRef.current = null;
        void api.listConversations().then(setThreads).catch(() => {});
        scrollDown();
      },
      onError: (kind, message) => {
        updateAssistant((t) => ({ ...t, streaming: false, content: t.content || (kind === 'cancelled' ? '_Stopped._' : t.content) }));
        setBusy(false);
        abortRef.current = null;
        if (kind !== 'cancelled') setError(message || 'DRIFT could not answer right now.');
        scrollDown();
      },
    });
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
  }

  async function confirmProposal(proposal: ActionProposal) {
    if (!activeId) return;
    setConfirming(proposal.id);
    try {
      const result = await api.executeProposal(activeId, proposal.id);
      const noteTurn: Turn = {
        id: `n-${Date.now()}`,
        role: 'assistant',
        content: result.note,
        createdAt: new Date().toISOString(),
        references: result.links.map((l) => ({ kind: 'opportunity' as const, label: l.label, href: l.href })),
      };
      setTurns((t) => [...t, noteTurn]);
      setTurns((t) => t.map((turn) => ({ ...turn, proposals: turn.proposals?.filter((p) => p.id !== proposal.id) })));
      scrollDown();
    } catch {
      setError('That action could not be completed.');
    } finally {
      setConfirming(null);
    }
  }

  return (
    <div class={`ask${props.open ? ' is-open' : ''}`} aria-hidden={!props.open}>
      <div class="ask__backdrop" onClick={props.onClose} />
      <aside class="ask__panel" role="dialog" aria-label="Ask DRIFT">
        <header class="ask__head">
          <p class="ask__title">Ask DRIFT <span aria-hidden="true">✳</span></p>
          <div class="ask__head-actions">
            <button type="button" class="ask__new" onClick={() => void newThread()}>New chat</button>
            <button type="button" class="ask__close" aria-label="Close" onClick={props.onClose}>✕</button>
          </div>
        </header>

        {threads.length > 0 && (
          <div class="ask__threads" role="tablist" aria-label="Conversations">
            {threads.map((t) => (
              <span key={t.id} class={`ask__thread${t.id === activeId ? ' is-active' : ''}`}>
                <button type="button" onClick={() => void openThread(t.id)} title={t.title}>
                  {t.title}
                </button>
                <button type="button" class="ask__thread-del" aria-label={`Delete ${t.title}`} onClick={() => void removeThread(t.id)}>✕</button>
              </span>
            ))}
          </div>
        )}

        <div class="ask__scroll" ref={scrollRef}>
          {turns.length === 0 && !busy && (
            <div class="ask__intro">
              <p>Ask across the whole signal field. I can read the catalog, trace signals, and propose next steps — and with your confirmation, act on them.</p>
              <div class="ask__examples">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" class="ask__example" onClick={() => void send(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              confirming={confirming}
              onConfirm={(p) => void confirmProposal(p)}
              onDismiss={(p) =>
                setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, proposals: x.proposals?.filter((y) => y.id !== p.id) } : x)))
              }
            />
          ))}

          {busy && (
            <div class="ask__thinking mono">
              <span class="loading__dot" /> DRIFT is thinking…
              <button type="button" class="ask__stop" onClick={stop}>Stop</button>
            </div>
          )}
          {error && <p class="ask__error">{error}</p>}
        </div>

        <form
          class="ask__form"
          onSubmit={(event) => {
            event.preventDefault();
            void send(question);
          }}
        >
          <div class="ask__form-row">
            <input
              ref={inputRef}
              value={question}
              onInput={(event) => setQuestion((event.target as HTMLInputElement).value)}
              placeholder="Ask about signals, industries, opportunities…"
              aria-label="Ask DRIFT a question"
            />
            {busy ? (
              <button type="button" class="btn" onClick={stop}><span class="btn__text">Stop</span></button>
            ) : (
              <button type="submit" class="btn btn--solid" disabled={!question.trim()}>
                <span class="btn__text">Ask</span><span class="btn__arrow">↗</span>
              </button>
            )}
          </div>
          <label class="ask__web-toggle">
            <input
              type="checkbox"
              checked={useWeb}
              onChange={(event) => setUseWeb((event.target as HTMLInputElement).checked)}
            />
            <span class="ask__web-box" aria-hidden="true">{useWeb ? '✓' : ''}</span>
            <span>Search the live web for this message <em>(uses research budget)</em></span>
          </label>
        </form>
      </aside>
    </div>
  );
}

function TurnView(props: {
  turn: Turn;
  confirming: string | null;
  onConfirm: (p: ActionProposal) => void;
  onDismiss: (p: ActionProposal) => void;
}) {
  const { turn } = props;
  if (turn.role === 'user') {
    return (
      <div class="turn turn--user">
        <p>{turn.content}</p>
      </div>
    );
  }
  return (
    <div class={`turn turn--assistant${turn.streaming ? ' is-streaming' : ''}`}>
      {turn.toolEvents && turn.toolEvents.length > 0 && (
        <div class="turn__tools">
          {turn.toolEvents.map((t, i) => (
            <span key={i} class="turn__tool mono">
              <span class="turn__tool-mark" aria-hidden="true">✳</span> {t.summary}
            </span>
          ))}
        </div>
      )}
      {turn.content.split('\n\n').filter(Boolean).map((para, i) => (
        <p class="turn__body" key={i}>{para}</p>
      ))}
      {turn.streaming && !turn.content && <span class="loading__dot" />}

      {turn.references && turn.references.length > 0 && (
        <div class="turn__refs">
          {turn.references.map((ref, j) => (
            <a key={j} class="ask__ref" href={ref.href}>
              <span class="mono">{KIND_LABEL[ref.kind] ?? ref.kind}</span>
              {ref.label}
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      )}

      {turn.research && (
        <div class="ask__research">
          <p class="mono ask__research-tag">
            Live research · {PROVIDER_LABELS[turn.research.provider] ?? turn.research.provider}
            {turn.research.fallbackReason ? ` (fallback: ${turn.research.fallbackReason})` : ''}
            {turn.research.insufficientEvidence ? ' — limited evidence found' : ''}
          </p>
          <ResearchIssues research={turn.research} />
          {turn.research.evidence && <EvidenceList evidence={turn.research.evidence} />}
          {!turn.research.evidence && turn.research.citations.length > 0 && (
            <ol class="ask__citations">
              {turn.research.citations.map((c, j) => (
                <li key={j}>
                  <a href={c.url} target="_blank" rel="noreferrer">{c.title || c.url}</a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {turn.proposals && turn.proposals.length > 0 && (
        <div class="turn__proposals">
          {turn.proposals.map((p) => (
            <div key={p.id} class="proposal">
              <span class="proposal__label">{p.label}</span>
              <span class="proposal__actions">
                <button
                  type="button"
                  class="proposal__confirm"
                  disabled={props.confirming === p.id}
                  onClick={() => props.onConfirm(p)}
                >
                  {props.confirming === p.id ? 'Working…' : 'Confirm'}
                </button>
                <button type="button" class="proposal__dismiss" onClick={() => props.onDismiss(p)}>Dismiss</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

