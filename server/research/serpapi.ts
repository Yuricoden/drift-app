import type { Evidence, ProviderReport, RelatedQuery, ResearchProvider, TrendMomentum, TrendPoint } from '../../shared/evidence.js';
import { env } from '../env.js';
import { ResearchError } from './errors.js';
import { evidenceResult } from './evidence.js';
import { array, count, finite, parseRelativeDays, str, youtubeVideoUrl } from './domains.js';

type Json = Record<string, any>;
export interface SerpApiDeps {
  fetch?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function cleanQuery(query: string, provider: ResearchProvider): string {
  const q = query.trim();
  if (!q || q.length > 300) throw new ResearchError('invalid', 'Use a research query between 1 and 300 characters.', provider);
  return q;
}

async function request(params: Record<string, string>, provider: ResearchProvider, deps: SerpApiDeps): Promise<{ data: Json; attempts: number; reason: string | null }> {
  const key = deps.apiKey ?? env.serpapiKey;
  if (!key) throw new ResearchError('credentials', 'SERPAPI_API_KEY is not configured on the server.', provider, 'missing-key', 0);
  const url = new URL('https://serpapi.com/search.json');
  Object.entries({ ...params, api_key: key }).forEach(([name, value]) => url.searchParams.set(name, value));
  let retryReason: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (deps.signal?.aborted) throw new ResearchError('cancelled', 'Research cancelled.', provider, 'cancelled', attempt - 1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 20000);
    const abort = () => controller.abort();
    deps.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await (deps.fetch ?? fetch)(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) {
        const kind = [401, 403].includes(response.status) ? 'credentials' : response.status === 429 ? 'rate_limited'
          : response.status >= 500 ? 'transient' : 'invalid';
        throw new ResearchError(kind, `SerpApi ${response.status}: ${kind === 'credentials' ? 'check server credentials' : kind === 'rate_limited' ? 'rate limit reached; try again later' : 'research request failed'}.`, provider, `http-${response.status}`, attempt);
      }
      let data: Json;
      try { data = await response.json(); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        throw new ResearchError('unavailable', 'SerpApi returned an unreadable response.', provider, 'invalid-response', attempt);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ResearchError('unavailable', 'SerpApi returned an invalid response.', provider, 'invalid-response', attempt);
      if (data.error || data.search_metadata?.status === 'Error') {
        // Inspect the provider message only for classification; never return it
        // (it can contain a request URL with api_key).
        const detail = str(data.error).toLowerCase();
        const kind = /api.?key|unauthoriz|forbidden/.test(detail) ? 'credentials'
          : /rate.limit|too many|run out of searches|quota/.test(detail) ? 'rate_limited'
          : /temporar|timeout|internal server/.test(detail) ? 'transient' : 'unavailable';
        throw new ResearchError(kind, `SerpApi research is unavailable (${kind}).`, provider, 'provider-error', attempt);
      }
      return { data, attempts: attempt, reason: retryReason };
    } catch (cause) {
      const error = deps.signal?.aborted ? new ResearchError('cancelled', 'Research cancelled.', provider, 'cancelled', attempt)
        : controller.signal.aborted ? new ResearchError('timeout', 'SerpApi research timed out.', provider, 'timeout', attempt)
        : cause instanceof ResearchError ? cause : new ResearchError('transient', 'Could not reach SerpApi.', provider, 'network-error', attempt);
      if (attempt === 2 || !['timeout', 'transient'].includes(error.kind)) throw error;
      retryReason = `retry-after-${error.reason}`;
    } finally {
      clearTimeout(timer);
      deps.signal?.removeEventListener('abort', abort);
    }
  }
  throw new ResearchError('unavailable', 'SerpApi research failed.', provider);
}

export interface YoutubeDeps extends SerpApiDeps {
  /** Retain only videos published within this many days. Default 30. */
  maxAgeDays?: number;
  /** Maximum videos to retain. Default 10. */
  limit?: number;
  /** YouTube `sp` upload-date filter token. Default "This month". */
  uploadFilter?: string;
}

/**
 * YouTube's own "Upload date: This month" filter token, passed through as `sp`.
 *
 * SerpApi documents `sp` for upload-date filtering, but its documented `CAI=`
 * example does not actually filter (verified against live results, which still
 * returned videos from three years ago). This is the token YouTube itself puts
 * in its URL for "This month", which the SerpApi docs explicitly sanction
 * copying. `published_date` is still verified per result, so a changed or
 * ignored filter can never make old videos look recent.
 */
export const YOUTUBE_THIS_MONTH = 'EgIIBA==';

/**
 * YouTube search via SerpApi (`engine=youtube`).
 *
 * Only organic `video_results` are used — `ads_results` and `movie_results` are
 * bought or catalog listings, not cultural evidence. Recency is enforced twice:
 * by the provider's upload-date filter and by parsing each result's own
 * `published_date` label. A video whose age cannot be parsed is dropped and
 * counted, never assumed recent. Search locale (`gl=us`) is recorded as a locale
 * only; it is not evidence that a video is about the US. Search results carry no
 * transcript or comments, so none are implied.
 */
export async function researchYoutube(query: string, deps: YoutubeDeps = {}) {
  const provider = 'serpapi-youtube' as const;
  const q = cleanQuery(query, provider);
  const maxAgeDays = deps.maxAgeDays ?? 30;
  const limit = deps.limit ?? 10;
  const response = await request({
    engine: 'youtube', search_query: q, gl: 'us', hl: 'en',
    sp: deps.uploadFilter ?? YOUTUBE_THIS_MONTH,
  }, provider, deps);
  const evidence: Evidence[] = [];
  let noDate = 0;
  let tooOld = 0;
  for (const video of array(response.data.video_results)) {
    if (evidence.length >= limit) break;
    const url = youtubeVideoUrl(video.link);
    if (!url) continue;
    const publishedLabel = str(video.published_date, 80) || null;
    const daysAgo = parseRelativeDays(publishedLabel);
    if (daysAgo === null) { noDate++; continue; }
    if (daysAgo > maxAgeDays) { tooOld++; continue; }
    const channel = video.channel && typeof video.channel === 'object' ? video.channel as Json : {};
    evidence.push({
      source: 'youtube', provider, reason: response.reason,
      title: str(video.title, 300) || url.toString(),
      url: url.toString(),
      snippet: str(video.description, 900),
      date: publishedLabel,
      metrics: {
        youtube: {
          videoId: url.searchParams.get('v'),
          channel: str(channel.name, 200) || null,
          channelUrl: str(channel.link, 500) || null,
          channelVerified: channel.verified === true,
          views: count(video.views),
          publishedLabel,
          publishedDaysAgo: Math.round(daysAgo * 100) / 100,
          duration: str(video.length, 20) || null,
          searchLocale: 'US',
        },
      },
    });
  }
  const dropped = [noDate ? `${noDate} without a published date` : null, tooOld ? `${tooOld} older than ${maxAgeDays} days` : null]
    .filter((part): part is string => !!part).join(', ');
  const report: ProviderReport = {
    provider,
    reason: response.reason ?? (evidence.length ? (dropped ? `recent-window-only: excluded ${dropped}` : null)
      : dropped ? `no-recent-videos: excluded ${dropped}` : 'no-results'),
    attempts: response.attempts,
    status: evidence.length ? 'complete' : 'empty',
  };
  return evidenceResult(evidence, [report]);
}

export function calculateSlope(points: TrendPoint[]): number | null {
  if (points.length < 12 || points.at(-1)!.timestamp - points[0].timestamp < 270 * 86400) return null;
  const xs = points.map((p) => (p.timestamp - points[0].timestamp) / (86400 * 365.25 / 12));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / points.length;
  const denominator = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  return denominator ? Math.round(xs.reduce((sum, x, i) => sum + (x - meanX) * (points[i].value - meanY), 0) / denominator * 10000) / 10000 : null;
}

function timeline(data: Json, term: string): TrendPoint[] {
  const points = new Map<number, TrendPoint>();
  for (const point of array(data.interest_over_time?.timeline_data)) {
    const value = array(point.values).find((v) => v.query?.toLowerCase() === term.toLowerCase() || v.query_index === 0 || !v.query);
    if (!value || point.is_partial || value.is_partial) continue;
    const timestamp = Number(value.timestamp ?? point.timestamp);
    const score = finite(value.extracted_value) ?? (/^\d+$/.test(str(value.value)) ? Number(value.value) : null);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp * 1000).getTime()) || score === null || score < 0 || score > 100) continue;
    points.set(timestamp, { date: new Date(timestamp * 1000).toISOString(), timestamp, value: score });
  }
  return [...points.values()].sort((a, b) => a.timestamp - b.timestamp);
}
function trendsUrl(term: string): string {
  const url = new URL('https://trends.google.com/trends/explore');
  url.search = new URLSearchParams({ q: term, geo: 'US', date: 'today 12-m' }).toString();
  return url.toString();
}
function related(data: Json): RelatedQuery[] {
  return (['rising', 'top'] as const).flatMap((kind) => array(data.related_queries?.[kind]).slice(0, 20).flatMap((item) => {
    const query = str(item.query, 300);
    if (!query) return [];
    const label = str(item.value, 80) || null;
    const breakout = /breakout/i.test(label ?? '');
    const percent = label?.match(/^\+?([\d,]+(?:\.\d+)?)%$/);
    const numeric = finite(item.extracted_value) ?? (percent ? Number(percent[1].replaceAll(',', '')) : null);
    return [{ query, url: trendsUrl(query), kind, label, breakout,
      risingPercent: kind === 'rising' ? numeric : null,
      interest: kind === 'top' && numeric !== null && numeric >= 0 && numeric <= 100 ? numeric : null }];
  }));
}

export async function researchTrends(query: string, deps: SerpApiDeps = {}) {
  const provider = 'serpapi-trends' as const;
  const q = cleanQuery(query, provider);
  if (q.includes(',')) throw new ResearchError('invalid', 'Research one signal term at a time for Google Trends.', provider);
  const parameters = { engine: 'google_trends', q, geo: 'US', date: 'today 12-m', hl: 'en' };
  const timeseries = await request({ ...parameters, data_type: 'TIMESERIES' }, provider, deps);
  const points = timeline(timeseries.data, q);
  const metrics: TrendMomentum = { term: q, geo: 'US', range: 'today 12-m', timeline: points, slope12Month: calculateSlope(points), slopeUnit: 'index-points-per-month', relatedQueries: [] };
  const evidence: Evidence = { source: 'trends', provider, reason: timeseries.reason, title: `${q} — US search interest, past 12 months`, url: trendsUrl(q),
    snippet: 'Google Trends search interest is a relative 0–100 index, not search volume or market size.', metrics: { trends: metrics }, date: points.at(-1)?.date ?? null };
  let queries;
  try { queries = await request({ ...parameters, data_type: 'RELATED_QUERIES' }, provider, deps); }
  catch (error) {
    if (error instanceof ResearchError) { error.attempts += timeseries.attempts; error.partialEvidence = points.length ? [evidence] : []; }
    throw error;
  }
  metrics.relatedQueries = related(queries.data);
  evidence.reason = queries.reason ?? timeseries.reason;
  const found = points.length > 0 || metrics.relatedQueries.length > 0;
  const report: ProviderReport = { provider, reason: evidence.reason ?? (found ? null : 'insufficient-search-volume'), attempts: timeseries.attempts + queries.attempts, status: found ? 'complete' : 'empty' };
  return evidenceResult(found ? [evidence] : [], [report]);
}
