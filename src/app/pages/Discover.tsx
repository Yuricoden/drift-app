import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { useSignals, ResearchSignalState } from '../signals';
import { momentumLabel } from '../../../shared/signals';
import { Chip, PageHead, StageTag } from '../components/ui';
import { useSession } from '../store';
import { useTrends } from '../trends';
import type { ExtractedSignal, SignalStage } from '../../../shared/types';

function rankSignals(signals: ExtractedSignal[], interests: string[]): ExtractedSignal[] {
  return [...signals].sort((a, b) => {
    const aS = a.momentumEvidence[0]?.slope12Month ?? -9999;
    const bS = b.momentumEvidence[0]?.slope12Month ?? -9999;
    const aT = a.tags?.filter((t) => interests.includes(t)).length ?? 0;
    const bT = b.tags?.filter((t) => interests.includes(t)).length ?? 0;
    return bS - aS || bT - aT || b.sourceCount - a.sourceCount;
  });
}
function movingFast(signals: ExtractedSignal[]): ExtractedSignal[] {
  return signals.filter((s) => (s.momentumEvidence[0]?.slope12Month ?? 0) > 0).slice(0, 3);
}

export function Discover() {
  const session = useSession();
  const trends = useTrends();
  const { route } = useLocation();
  const { signals, loading, status, error } = useSignals();
  const [category, setCategory] = useState<string | null>(null);
  const [stage, setStage] = useState<SignalStage | null>(null);

  useEffect(() => {
    if (session.ready && !session.onboardingCompleted) route('/onboarding', true);
  }, [session.ready, session.onboardingCompleted]);

  const ranked = useMemo(() => signals ? rankSignals(signals, session.interests) : [], [signals, session.interests]);
  const catSet = useMemo(() => [...new Set(ranked.map((s) => s.category))], [ranked]);
  const stageNames: SignalStage[] = ['Weak', 'Emerging', 'Accelerating', 'Mainstream'];
  const filtered = ranked.filter((s) => (!category || s.category === category) && (!stage || s.stage === stage));
  const [lead, ...rest] = filtered;
  const fastest = useMemo(() => (!category && !stage) ? movingFast(ranked) : [], [ranked, category, stage]);
  const restAfterFastest = rest.filter((s) => !fastest.includes(s));
  const empty = !loading && !ranked.length;
  const slopeLabel = momentumLabel;

  if (loading) return <div class="page discover"><PageHead index="01 / Discover" title={<>What culture is<br /><em>quietly doing next.</em></>} sub="Reading the research field…" /></div>;

  return (<div class="page discover">
    <PageHead index="01 / Discover" title={<>What culture is<br /><em>quietly doing next.</em></>}
      sub={empty ? 'Run Trend Research to surface cultural signals from real evidence.'
        : session.interests.length ? `Tuned to your curiosity: ${session.interests.slice(0, 4).join(' · ')}` : `${ranked.length} signal${ranked.length === 1 ? '' : 's'} surfaced from your research.`} />

    <ResearchSignalState />
    <a class="trend-discover-link" href="/app/research">
      <span><span class="mono">Trend Research · United States</span><strong>{trends.feed?.state.status === 'running' ? 'New findings are taking shape.' : 'From the conversation to your next opportunity.'}</strong></span>
      <span>{trends.feed?.topics.length ? `${trends.feed.topics.length} findings` : 'Start Research'} ↗</span>
    </a>
{empty ? (
        <div class="empty" hidden={!!error || !!status?.topicCount}>
          <p class="empty__mark" aria-hidden="true">✳</p>
          <h2 class="empty__title">No signals yet</h2>
          <p class="empty__body">Start Trend Research to surface real signals from US conversations, search patterns and cultural evidence. Signals build with every research pull.</p>
          <a class="btn btn--solid" href="/app/research">Start Research ↗</a>
        </div>
      ) : (<>
        <div class="filters">
          <div class="filters__row" role="group" aria-label="Filter by territory">
            <Chip active={category === null} onClick={() => setCategory(null)}>All territories</Chip>
            {catSet.map((c) => <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>{c}</Chip>)}
          </div>
          <div class="filters__row" role="group" aria-label="Filter by stage">
            <Chip active={stage === null} onClick={() => setStage(null)}>Any stage</Chip>
            {stageNames.map((s) => <Chip key={s} active={stage === s} onClick={() => setStage(stage === s ? null : s)}>{s}</Chip>)}
          </div>
        </div>

        {filtered.length === 0 && <p class="discover__none">No signals match — try widening the filters.</p>}

        {lead && (
          <a class="discover__lead" href={`/app/signals/${lead.id}`}>
            <div class="discover__lead-meta mono">
              <span>{lead.category}</span>
              <span>{lead.sourceCount} evidence source{lead.sourceCount === 1 ? '' : 's'}</span>
            </div>
            <h2 class="discover__lead-title">{lead.name}</h2>
            <p class="discover__lead-summary">{lead.summary}</p>
            <div class="discover__lead-foot">
              <span class="mono">{slopeLabel(lead)}</span>
              <StageTag stage={lead.stage} />
              <span class="discover__lead-path mono">{lead.industries.join(' · ') || 'Unclassified'}</span>
              <span class="discover__lead-cta">Read the signal ↗</span>
            </div>
          </a>
        )}

        {fastest.length > 0 && (
          <section class="discover__fastest">
            <p class="mono discover__section-tag">Moving fastest right now</p>
            <div class="discover__fastest-grid">
              {fastest.map((s, i) => (
                <a key={s.id} class="discover__fast-card" href={`/app/signals/${s.id}`}>
                  <span class="discover__fast-rank mono">0{i + 1}</span>
                  <span class="mono">{slopeLabel(s)}</span>
                  <h3>{s.name}</h3>
                  <p>{s.summary}</p>
                  <StageTag stage={s.stage} />
                </a>
              ))}
            </div>
          </section>
        )}

        {restAfterFastest.length > 0 && (
          <section class="discover__index">
            <p class="mono discover__section-tag">The signal index — {restAfterFastest.length} tracked</p>
            <ol>
              {restAfterFastest.map((s) => (
                <li key={s.id}>
                  <a class="discover__row" href={`/app/signals/${s.id}`}>
                    <span class="discover__row-serial mono">{s.serial}</span>
                    <span class="discover__row-name">{s.name}</span>
                    <span class="discover__row-category mono">{s.category}</span>
                    <StageTag stage={s.stage} />
                    <span class="mono">{momentumLabel(s)}</span>
                    <span class="discover__row-sources mono">{s.sourceCount} src</span>
                    <span class="discover__row-arrow" aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
      </>)}
    </div>
  );
}
