import { randomUUID } from 'node:crypto';
import { listSignals } from '../repos';
import { momentumLabel } from '../../shared/signals';
import { INDUSTRIES, industryName } from '../../shared/catalog/industries';
import { ResearchError, type ResearchResult } from '../llm/research';
import { collectResearch } from '../research/collect';
import { evidenceResult } from '../research/evidence';
import type { ResearchSource } from '../../shared/evidence';
import type { ToolSpec } from '../llm/openrouter';
import type { ActionProposal, ExtractedSignal, ToolEvent } from '../../shared/types';

/**
 * Read-only + suggest tool registry for the conversational assistant.
 * Read tools return grounding data; suggest tools return ActionProposals
 * (they NEVER mutate — the user confirms in the UI). web_research is only
 * registered when the user enables web search for the message.
 */

export interface ToolContext {
  owner: string;
  interests: string[];
  useWeb: boolean;
  signal?: AbortSignal;
}

export interface ToolOutput {
  /** Text fed back to the model as the tool result. */
  result: string;
  /** UI-facing status summary ("Searched 12 signals · 3 relevant"). */
  summary: string;
  /** Signals referenced by this call (for reference chips). */
  signalIds: string[];
  /** Research metadata when this was a web_research call. */
  research?: ResearchResult;
  /** Action proposal(s) produced by suggest tools. */
  proposals?: ActionProposal[];
}

interface ToolDef {
  spec: ToolSpec;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

const tool = (
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: ToolDef['run'],
): ToolDef => ({ spec: { type: 'function', function: { name, description, parameters } }, run });

function signalRef(s: ExtractedSignal): string {
  return `${s.name} (id: ${s.id}, S—${s.serial}, ${s.stage}, momentum ${momentumLabel(s)}, confidence ${Math.round(s.confidence * 100)}%): ${s.summary}`;
}

async function resolveSignal(input: string, owner: string): Promise<ExtractedSignal | undefined> {
  return (await listSignals(owner)).find(s => s.id === input);
}

function scoreSignals(query: string, interests: string[], SIGNALS: ExtractedSignal[]): ExtractedSignal[] {
  const words = query.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 2);
  return [...SIGNALS]
    .map((s) => {
      let score = 0;
      const hay = `${s.name} ${s.summary} ${s.meaning} ${s.category} ${s.tags.join(' ')}`.toLowerCase();
      for (const w of words) {
        if (hay.includes(w)) score += 2;
        if (s.name.toLowerCase().includes(w)) score += 3;
      }
      if (interests.length && s.tags.some((t) => interests.includes(t))) score += 1;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score || b.s.sourceCount - a.s.sourceCount)
    .map((x) => x.s);
}

const searchSignals = tool(
  'search_signals',
  'Search the DRIFT owner-scoped saved research signals. Returns the most relevant signals with stage, momentum, and a summary. Use this to ground any answer about signals or cultural shifts.',
  {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for' },
      stage: { type: 'string', enum: ['Weak', 'Emerging', 'Accelerating', 'Mainstream'], description: 'Optional stage filter' },
      category: { type: 'string', description: 'Optional category filter' },
      only_my_interests: { type: 'boolean', description: "Restrict to signals matching the user's onboarding interests" },
      limit: { type: 'number', description: 'Max signals to return (default 4)' },
    },
    required: ['query'],
  },
  async (args, ctx) => {
    const query = String(args.query ?? '');
    const stage = typeof args.stage === 'string' ? args.stage : null;
    const category = typeof args.category === 'string' ? args.category : null;
    const limit = Math.min(8, Math.max(1, Number(args.limit) || 4));
    const interests = args.only_my_interests ? ctx.interests : [];
    const SIGNALS = await listSignals(ctx.owner);
    let results = scoreSignals(query, interests, SIGNALS);
    if (stage) results = results.filter((s) => s.stage === stage);
    if (category) results = results.filter((s) => s.category.toLowerCase() === category.toLowerCase());
    results = results.slice(0, limit);
    const result = results.length ? results.map(signalRef).join('\n') : 'No signals matched that search.';
    return {
      result,
      summary: `Searched ${SIGNALS.length} signals · ${results.length} relevant`,
      signalIds: results.map((s) => s.id),
    };
  },
);

const getSignal = tool(
  'get_signal',
  'Get the full detail of one signal by id: meaning, why it is emerging, the human need, evidence, current industries, and AI-classified associations.',
  { type: 'object', properties: { id: { type: 'string', description: 'Signal id' } }, required: ['id'] },
  async (args, ctx) => {
    const s = await resolveSignal(String(args.id ?? ''), ctx.owner);
    if (!s) return { result: `No signal with id "${args.id}".`, summary: 'Signal not found', signalIds: [] };
    const result = [
      signalRef(s),
      `Meaning: ${s.meaning}`,
      `Why emerging: ${s.why}`,
      `Human need: ${s.need}`,
      `AI-classified associations (not movement): ${s.industries.map(industryName).join(', ') || 'Unclassified'}`,
      `Evidence (${s.sourceCount} observations): ${s.evidence.map((e) => `${e.snippet} (${e.url})`).join(' | ')}`,
    ].join('\n');
    return { result, summary: `Read signal ${s.name}`, signalIds: [s.id] };
  },
);

const listIndustries = tool(
  'list_industries',
  'List the selectable industry taxonomy (for transfers and the signal map).',
  { type: 'object', properties: {} },
  async () => ({
    result: INDUSTRIES.map((i) => `${i.name} (${i.id}) — taxonomy only`).join('\n'),
    summary: `Listed ${INDUSTRIES.length} domains`,
    signalIds: [],
  }),
);

// ── Suggest tools (never mutate) ──

const suggestTransfer = tool(
  'suggest_transfer',
  'Propose a Transfer Lab experiment (signal × industry) for the user to confirm. Does NOT run it. Use when the user wants to explore moving a signal into an industry.',
  {
    type: 'object',
    properties: {
      signal_id: { type: 'string' },
      industry_id: { type: 'string' },
    },
    required: ['signal_id', 'industry_id'],
  },
  async (args, ctx) => {
    const s = await resolveSignal(String(args.signal_id ?? ''), ctx.owner);
    if (!s || !INDUSTRIES.some(i => i.id === args.industry_id)) return { result: 'Select an owner-scoped saved signal and valid industry.', summary: 'Invalid selection', signalIds: [] };
    const industryNameStr = industryName(String(args.industry_id ?? ''));
    const proposal: ActionProposal = {
      id: randomUUID(),
      kind: 'transfer',
      label: `Transfer ${s?.name ?? args.signal_id} × ${industryNameStr}`,
      params: { signalId: s?.id ?? String(args.signal_id ?? ''), industryId: String(args.industry_id ?? '') },
    };
    return {
      result: `Prepared a transfer proposal: ${proposal.label}. It will only run if the user confirms.`,
      summary: `Proposed transfer ${proposal.label}`,
      signalIds: s ? [s.id] : [],
      proposals: [proposal],
    };
  },
);

const suggestOpportunities = tool(
  'suggest_generate_opportunities',
  'Propose generating 3 opportunities from a signal and industry for the user to confirm. Does NOT generate them. Use when the user asks for startup/product/brand ideas.',
  {
    type: 'object',
    properties: {
      signal_id: { type: 'string' },
      industry_id: { type: 'string' },
    },
    required: ['signal_id', 'industry_id'],
  },
  async (args, ctx) => {
    const s = await resolveSignal(String(args.signal_id ?? ''), ctx.owner);
    if (!s || !INDUSTRIES.some(i => i.id === args.industry_id)) return { result: 'Select an owner-scoped saved signal and valid industry.', summary: 'Invalid selection', signalIds: [] };
    const ind = industryName(String(args.industry_id ?? ''));
    const proposal: ActionProposal = {
      id: randomUUID(),
      kind: 'generate_opportunities',
      label: `Generate 3 opportunities from ${s?.name ?? args.signal_id} × ${ind}`,
      params: { signalId: s?.id ?? String(args.signal_id ?? ''), industryId: String(args.industry_id ?? '') },
    };
    return {
      result: `Prepared an opportunity-generation proposal: ${proposal.label}. It will only run if the user confirms.`,
      summary: `Proposed 3 opportunities (${s?.name ?? 'signal'} × ${ind})`,
      signalIds: s ? [s.id] : [],
      proposals: [proposal],
    };
  },
);

const suggestSave = tool(
  'suggest_save',
  'Propose saving a signal to a collection for the user to confirm. Does NOT save it.',
  {
    type: 'object',
    properties: {
      signal_id: { type: 'string' },
      collection: { type: 'string', description: 'Collection name, e.g. "Future of Social", "AI + Culture", "Travel", "Consumer Behavior"' },
    },
    required: ['signal_id'],
  },
  async (args, ctx) => {
    const s = await resolveSignal(String(args.signal_id ?? ''), ctx.owner);
    if (!s) return { result: 'Signal is not in your saved research.', summary: 'Signal not found', signalIds: [] };
    const collection = String(args.collection ?? 'Inbox');
    const proposal: ActionProposal = {
      id: randomUUID(),
      kind: 'save',
      label: `Save ${s?.name ?? args.signal_id} to ${collection}`,
      params: { type: 'signal', refId: s?.id ?? String(args.signal_id ?? ''), collection },
    };
    return {
      result: `Prepared a save proposal: ${proposal.label}. It will only happen if the user confirms.`,
      summary: `Proposed saving ${s?.name ?? 'signal'}`,
      signalIds: s ? [s.id] : [],
      proposals: [proposal],
    };
  },
);

export interface BuiltTools {
  specs: ToolSpec[];
  run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

/** Human-readable channel label for each research tool. */
const RESEARCH_LABELS: Record<string, string> = {
  web_research: 'Wider web', reddit_research: 'Reddit', youtube_research: 'YouTube', trends_research: 'Google Trends',
};

/** Build the tool set for a message. web_research is only present when useWeb is true. */
export function buildTools(useWeb: boolean, deps: { collect?: typeof collectResearch } = {}): BuiltTools {
  const defs: ToolDef[] = [searchSignals, getSignal, listIndustries, suggestTransfer, suggestOpportunities, suggestSave];
  const blocked = new Set<string>();
  const cache = new Map<string, Promise<ToolOutput>>();
  let researchCalls = 0;
  const makeResearch = (name: string, source: ResearchSource, description: string) => tool(name, description,
    { type: 'object', properties: { query: { type: 'string', description: source === 'trends' ? 'One specific signal term (not a sentence or comma-separated list)' : 'The US cultural research question' } }, required: ['query'] },
    async (args, ctx) => {
      if (!ctx.useWeb) return { result: 'Research is disabled for this message.', summary: 'Web research is off', signalIds: [] };
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query || query.length > 300) return { result: 'Use a query between 1 and 300 characters.', summary: 'Invalid research query', signalIds: [] };
      const key = `${source}:${query.toLowerCase()}`;
      const previous = cache.get(key);
      if (previous) return previous;
      const service = source === 'youtube' || source === 'trends' ? 'serpapi' : 'openrouter';
      if (blocked.has(service)) return { result: 'This provider is unavailable for this message after a credentials or rate-limit error. No further searches were attempted.', summary: 'Research provider unavailable', signalIds: [] };
      if (researchCalls >= 4) return { result: 'Research call limit reached for this message. Use existing evidence.', summary: 'Research limit reached', signalIds: [] };
      researchCalls++;
      const pending = (async (): Promise<ToolOutput> => {
        let research: ResearchResult;
        try {
          research = await (deps.collect ?? collectResearch)(query, [source], { signal: ctx.signal });
        } catch (error) {
          if (!(error instanceof ResearchError)) throw error;
          if (error.kind === 'cancelled') throw error;
          if (['credentials', 'rate_limited', 'budget'].includes(error.kind)) blocked.add(service);
          research = evidenceResult(error.partialEvidence, error.reports ?? [{ provider: error.provider, reason: error.reason, attempts: error.attempts, status: 'failed', error: { kind: error.kind, message: error.message } }]);
        }
        if (research.providers.some((r) => r.error && ['credentials', 'rate_limited', 'budget'].includes(r.error.kind))) blocked.add(service);
        return {
          result: JSON.stringify({ answer: research.answer, evidence: research.evidence, providers: research.providers, insufficientEvidence: research.insufficientEvidence }),
          summary: `${RESEARCH_LABELS[name] ?? 'Web'} research · ${research.evidence.length} sources${research.providers.some((r) => r.error) ? ' · limited or unavailable' : ''}`,
          signalIds: [], research,
        };
      })();
      cache.set(key, pending);
      return pending;
    });
  if (useWeb) defs.push(
    makeResearch('web_research', 'web', 'Search current US cultural evidence from the wider web through Perplexity on OpenRouter. Excludes Reddit, YouTube and Google Trends URLs — use the dedicated tools for those. Only use when live web is enabled.'),
    makeResearch('reddit_research', 'reddit', 'Find public US-relevant Reddit threads and comments via OpenRouter web search restricted to site:reddit.com. Evidence of language and behavior, not population prevalence. Only real thread/comment permalinks are returned; scores and dates stay null when the provider does not report them.'),
    makeResearch('youtube_research', 'youtube', 'Search YouTube via SerpApi for recent US-locale videos on a topic. Returns only videos published within the last 30 days, with the provider-reported view count, channel and published label. Search results carry no transcripts or comments; never invent view counts or growth.'),
    makeResearch('trends_research', 'trends', 'Get US Google Trends interest over the past 12 months and related/rising queries via SerpApi for one signal term. Use the server-calculated slope and supplied rising percentages; never invent momentum.'),
  );
  const byName = new Map(defs.map((d) => [d.spec.function.name, d]));
  return {
    specs: defs.map((d) => d.spec),
    async run(name, args, ctx) {
      const def = byName.get(name);
      if (!def) return { result: `Unknown tool "${name}".`, summary: 'Unknown tool', signalIds: [] };
      return def.run(args, ctx);
    },
  };
}

export type { ToolEvent };
