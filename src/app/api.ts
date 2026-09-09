import type {
  ActionProposal, AskResult, ChatMessage, Conversation, ConversationMeta, Opportunity, Profile, SavedItem, SessionInfo, Signal, Transfer, TrendFeed, WorkspaceSections,
} from '../../shared/types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Request failed.');
  return data as T;
}

export interface HydratedSaved {
  item: SavedItem;
  signal: import('../../shared/types').ExtractedSignal | null;
  transfer: Transfer | null;
  opportunity: Opportunity | null;
}

export const api = {
  trends: () => request<TrendFeed>('/api/trends'),
  pullTrends: (mode: 'initial' | 'refresh') => request<TrendFeed>('/api/trends/pull', { method: 'POST', body: JSON.stringify({ mode }) }),
  session: () => request<SessionInfo>('/api/auth/session'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  profile: () => request<Profile>('/api/profile'),
  saveOnboarding: (prefs: { exploring: string[]; purposes: string[]; interests: string[] }) =>
    request<Profile>('/api/profile/onboarding', { method: 'PUT', body: JSON.stringify(prefs) }),
  createTransfer: (signalId: string, industryId: string) =>
    request<Transfer>('/api/transfers', { method: 'POST', body: JSON.stringify({ signalId, industryId }) }),
  transfers: (legacy = false) => request<Transfer[]>(`/api/transfers${legacy ? '?legacy=true' : ''}`),
  transfer: (id: string) => request<Transfer>(`/api/transfers/${encodeURIComponent(id)}`),
  transferOpportunities: (transferId: string) =>
    request<Opportunity[]>(`/api/transfers/${transferId}/opportunities`, { method: 'POST' }),
  generateOpportunities: (signalId: string, industryId: string) =>
    request<Opportunity[]>('/api/opportunities', { method: 'POST', body: JSON.stringify({ signalId, industryId }) }),
  opportunities: (legacy = false) => request<Opportunity[]>(`/api/opportunities${legacy ? '?legacy=true' : ''}`),
  opportunity: (id: string) => request<Opportunity>(`/api/opportunities/${id}`),
  regenerateOpportunity: (id: string) => request<Opportunity>(`/api/opportunities/${id}/regenerate`, { method: 'POST' }),
  refineSection: (id: string, section: keyof WorkspaceSections) =>
    request<{ section: keyof WorkspaceSections; text: string; opportunity: Opportunity }>(`/api/opportunities/${id}/refine`, { method: 'POST', body: JSON.stringify({ section }) }),
  saved: () => request<HydratedSaved[]>('/api/saved'),
  save: (type: 'signal' | 'transfer' | 'opportunity', refId: string, collection: string) =>
    request<SavedItem>('/api/saved', { method: 'POST', body: JSON.stringify({ type, refId, collection }) }),
  unsave: (id: string) => request<void>(`/api/saved/${id}`, { method: 'DELETE' }),
  moveSaved: (id: string, collection: string) =>
    request<SavedItem>(`/api/saved/${id}`, { method: 'PATCH', body: JSON.stringify({ collection }) }),
  signals: () => request<import('../../shared/types').ExtractedSignal[]>('/api/signals'),
  signal: (id: string) => request<import('../../shared/types').ExtractedSignal>(`/api/signals/${id}`),
  extractionStatus: () => request<import('../../shared/types').ExtractionStatus>('/api/signals/status'),
  extractSignals: () => request<{ count: number; status: import('../../shared/types').ExtractionStatus }>('/api/signals/extract', { method: 'POST' }),
  ask: (question: string, useWeb?: boolean) =>
    request<AskResult>('/api/ask', { method: 'POST', body: JSON.stringify({ question, useWeb: useWeb === true }) }),
  research: (query: string, extract?: boolean, sources: import('../../shared/types').ResearchSource[] = ['web']) =>
    request<{
      answer: string;
      provider: import('../../shared/types').ResearchProvider | 'mixed';
      fallbackReason: string | null;
      insufficientEvidence: boolean;
      citations: { url: string; title: string; content: string }[];
      evidence: import('../../shared/types').Evidence[];
      providers: import('../../shared/types').ProviderReport[];
      reason: string | null;
      extractedSignals: import('../../shared/types').ExtractedSignal[] | null;
    }>('/api/research', { method: 'POST', body: JSON.stringify({ query, extract: extract === true, sources }) }),

  // ── Conversations (Ask DRIFT chat) ──
  listConversations: () => request<ConversationMeta[]>('/api/chat'),
  createConversation: () => request<Conversation>('/api/chat', { method: 'POST', body: '{}' }),
  getConversation: (id: string) => request<Conversation>(`/api/chat/${id}`),
  deleteConversation: (id: string) => request<void>(`/api/chat/${id}`, { method: 'DELETE' }),
  executeProposal: (conversationId: string, proposalId: string) =>
    request<{ note: string; links: { label: string; href: string }[] }>(
      `/api/chat/${conversationId}/proposals/${proposalId}/execute`,
      { method: 'POST', body: '{}' },
    ),
};

export interface StreamHandlers {
  onToken: (delta: string) => void;
  onTool: (name: string, summary: string) => void;
  onDone: (message: ChatMessage, proposals: ActionProposal[]) => void;
  onError: (kind: string, message: string) => void;
}

/** Stream a chat message via SSE over fetch. Returns an AbortController to stop it. */
export function streamChatMessage(
  conversationId: string,
  text: string,
  useWeb: boolean,
  handlers: StreamHandlers,
): AbortController {
  const controller = new AbortController();
  void (async () => {
    let res: Response;
    try {
      res = await fetch(`/api/chat/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, useWeb }),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') handlers.onError('network', 'Could not reach the DRIFT server.');
      return;
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      handlers.onError('http', (data as { error?: string }).error ?? `Request failed (${res.status}).`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (ev.type === 'token') handlers.onToken(String(ev.delta ?? ''));
          else if (ev.type === 'tool') handlers.onTool(String(ev.name ?? ''), String(ev.summary ?? ''));
          else if (ev.type === 'done') handlers.onDone(ev.message as ChatMessage, (ev.proposals as ActionProposal[]) ?? []);
          else if (ev.type === 'error') handlers.onError(String(ev.kind ?? 'error'), String(ev.message ?? 'Something went wrong.'));
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') handlers.onError('network', 'The connection was interrupted.');
    }
  })();
  return controller;
}

export const COLLECTIONS = ['Inbox', 'Future of Social', 'AI + Culture', 'Travel', 'Consumer Behavior'];
