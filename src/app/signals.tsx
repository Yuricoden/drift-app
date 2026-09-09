import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { ExtractedSignal, ExtractionStatus } from '../../shared/types';
import { api } from './api';
import { useSession } from './store';

interface SignalsState {
  signals: ExtractedSignal[]; status: ExtractionStatus | null; loading: boolean;
  error: string; analyzing: boolean; analyze: () => Promise<void>;
}
const Context = createContext<SignalsState>({ signals: [], status: null, loading: true, error: '', analyzing: false, analyze: async () => {} });
export const useSignals = () => useContext(Context);

/** One owner-scoped read source. Polling is GET-only, including after reload. */
export function SignalsProvider({ children }: { children: ComponentChildren }) {
  const session = useSession();
  const [signals, setSignals] = useState<ExtractedSignal[]>([]);
  const [status, setStatus] = useState<ExtractionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const ownerRevision = useRef(0);
  const reading = useRef(false);
  const signature = useRef('');
  async function read(revision: number) {
    if (reading.current) return;
    reading.current = true;
    try {
      const [items, next] = await Promise.all([api.signals(), api.extractionStatus()]);
      if (revision !== ownerRevision.current) return;
      const json = JSON.stringify(items);
      if (json !== signature.current) { signature.current = json; setSignals(items); }
      setStatus(next); setError('');
    } catch (e) { if (revision === ownerRevision.current) setError(e instanceof Error ? e.message : 'Saved signals could not be read.'); }
    finally { reading.current = false; if (revision === ownerRevision.current) setLoading(false); }
  }
  useEffect(() => {
    const revision = ++ownerRevision.current;
    setSignals([]); signature.current = ''; setStatus(null); setLoading(true); setError('');
    if (!session.authenticated) { setLoading(false); return; }
    void read(revision);
    const timer = setInterval(() => { void read(revision); }, 3000);
    const focus = () => { void read(revision); };
    window.addEventListener('focus', focus);
    return () => { ownerRevision.current++; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [session.authenticated, session.email]);
  const analyze = async () => {
    if (analyzing || status?.state === 'running') return;
    const revision = ownerRevision.current;
    setAnalyzing(true); setError('');
    try {
      const result = await api.extractSignals();
      if (revision === ownerRevision.current) setStatus(result.status);
      await read(revision);
    } catch (e) { if (revision === ownerRevision.current) setError(e instanceof Error ? e.message : 'Analysis could not start.'); }
    finally { setAnalyzing(false); }
  };
  return <Context.Provider value={{ signals, status, loading, error, analyzing, analyze }}>{children}</Context.Provider>;
}

export function ResearchSignalState() {
  const { signals, status, loading, error, analyzing, analyze } = useSignals();
  const noResearch = status && !status.topicCount && !signals.length;
  const needsAnalysis = status && (status.pendingEvidence > 0 || status.state === 'running');
  const noSignals = status?.state === 'complete' && !signals.length;
  if (!loading && !error && !noResearch && !needsAnalysis && !noSignals && !status?.failures.length) return null;
  return <section class="research-signal-state" aria-live="polite">
    {loading && <p role="status">Reading saved research…</p>}
    {error && <p class="trend-notice" role="alert">{error} Existing results are retained.</p>}
    {status && <>
      {noResearch && <p>No saved research yet. <a class="text-link" href="/app/research">Start Research ↗</a></p>}
      {status.failures.map((f, i) => <p key={i} role="alert">Analysis incomplete ({f.kind}): {f.message}</p>)}
      {needsAnalysis && <button class="btn" type="button" disabled={analyzing || status.state === 'running'} onClick={() => void analyze()}>{analyzing || status.state === 'running' ? 'Analyzing saved research…' : 'Analyze saved research'}</button>}
      {status.pendingEvidence > 0 && status.state !== 'running' && <p>Analysis needed. Uses stored evidence only; no new web searches.</p>}
      {noSignals && <p>No supported signals were identified in the saved evidence.</p>}
    </>}
  </section>;
}
