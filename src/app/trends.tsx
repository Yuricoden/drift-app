import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { TrendFeed } from '../../shared/types';
import { api } from './api';
import { useSession } from './store';

interface TrendContextState {
  feed: TrendFeed | null;
  loading: boolean;
  starting: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Completion notice for research explicitly started in this app session. */
  toast: { runId: string; totalTopics: number; limited: boolean } | null;
  dismissToast: () => void;
}
const TrendContext = createContext<TrendContextState>({
  feed: null, loading: false, starting: false, error: null, refresh: async () => {}, toast: null, dismissToast: () => {},
});
export const useTrends = () => useContext(TrendContext);

export function TrendResearchProvider({ children }: { children: ComponentChildren }) {
  const session = useSession();
  const [feed, setFeed] = useState<TrendFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<TrendContextState['toast']>(null);
  const refreshing = useRef(false);
  const revision = useRef(0);
  const requestedRun = useRef<string | null>(null);

  // Read saved research whenever authenticated — even before onboarding is
  // complete, so step 4 of onboarding can show research status. Never starts
  // research; read-only.
  useEffect(() => {
    if (!session.authenticated) return;
    let active = true;
    const readRevision = revision.current;
    setLoading(true);
    void api.trends().then((result) => {
      if (active && readRevision === revision.current) { setFeed(result); setError(null); }
    }).catch(async (e: Error) => {
      if (!active || readRevision !== revision.current) return;
      setError(e.message);
      try { const existing = await api.trends(); if (active && readRevision === revision.current) setFeed(existing); } catch { /* original error remains visible */ }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.authenticated, session.email]);

  useEffect(() => {
    if (feed?.state.status !== 'running') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const latest = await api.trends();
        if (!active) return;
        setFeed(latest);
        setError(null);
        if (latest.state.status === 'running') timer = setTimeout(poll, 2500);
      } catch {
        if (active) {
          setError('Connection interrupted. Your research continues on the server; reconnecting…');
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 1500);
    return () => { active = false; clearTimeout(timer); };
  }, [feed?.state.runId, feed?.state.status]);

  useEffect(() => {
    if (!feed || requestedRun.current !== feed.state.runId || feed.state.status === 'running') return;
    // Consume the click's run once. Saved, unrelated, and failed runs never
    // announce success or trigger an extraction request on page entry.
    requestedRun.current = null;
    if (!['complete', 'partial'].includes(feed.state.status) || !feed.topics.length) return;
    const limited = feed.state.coverage.some((c) => c.status === 'limited' || c.status === 'failed');
    setToast({ runId: feed.state.runId, totalTopics: feed.topics.length, limited });
    // Extraction is part of the durable server research job, never a page effect.
  }, [feed?.state.runId, feed?.state.status]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = async () => {
    if (refreshing.current || feed?.state.status === 'running') return;
    refreshing.current = true;
    revision.current += 1;
    setStarting(true);
    setError(null);
    setToast(null);
    requestedRun.current = null;
    try {
      const result = await api.pullTrends('refresh');
      // Only an acknowledged new run can announce completion. Merely reading
      // a saved run (including one still running after reload) cannot arm this.
      if (result.state.runId && result.state.runId !== feed?.state.runId) requestedRun.current = result.state.runId;
      setFeed(result);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Research could not start.'); }
    finally { setStarting(false); refreshing.current = false; }
  };
  return <TrendContext.Provider value={{ feed, loading, starting, error, refresh, toast, dismissToast: () => setToast(null) }}>{children}</TrendContext.Provider>;
}
