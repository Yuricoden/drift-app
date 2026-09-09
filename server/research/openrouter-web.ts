import type { Evidence } from '../../shared/evidence';
import { runResearch, type ResearchDeps, type ResearchResult } from '../llm/research';
import { parseRelativeDays, redditUrl, usBasis, youtubeVideoUrl } from './domains';

/**
 * Web-grounded research sources that run through OpenRouter's web plugin on
 * Perplexity Sonar.
 *
 * - `researchWeb` gathers evidence from the wider web only: Reddit, YouTube and
 *   Google Trends are excluded so they can never be double-counted as web
 *   coverage by another channel.
 * - `researchReddit` restricts search to `site:reddit.com` *and* `include_domains`.
 *   Both are retrieval hints; the hard guarantee is `redditUrl()`, which rejects
 *   any citation that is not a real r/<sub>/comments/<id> permalink.
 */

const PERPLEXITY_SEARCH = { id: 'web', engine: 'perplexity' } as const;

/** Domains owned by the other three research channels. */
const NON_WEB_DOMAINS = [
  'reddit.com', 'www.reddit.com', 'old.reddit.com', 'redd.it',
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'trends.google.com',
];

const REDDIT_INSTRUCTIONS = [
  'Search reddit.com for public US-relevant discussions showing unmet needs, behaviour changes or repeated frustrations.',
  'Cite only reddit.com thread or comment permalinks you actually retrieved. Never cite a subreddit front page, a search URL or a marketing blog.',
  'Summarise the discussion; do not quote individual users. Do not invent scores, comment counts or dates.',
];

function isTrendsUrl(value: string): boolean {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, '') === 'trends.google.com'; }
  catch { return false; }
}

/** Rebuild a research result around post-processed evidence. */
function withEvidence(result: ResearchResult, evidence: Evidence[], emptyReason: string): ResearchResult {
  return {
    ...result,
    evidence,
    citations: result.citations.filter((c) => evidence.some((e) => e.url === c.url)),
    insufficientEvidence: evidence.length === 0,
    providers: result.providers.map((p) => ({
      ...p,
      status: evidence.length ? p.status : 'empty',
      reason: p.reason ?? (evidence.length ? null : emptyReason),
    })),
  };
}

/** Wider web evidence only — never Reddit, YouTube or Trends URLs. */
export async function researchWeb(query: string, deps: ResearchDeps = {}): Promise<ResearchResult> {
  return runResearch(query, {
    ...deps,
    source: 'web',
    provider: 'openrouter-web',
    plugins: [{ ...PERPLEXITY_SEARCH, exclude_domains: NON_WEB_DOMAINS }],
    acceptUrl: (url) => !redditUrl(url) && !youtubeVideoUrl(url) && !isTrendsUrl(url),
    emptyReason: 'no-web-evidence',
  });
}

function enrichReddit(evidence: Evidence): Evidence {
  const url = redditUrl(evidence.url);
  if (!url) return evidence;
  const parts = url.pathname.split('/').filter(Boolean); // r, <sub>, comments, <id>, <slug>, [<commentId>]
  const subreddit = parts[1] ?? '';
  const kind = parts.length >= 6 ? 'comment' as const : 'post' as const;
  const daysAgo = parseRelativeDays(evidence.date);
  return {
    ...evidence,
    date: daysAgo === null ? evidence.date : null,
    metrics: {
      ...evidence.metrics,
      subreddit,
      kind,
      usBasis: usBasis(evidence.title, evidence.snippet, subreddit) ?? undefined,
      // Perplexity citations do not carry reliable vote/comment counts.
      score: null,
      commentCount: null,
    },
  };
}

/**
 * Reddit evidence via OpenRouter web search, restricted to reddit.com.
 * Engagement metrics stay null unless the provider actually reports them.
 */
export async function researchReddit(query: string, deps: ResearchDeps = {}): Promise<ResearchResult> {
  const restricted = `site:reddit.com ${query.trim()} ("United States" OR USA OR American)`;
  const result = await runResearch(restricted, {
    ...deps,
    source: 'reddit',
    provider: 'openrouter-reddit',
    instructions: deps.instructions ?? REDDIT_INSTRUCTIONS.join(' '),
    plugins: [{ ...PERPLEXITY_SEARCH, include_domains: ['reddit.com'] }],
    acceptUrl: (url) => redditUrl(url) !== null,
  });
  // A US-only product must not present undated, non-US threads as US evidence.
  const evidence = result.evidence.map(enrichReddit).filter((e) => !!e.metrics.usBasis);
  return withEvidence(result, evidence, 'no-us-evidence');
}
