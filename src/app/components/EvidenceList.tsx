import type { Evidence, ResearchMetadata } from '../../../shared/types';

export const PROVIDER_LABELS: Record<string, string> = {
  'perplexity-sonar': 'Perplexity Sonar', 'openrouter-web': 'Wider web · Perplexity',
  'openrouter-reddit': 'Reddit · OpenRouter', 'serpapi-youtube': 'YouTube · SerpApi',
  'serpapi-trends': 'Google Trends · SerpApi', 'serpapi-reddit': 'Reddit · SerpApi (archived)',
  mixed: 'Multiple sources', 'openrouter-native': 'OpenRouter native',
};

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return <div class="research-evidence">{evidence.map((item, i) => {
    const trends = item.metrics.trends;
    const video = item.metrics.youtube;
    return <details key={`${item.provider}:${item.url}`}>
      <summary><span class="mono">{i + 1} / {PROVIDER_LABELS[item.provider] ?? item.provider}</span><strong>{item.title}</strong></summary>
      <a class="text-link" href={item.url} target="_blank" rel="noopener noreferrer">Open original source ↗</a>
      {item.snippet && <p>{item.snippet}</p>}
      {item.date && <p class="research-evidence__meta">Source date: {item.date}</p>}
      {item.source === 'reddit' && <>
        <p class="research-evidence__meta">r/{item.metrics.subreddit} · {item.metrics.kind} · Score: {item.metrics.score ?? 'not reported'}{item.metrics.scoreIsLowerBound ? '+' : ''} · Comments: {item.metrics.commentCount ?? 'not reported'}{item.metrics.commentCountIsLowerBound ? '+' : ''}</p>
        {item.metrics.usBasis && <p class="research-evidence__meta">{item.metrics.usBasis}</p>}
      </>}
      {video && <>
        <p class="research-evidence__meta">
          {video.channel ?? 'Channel not reported'}{video.channelVerified ? ' (verified)' : ''} · Views: {video.views === null ? 'not reported' : video.views.toLocaleString('en-US')} · Length: {video.duration ?? 'not reported'}
        </p>
        <p class="research-evidence__meta">Published: {video.publishedLabel ?? 'not reported'}{video.publishedDaysAgo !== null ? ` (${Math.round(video.publishedDaysAgo)} days ago)` : ''} · Search locale: {video.searchLocale}</p>
        <p class="research-evidence__meta">Search results only: no transcript or comments were read. A US search locale is not evidence the video is about the US.</p>
      </>}
      {trends && <>
        <p>US · Last 12 months · {trends.timeline.length} observations</p>
        <p>12-month slope: {trends.slope12Month === null ? 'insufficient dated observations' : `${trends.slope12Month > 0 ? '+' : ''}${trends.slope12Month} index points per month`}</p>
        {trends.timeline.length > 1 && <svg viewBox="0 0 500 110" role="img" aria-label={`${trends.term}: US relative search interest, 0–100 over the past 12 months`}>
          <path d={trends.timeline.map((point, index) => `${index ? 'L' : 'M'}${(point.timestamp - trends.timeline[0].timestamp) / (trends.timeline.at(-1)!.timestamp - trends.timeline[0].timestamp) * 490 + 5},${105 - point.value}`).join(' ')} fill="none" stroke="currentColor" stroke-width="2" />
        </svg>}
        <p class="research-evidence__meta">Relative search interest, not search volume. Slope is calculated on the server; related-query growth is separate from the original term.</p>
        {!!trends.relatedQueries.length && <ul>{trends.relatedQueries.map((query) => <li key={`${query.kind}:${query.query}`}>
          <a href={query.url} target="_blank" rel="noopener noreferrer">{query.query}</a> — {query.kind === 'rising' ? `${query.breakout ? 'Breakout' : 'Rising'}${query.risingPercent !== null ? ` (${query.risingPercent > 0 ? '+' : ''}${query.risingPercent}%)` : ''}` : `Top query${query.interest !== null ? ` · ${query.interest}/100` : ''}`}
        </li>)}</ul>}
      </>}
      {item.reason && <p class="research-evidence__meta">Provider note: {item.reason}</p>}
    </details>;
  })}</div>;
}

export function ResearchIssues({ research }: { research: ResearchMetadata }) {
  return <>{research.providers?.filter((p) => p.error).map((provider, i) => <p class="trend-notice" role="alert" key={i}>{PROVIDER_LABELS[provider.provider]}: {provider.error!.message}</p>)}</>;
}
