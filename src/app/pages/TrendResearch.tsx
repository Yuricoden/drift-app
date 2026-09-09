import { ResearchSignalState } from '../signals';
import { useMemo, useState } from 'preact/hooks';
import type { TrendChannel, TrendTopic } from '../../../shared/types';
import { Chip, PageHead } from '../components/ui';
import { useSession } from '../store';
import { useTrends } from '../trends';
import { ResearchStart } from '../components/ResearchStart';

const LABELS: Record<TrendChannel, string> = { reddit: 'Reddit', youtube: 'YouTube', 'google-trends': 'Google Trends', web: 'Wider web' };
const CHANNELS = Object.keys(LABELS) as TrendChannel[];
const date = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const clean = (value: string) => value.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '');

function Topic({ topic, index }: { topic: TrendTopic; index: number }) {
  const channels = [...new Set(topic.sources.map((s) => s.channel))];
  return (
    <article class="trend-topic" id={`topic-${topic.id}`}>
      <div class="trend-topic__number mono">{String(index + 1).padStart(2, '0')} <span aria-hidden="true">↗</span></div>
      <div class="trend-topic__main">
        <div class="trend-topic__meta mono"><span>{channels.map((c) => LABELS[c]).join(' / ')}</span><span>Found {date(topic.lastFoundAt)}</span></div>
        <h2>{topic.title}</h2>
        <p class="trend-topic__summary">{clean(topic.summary)}</p>
        <div class="trend-topic__interpretation">
          <h3 class="mono">Why this could matter to you</h3>
          <p>{clean(topic.whyUseful)}</p>
        </div>
        <details class="trend-sources">
          <summary>{topic.sources.length} source{topic.sources.length === 1 ? '' : 's'} · Open the evidence <span aria-hidden="true">+</span></summary>
          <p class="trend-sources__context">US relevance · {clean(topic.usRelevance)}</p>
          <ol>{topic.sources.map((source) => (
            <li key={source.url}>
              <span class="mono">{LABELS[source.channel]}</span>
              <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>
              <span class="trend-sources__url">{new URL(source.url).hostname}</span>
              {source.excerpt && <p>{source.excerpt}</p>}
              {!source.excerpt && <p class="trend-sources__note">Summary based on the cited source evidence. Open the source to read the original.</p>}
            </li>
          ))}</ol>
        </details>
      </div>
      <aside class="trend-opportunity" aria-label={`Business opportunity for ${topic.title}`}>
        <span class="mono trend-opportunity__label">A business possibility <span aria-hidden="true">✳</span></span>
        <p class="trend-opportunity__concept">{clean(topic.opportunity.concept)}</p>
        <h3 class="mono">Who it could serve</h3>
        <p>{clean(topic.opportunity.audience)}</p>
        <h3 class="mono">Your first experiment</h3>
        <p>{clean(topic.opportunity.firstStep)}</p>
        <span class="trend-opportunity__note">AI interpretation · a hypothesis to test</span>
      </aside>
    </article>
  );
}

export function TrendResearch() {
  const { feed, loading, starting, error } = useTrends();
  const session = useSession();
  const [channel, setChannel] = useState<TrendChannel | null>(null);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(12);
  const running = starting || feed?.state.status === 'running';
  const topics = useMemo(() => (feed?.topics ?? []).filter((topic) =>
    (!channel || topic.sources.some((s) => s.channel === channel)) &&
    `${topic.title} ${topic.summary} ${topic.opportunity.concept}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [feed?.topics, channel, query]);
  const sourceCount = new Set(feed?.topics.flatMap((t) => t.sources.map((s) => s.url)) ?? []).size;

  return (
    <div class="page trend-research">
      <PageHead index="Trend Research / United States" title={<>Attention today.<br /><em>Possibility tomorrow.</em></>}
        sub="Conversations, search patterns, and cultural shifts — with a reason to pay attention and a direction to explore." />
      <div class="trend-toolbar">
        <div><p class="mono">Broad research · Reddit &amp; web · YouTube &amp; Trends </p><p>Fresh perspectives, whenever you’re ready.</p></div>
        <ResearchStart />
      </div>
      <p class="trend-calibration">{session.interests.length ? `Through your lens: ${session.interests.slice(0, 5).join(' · ')}.` : 'Exploring emerging US consumer needs and culture.'} <a href="/app/preferences">Retune interests ↗</a></p>
      <p class="trend-policy">Research runs only when requested. Broad pulls look back 30 days; Google Trends measures search interest over 12 months.</p>
      {(error || feed?.state.error) && <div class="trend-notice" role="alert">{error || feed?.state.error}</div>}
      {running && <div class="trend-progress" role="status" aria-live="polite"><span class="trend-progress__star" aria-hidden="true">✳</span><div><strong>{starting ? 'Opening your research field' : 'Listening across the landscape'}</strong><p>{starting ? 'Preparing your searches. Findings will appear below as they arrive.' : `${feed?.state.coverage.filter((c) => !['running', 'pending'].includes(c.status)).length ?? 0} of 4 searches finished. You can keep exploring while we work.`}</p></div></div>}

      <div class="trend-coverage" aria-label="Coverage in the latest pull">
        {CHANNELS.map((key) => {
          const coverage = feed?.state.coverage.find((c) => c.channel === key);
          return <div key={key} class={`trend-coverage__item ${coverage?.status === 'running' ? 'is-running' : ''}`}>
            <span class="mono">{LABELS[key]}</span>
            <strong>{!coverage ? 'Awaiting first pull' : coverage.status === 'complete' ? `${coverage.topicCount} finding${coverage.topicCount === 1 ? '' : 's'}` : coverage.status === 'limited' ? 'Limited evidence' : coverage.status === 'failed' ? 'Unavailable this pull' : coverage.status === 'running' ? 'Searching…' : 'Next in the search'}</strong>
            {coverage?.note && <p>{coverage.note}</p>}
          </div>;
        })}
      </div>
      {/* <p class="trend-coverage-note">Reddit and the wider web are searched with Perplexity through OpenRouter; YouTube and Google Trends come from SerpApi. Each channel keeps its own provider, and a failed channel never borrows another one's results. Metrics appear only when the provider reports them.</p> */}
      <ResearchSignalState />

      <section class="trend-findings" aria-label="Research findings">
        <div class="trend-findings__head"><p class="mono">The research file · {feed?.topics.length ?? 0} topics / {sourceCount} sources</p><label class="trend-search"><span class="sr-only">Search research topics</span><input type="search" placeholder="Find a topic…" value={query} onInput={(e) => { setQuery(e.currentTarget.value); setVisible(12); }} /></label></div>
        <div class="filters__row" role="group" aria-label="Filter by source platform">
          <Chip active={!channel} onClick={() => { setChannel(null); setVisible(12); }}>All sources</Chip>
          {CHANNELS.map((key) => <Chip key={key} active={channel === key} onClick={() => { setChannel(key); setVisible(12); }}>{LABELS[key]}</Chip>)}
        </div>
        {topics.slice(0, visible).map((topic, i) => <Topic key={topic.id} topic={topic} index={i} />)}
        {!topics.length && <div class="trend-empty" role="status"><span aria-hidden="true">✳</span><h2>{loading || running ? 'A little space for what’s next.' : query || channel ? 'Nothing in this part of the field yet.' : 'The field is open.'}</h2><p>{loading || running ? 'Sourced findings will appear here as each search finishes.' : query || channel ? 'Try all sources or a different topic. Some platforms may have limited publicly accessible evidence.' : 'Select Start Research to find sourced topics and business possibilities. Findings stay here between visits.'}</p></div>}
        {topics.length > visible && <button class="trend-more text-link" type="button" onClick={() => setVisible(visible + 12)}>Show more research ({topics.length - visible} remaining) ↓</button>}
      </section>
    </div>
  );
}
