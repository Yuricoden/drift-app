import { env } from '../env';

/**
 * The single OpenRouter API gateway. All research and AI features go through
 * here. Model IDs come from env (configurable server-side). The gateway is
 * dependency-injectable so tests can substitute a fake without network calls.
 */

export type LlmErrorKind =
  | 'credentials' // 401/403 — invalid key; never retry, never fall back
  | 'budget' // 402 — insufficient credits; never retry, never fall back
  | 'cancelled' // aborted by caller; never retry, never fall back
  | 'rate_limited' // 429 — transient, but do NOT burn a research fallback
  | 'unsupported' // 400/404/422 — model/route/params unsupported; may fall back
  | 'timeout' // request timed out; may fall back
  | 'transient' // 5xx / network; may retry once, may fall back
  | 'empty'; // unusable/empty payload; may fall back

export class LlmError extends Error {
  kind: LlmErrorKind;
  status: number;
  constructor(kind: LlmErrorKind, message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface Citation {
  url: string;
  title: string;
  content: string;
  startIndex?: number;
  endIndex?: number;
}

export interface ChatMessageIn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  model: string;
  system?: string;
  user?: string;
  /** Full message history; when provided it takes precedence over system/user. */
  messages?: ChatMessageIn[];
  /** Tool definitions; when present the model may respond with tool_calls. */
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /**
   * OpenRouter plugins, e.g. [{ id: 'web', engine: 'perplexity',
   * include_domains: ['reddit.com'] }]. Domain filters are a retrieval hint
   * only — callers still validate every returned URL themselves.
   */
  plugins?: Array<Record<string, unknown>>;
  webSearchOptions?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  retry?: boolean;
}

/** A tool call requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ChatResult {
  content: string;
  citations: Citation[];
  provider: string | null;
  model: string;
  generationId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
  /** Tool calls requested by the model (when tools were provided). */
  toolCalls: ToolCall[];
}

const BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 45000;

function classifyStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return 'credentials';
  if (status === 402) return 'budget';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 404 || status === 422) return 'unsupported';
  if (status >= 500) return 'transient';
  return 'transient';
}

interface RawAnnotation {
  type?: string;
  url_citation?: { url?: string; title?: string; content?: string; start_index?: number; end_index?: number };
}

export function parseCitations(message: Record<string, unknown> | undefined, data?: Record<string, unknown>): Citation[] {
  const annotations = (message?.annotations ?? []) as RawAnnotation[];
  const out: Citation[] = [];
  for (const a of Array.isArray(annotations) ? annotations : []) {
    if (a?.type === 'url_citation' && a.url_citation?.url) {
      out.push({
        url: a.url_citation.url,
        title: a.url_citation.title ?? a.url_citation.url,
        content: a.url_citation.content ?? '',
        startIndex: a.url_citation.start_index,
        endIndex: a.url_citation.end_index,
      });
    }
  }
  // Some Perplexity routes also return top-level citations/search_results.
  const results = Array.isArray(data?.search_results) ? data.search_results as Record<string, unknown>[] : [];
  const urls = Array.isArray(data?.citations) ? data.citations : [];
  for (const url of urls) {
    if (typeof url !== 'string') continue;
    const match = results.find((r) => r.url === url);
    out.push({ url, title: typeof match?.title === 'string' ? match.title : url, content: typeof match?.snippet === 'string' ? match.snippet : '' });
  }
  const safe = new Map<string, Citation>();
  for (const citation of out) {
    try {
      const url = new URL(citation.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      const existing = safe.get(citation.url);
      safe.set(citation.url, existing ? { ...existing, content: existing.content || citation.content } : citation);
    } catch { /* malformed source URL */ }
  }
  return [...safe.values()];
}

function buildMessages(opts: ChatOptions): Array<Record<string, unknown>> {
  if (opts.messages && opts.messages.length) return opts.messages as unknown as Array<Record<string, unknown>>;
  const messages: Array<Record<string, unknown>> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  if (opts.user !== undefined) messages.push({ role: 'user', content: opts.user });
  return messages;
}

function parseToolCalls(message: Record<string, unknown> | undefined): ToolCall[] {
  const raw = message?.tool_calls as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const fn = t.function as { name?: string; arguments?: unknown } | undefined;
      return {
        id: String(t.id ?? ''),
        name: String(fn?.name ?? ''),
        argumentsJson: typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {}),
      };
    })
    .filter((t) => t.name);
}

async function rawChat(opts: ChatOptions): Promise<ChatResult> {
  if (!env.openrouterKey) {
    throw new LlmError('credentials', 'OPENROUTER_API_KEY is not configured.', 401);
  }

  const body: Record<string, unknown> = { model: opts.model, messages: buildMessages(opts), usage: { include: true } };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.responseFormat) body.response_format = opts.responseFormat;
  if (opts.provider) body.provider = opts.provider;
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  }
  if (opts.plugins && opts.plugins.length) body.plugins = opts.plugins;
  if (opts.webSearchOptions) body.web_search_options = opts.webSearchOptions;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onExternalAbort);
  const cancelledExternally = () => opts.signal?.aborted === true;
  let res: Response;
  let data: Record<string, unknown>;
  try {
    if (opts.signal?.aborted) throw new LlmError('cancelled', 'Request cancelled by the caller.');
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.openrouterKey}`,
        'http-referer': 'https://drift.local',
        'x-title': 'DRIFT',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new LlmError(classifyStatus(res.status), `OpenRouter ${res.status}: ${detail.slice(0, 300)}`, res.status);
    }
    data = await res.json() as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (cancelledExternally()) throw new LlmError('cancelled', 'Request cancelled by the caller.');
    if ((error as Error).name === 'AbortError') {
      throw new LlmError('timeout', `OpenRouter request timed out after ${timeoutMs}ms.`);
    }
    throw new LlmError('transient', `OpenRouter network error: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }

  const choice = (data.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = (message?.content as string | undefined)?.trim() ?? '';
  const citations = parseCitations(message, data);
  const toolCalls = parseToolCalls(message);
  if (!content && citations.length === 0 && toolCalls.length === 0) {
    throw new LlmError('empty', 'OpenRouter returned an unusable (empty) response.');
  }

  const usage = data.usage as Record<string, unknown> | undefined;
  const costDetails = usage?.cost_details as Record<string, unknown> | undefined;
  const cost =
    (typeof usage?.cost === 'number' ? usage.cost : null) ??
    (typeof costDetails?.total === 'number' ? (costDetails.total as number) : null) ??
    (typeof costDetails?.upstream_inference_cost === 'number' ? (costDetails.upstream_inference_cost as number) : null);

  return {
    content,
    citations,
    provider: (data.provider as string | undefined) ?? null,
    model: (data.model as string | undefined) ?? opts.model,
    generationId: (data.id as string | undefined) ?? null,
    promptTokens: typeof usage?.prompt_tokens === 'number' ? (usage.prompt_tokens as number) : null,
    completionTokens: typeof usage?.completion_tokens === 'number' ? (usage.completion_tokens as number) : null,
    cost,
    toolCalls,
  };
}

export interface Gateway {
  chat(opts: ChatOptions): Promise<ChatResult>;
  /** Stream a chat completion as SSE; calls onToken for each text delta. Returns the final result. */
  chatStream(opts: ChatOptions, onToken: (delta: string) => void): Promise<ChatResult>;
}

async function chatWithRetry(opts: ChatOptions): Promise<ChatResult> {
  try {
    return await rawChat(opts);
  } catch (error) {
    if (opts.retry !== false && error instanceof LlmError && error.kind === 'transient') {
      // Exactly one retry on transient failure; no retry on anything else.
      return rawChat(opts);
    }
    throw error;
  }
}

/**
 * Streams a chat completion from OpenRouter (SSE). Emits text deltas via
 * onToken and returns the assembled result (including citations/usage) once the
 * stream completes. Throws typed LlmError on failure; 'cancelled' when aborted.
 */
async function chatStream(opts: ChatOptions, onToken: (delta: string) => void): Promise<ChatResult> {
  if (!env.openrouterKey) {
    throw new LlmError('credentials', 'OPENROUTER_API_KEY is not configured.', 401);
  }
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: buildMessages(opts),
    usage: { include: true },
    stream: true,
    stream_options: { include_usage: true },
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onExternalAbort);

  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.openrouterKey}`,
        'http-referer': 'https://drift.local',
        'x-title': 'DRIFT',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onExternalAbort);
    if (opts.signal?.aborted) throw new LlmError('cancelled', 'Request cancelled by the caller.');
    if ((error as Error).name === 'AbortError') throw new LlmError('timeout', `OpenRouter stream timed out after ${timeoutMs}ms.`);
    throw new LlmError('transient', `OpenRouter network error: ${(error as Error).message}`);
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onExternalAbort);
    const text = await res.text().catch(() => '');
    throw new LlmError(classifyStatus(res.status), `OpenRouter ${res.status}: ${text.slice(0, 300)}`, res.status);
  }

  let content = '';
  let citations: Citation[] = [];
  let provider: string | null = null;
  let model = opts.model;
  let generationId: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let cost: number | null = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (chunk.provider && !provider) provider = String(chunk.provider);
        if (chunk.id && !generationId) generationId = String(chunk.id);
        if (chunk.model) model = String(chunk.model);
        const choice = (chunk.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta ?? choice?.message) as Record<string, unknown> | undefined;
        const piece = (delta?.content as string | undefined) ?? '';
        if (piece) {
          content += piece;
          onToken(piece);
        }
        const anns = parseCitations(delta);
        if (anns.length) citations = citations.concat(anns);
        const usage = chunk.usage as Record<string, unknown> | undefined;
        if (usage) {
          if (typeof usage.prompt_tokens === 'number') promptTokens = usage.prompt_tokens;
          if (typeof usage.completion_tokens === 'number') completionTokens = usage.completion_tokens;
          if (typeof usage.cost === 'number') cost = usage.cost;
        }
      }
    }
  } catch (error) {
    if (opts.signal?.aborted) throw new LlmError('cancelled', 'Request cancelled by the caller.');
    throw error instanceof LlmError ? error : new LlmError('transient', (error as Error).message);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onExternalAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  if (!content && citations.length === 0) {
    throw new LlmError('empty', 'OpenRouter stream produced no content.');
  }
  return { content, citations, provider, model, generationId, promptTokens, completionTokens, cost, toolCalls: [] };
}

export function createGateway(): Gateway {
  return { chat: chatWithRetry, chatStream };
}

/** The production gateway. Tests substitute their own via dependency injection. */
export const gateway = createGateway();
