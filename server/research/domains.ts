/**
 * Source-domain validation shared by every research provider.
 *
 * Domain filtering is enforced here in code, not by prompt instructions: a
 * citation is only accepted for a channel when its URL really belongs to that
 * channel. Provider-reported search locale is never treated as evidence about
 * where an author or viewer is located.
 */

export const US_COMMUNITIES = new Set([
  'askanamerican', 'uscensus', 'uspolitics', 'nyc', 'newyorkcity', 'losangeles',
  'sanfrancisco', 'seattle', 'boston', 'chicago', 'austin', 'washingtondc',
]);

export const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
export const str = (v: unknown, limit = 1500): string => typeof v === 'string' ? v.slice(0, limit).trim() : '';
export const array = (v: unknown): Record<string, any>[] => Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];

/** Accept only real Reddit discussion/comment permalinks. Rejects lookalike hosts. */
export function redditUrl(value: unknown): URL | null {
  try {
    const url = new URL(str(value, 2000));
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)reddit\.com$/.test(url.hostname) || !/^\/r\/[^/]+\/comments\//.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return url;
  } catch { return null; }
}

/** Accept only canonical YouTube watch URLs; drops shorts, playlists and ads. */
export function youtubeVideoUrl(value: unknown): URL | null {
  try {
    const url = new URL(str(value, 2000));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return null;
    const id = url.searchParams.get('v');
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const clean = new URL('https://www.youtube.com/watch');
    clean.searchParams.set('v', id);
    return clean;
  } catch { return null; }
}

export function usBasis(title: string, snippet: string, subreddit: string): string | null {
  if (US_COMMUNITIES.has(subreddit.toLowerCase())) return `US-focused community r/${subreddit}; author location is unverified.`;
  const context = `${title} ${snippet}`;
  if (/\b(united states|usa|american[s]?)\b|\bU\.S\.(?:A\.)?/i.test(context) || /\bUS\b/.test(context)) return 'Explicit US context in the indexed discussion; author location is unverified.';
  return null;
}

/** Whole counts, including "70+" style strings. Anything else stays null. */
export function count(value: unknown): number | null {
  if (finite(value) !== null) return value as number;
  const match = str(value).match(/^(-?[\d,]+)(?:\+)?$/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

/** Parse a provider's relative-age label ("18 hours ago", "2 weeks ago") into days. */
export function parseRelativeDays(label: unknown): number | null {
  const text = str(label).toLowerCase();
  const match = text.match(/^(\d[\d,]*)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (!match) return null;
  const n = Number(match[1].replaceAll(',', ''));
  if (!Number.isFinite(n)) return null;
  const unit = match[2];
  if (unit === 'second' || unit === 'minute' || unit === 'hour') return n / 24;
  if (unit === 'day') return n;
  if (unit === 'week') return n * 7;
  if (unit === 'month') return n * 30.44;
  return n * 365.25;
}
