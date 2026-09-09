import { useLocation } from 'preact-iso';
import { useTrends } from '../trends';

/** Shared manual entry point. Reading a saved feed never starts research. */
export function ResearchStart() {
  const { route, path } = useLocation();
  const { feed, loading, starting, refresh } = useTrends();
  const running = starting || feed?.state.status === 'running';
  const last = feed?.state.lastPulledAt;
  const lastDate = last ? new Date(last) : null;
  const label = feed?.state.status === 'failed' ? 'Last attempt' : 'Last research';
  const hasFindings = (feed?.topics.length ?? 0) > 0;

  const start = () => {
    route('/app/research');
    window.scrollTo({ top: 0, behavior: 'instant' });
    void refresh();
  };

  return <div class="research-start">
    <p class="research-start__last">
      {lastDate && Number.isFinite(lastDate.getTime()) ? <>{label} <time dateTime={last!}>{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(lastDate)}</time></> : loading ? 'Loading saved research…' : 'No research yet'}
    </p>
    <div class="research-start__actions">
      {running && path !== '/app/research' ? <a class="btn" href="/app/research">View research in progress ↗</a> :
        <button class="btn btn--solid" type="button" disabled={loading || running} onClick={start}>
          <span class="btn__text">{running ? 'Researching…' : 'Start Research'}</span><span class="btn__arrow" aria-hidden="true">↗</span>
        </button>}
      {hasFindings && <a class="btn" href="/app/discover">Discover ↗</a>}
    </div>
  </div>;
}
