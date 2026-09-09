export type ResearchSource = 'web' | 'reddit' | 'trends' | 'youtube';
/**
 * `serpapi-reddit` is retained only so research saved by earlier builds still
 * type-checks; live Reddit evidence now comes from `openrouter-reddit`.
 */
export type ResearchProvider =
  | 'perplexity-sonar'
  | 'openrouter-web'
  | 'openrouter-reddit'
  | 'serpapi-trends'
  | 'serpapi-youtube'
  | 'serpapi-reddit';
export type ResearchErrorKind = 'credentials' | 'rate_limited' | 'timeout' | 'transient' | 'budget' | 'cancelled' | 'invalid' | 'unavailable';

export interface TrendPoint { date: string; timestamp: number; value: number }
export interface RelatedQuery {
  query: string;
  url: string;
  kind: 'rising' | 'top';
  label: string | null;
  risingPercent: number | null;
  breakout: boolean;
  interest: number | null;
}
export interface TrendMomentum {
  term: string;
  geo: 'US';
  range: 'today 12-m';
  timeline: TrendPoint[];
  /** OLS slope in Google Trends index points per month, over the 12-month window. */
  slope12Month: number | null;
  slopeUnit: 'index-points-per-month';
  relatedQueries: RelatedQuery[];
}
export interface EvidenceMetrics {
  subreddit?: string;
  score?: number | null;
  commentCount?: number | null;
  commentCountIsLowerBound?: boolean;
  scoreIsLowerBound?: boolean;
  kind?: 'post' | 'comment';
  usBasis?: string;
  trends?: TrendMomentum;
  /** YouTube search result fields; anything not reported stays null. */
  youtube?: {
    videoId: string | null;
    channel: string | null;
    channelUrl: string | null;
    channelVerified: boolean;
    /** Provider-reported view count; null when absent or unparsable ("No views", "1.2M views"). */
    views: number | null;
    /** Provider string as displayed, e.g. "18 hours ago". Never recomputed. */
    publishedLabel: string | null;
    /** Server-parsed age in days when `publishedLabel` is a relative duration. */
    publishedDaysAgo: number | null;
    duration: string | null;
    /** Search locale used; a locale is not evidence the video is about the US. */
    searchLocale: 'US';
  };
}

/** Common, provider-derived evidence. Missing source fields stay null. */
export interface Evidence {
  source: ResearchSource;
  title: string;
  url: string;
  snippet: string;
  metrics: EvidenceMetrics;
  date: string | null;
  provider: ResearchProvider;
  reason: string | null;
}
export interface ProviderReport {
  provider: ResearchProvider;
  reason: string | null;
  attempts: number;
  status: 'complete' | 'empty' | 'partial' | 'failed';
  error?: { kind: ResearchErrorKind; message: string };
}
export interface ResearchMetadata {
  provider: ResearchProvider | 'mixed' | 'openrouter-native';
  fallbackReason: string | null;
  citations: { url: string; title: string }[];
  insufficientEvidence: boolean;
  /** Optional only for historical conversations saved before normalized evidence. */
  evidence?: Evidence[];
  providers?: ProviderReport[];
  reason?: string | null;
}
