import { extraction } from './signals/extraction.js';
import { generation, GenerationError } from './intelligence/generation.js';
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  attachAuth, clearSessionCookie, createSession, destroySession, requireAuth,
  safeEqual, sessionOwner, setSessionCookie, tokenFromRequest, verifyCredentials,
} from './auth.js';
import {
  OWNER, createConversation, deleteConversation, getConversation, getOpportunity, getProfile,
  getSignal as getOwnerSignal, getTransfer, listConversations,
  listOpportunities, listSaved, listSignals, listTransfers, removeSaved, saveItem, saveOnboarding,
  updateConversation, updateSavedCollection,
} from './repos.js';
import { INDUSTRY_MAP } from '../shared/catalog/industries.js';
import { askDrift } from './intelligence/ask.js';
import { ResearchError } from './llm/research.js';
import { collectResearch, parseSources } from './research/collect.js';
import { researchStatus } from './research/errors.js';
import { extractSignals } from './llm/extract.js';
import { runAgent, seededAnswer } from './chat/agent.js';
import { LlmError } from './llm/openrouter.js';
import { env, loadEnv } from './env.js';
import { trends, TrendError } from './trends/service.js';
import type { ChatMessage, SavedItemType, WorkspaceSections } from '../shared/types.js';

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function randomId(): string {
  return randomUUID();
}

export function createApi(): Router {
  const api = Router();
  api.use(json({ limit: '64kb' }));
  api.use(attachAuth);

  // ── Auth ──
  api.post('/auth/login', handle(async (req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (typeof email !== 'string' || typeof password !== 'string' || !verifyCredentials(email, password)) {
      if (process.env.DRIFT_DEBUG) {
        const expected = loadEnv();
        console.log(`[auth] login rejected: configured=${!!expected.email && !!expected.password} emailMatch=${typeof email === 'string' && !!expected.email && email.trim().toLowerCase() === expected.email.toLowerCase()} passwordMatch=${typeof password === 'string' && !!expected.password && safeEqual(password, expected.password)}`);
      }
      res.status(401).json({ error: 'Those credentials do not match the DRIFT account.' });
      return;
    }
    const owner = OWNER();
    const { token, expiresAt } = await createSession(owner);
    setSessionCookie(res, token, expiresAt);
    const profile = await getProfile(owner);
    res.json({ email: profile.email, onboardingCompleted: profile.onboarding.completed });
  }));

  api.post('/auth/logout', handle(async (req, res) => {
    await destroySession(tokenFromRequest(req));
    clearSessionCookie(res);
    res.status(204).end();
  }));

  api.get('/auth/session', handle(async (req, res) => {
    if (!req.owner) {
      res.json({ authenticated: false, email: null, onboardingCompleted: false });
      return;
    }
    const profile = await getProfile(req.owner);
    res.json({ authenticated: true, email: profile.email, onboardingCompleted: profile.onboarding.completed });
  }));

  // ── Profile & onboarding ──
  api.get('/profile', requireAuth, handle(async (req, res) => {
    res.json(await getProfile(req.owner!));
  }));

  api.put('/profile/onboarding', requireAuth, handle(async (req, res) => {
    const { exploring, purposes, interests } = (req.body ?? {}) as Record<string, unknown>;
    const clean = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 24) : []);
    const profile = await saveOnboarding(req.owner!, { exploring: clean(exploring), purposes: clean(purposes), interests: clean(interests) });
    res.json(profile);
  }));

  // ── Trend Research: saved findings + explicitly requested pulls ──
  api.get('/trends', requireAuth, handle(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json(await trends.feed(req.owner!));
  }));

  api.post('/trends/pull', requireAuth, handle(async (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'refresh') {
      badRequest(res, 'Research is on demand. Use a manual refresh.');
      return;
    }
    const profile = await getProfile(req.owner!);
    if (!profile.onboarding.completed) {
      badRequest(res, 'Complete your preferences before starting research.');
      return;
    }
    try {
      const feed = await trends.start(req.owner!, mode, profile.onboarding);
      res.status(feed.state.status === 'running' ? 202 : 200).json(feed);
    } catch (error) {
      if (error instanceof TrendError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  }));

  // ── Extracted signals (read from saved research) ──
  api.get('/signals', requireAuth, handle(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    const signals = await listSignals(req.owner!);
    res.json(signals);
  }));

  api.get('/signals/status', requireAuth, handle(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json(await extraction.status(req.owner!));
  }));
  api.get('/signals/:id', requireAuth, handle(async (req, res) => {
    const signal = await getOwnerSignal(req.owner!, String(req.params.id));
    if (!signal) { res.status(404).json({ error: 'Signal not found.' }); return; }
    res.json(signal);
  }));
  api.post('/signals/extract', requireAuth, handle(async (req, res) => {
    if (!env.openrouterKey) { res.status(503).json({ error: 'OPENROUTER_API_KEY is not configured.' }); return; }
    const status = await extraction.start(req.owner!);
    res.status(status.state === 'running' ? 202 : 200).json({ count: 0, signals: await listSignals(req.owner!), status });
  }));

  api.post('/transfers', requireAuth, handle(async (req, res) => {
    res.json(await generation.transfer(req.owner!, String(req.body?.signalId ?? ''), String(req.body?.industryId ?? '')));
  }));
  api.get('/transfers', requireAuth, handle(async (req, res) => {
    const items = await listTransfers(req.owner!);
    res.json(req.query.legacy === 'true' ? items : items.filter(t => t.provenance && t.analysis));
  }));
  api.get('/transfers/:id', requireAuth, handle(async (req, res) => {
    const transfer = await getTransfer(req.owner!, String(req.params.id));
    if (!transfer) { res.status(404).json({ error: 'Transfer not found.' }); return; }
    res.json(transfer);
  }));
  api.post('/transfers/:id/opportunities', requireAuth, handle(async (req, res) => {
    const transfer = await getTransfer(req.owner!, String(req.params.id));
    if (!transfer) { res.status(404).json({ error: 'Transfer not found.' }); return; }
    res.json(await generation.opportunities(req.owner!, transfer.signalId, transfer.industryId, transfer.id));
  }));
  api.post('/opportunities', requireAuth, handle(async (req, res) => {
    res.json(await generation.opportunities(req.owner!, String(req.body?.signalId ?? ''), String(req.body?.industryId ?? '')));
  }));
  api.get('/opportunities', requireAuth, handle(async (req, res) => {
    const items = await listOpportunities(req.owner!);
    res.json(req.query.legacy === 'true' ? items : items.filter(o => o.provenance && o.analysis));
  }));
  api.get('/opportunities/:id', requireAuth, handle(async (req, res) => {
    const opportunity = await getOpportunity(req.owner!, String(req.params.id));
    if (!opportunity) { res.status(404).json({ error: 'Opportunity not found.' }); return; }
    res.json(opportunity);
  }));
  api.post('/opportunities/:id/regenerate', requireAuth, handle(async (req, res) => {
    res.json(await generation.regenerate(req.owner!, String(req.params.id)));
  }));
  api.post('/opportunities/:id/refine', requireAuth, handle(async (req, res) => {
    res.json(await generation.refine(req.owner!, String(req.params.id), req.body?.section));
  }));

  // ── Saved ──
  api.get('/saved', requireAuth, handle(async (req, res) => {
    const items = await listSaved(req.owner!);
    const hydrated = await Promise.all(items.map(async (item) => ({
      item,
      signal: item.type === 'signal' ? await getOwnerSignal(req.owner!, item.refId) : null,
      transfer: item.type === 'transfer' ? await getTransfer(req.owner!, item.refId) : null,
      opportunity: item.type === 'opportunity' ? await getOpportunity(req.owner!, item.refId) : null,
    })));
    res.json(hydrated);
  }));

  api.post('/saved', requireAuth, handle(async (req, res) => {
    const { type, refId, collection } = (req.body ?? {}) as { type?: SavedItemType; refId?: string; collection?: string };
    if (!type || !refId || !['signal', 'transfer', 'opportunity'].includes(type)) {
      badRequest(res, 'A saved item needs a valid type and refId.');
      return;
    }
    res.json(await saveItem(req.owner!, type, refId, (collection || 'Inbox').slice(0, 60)));
  }));

  api.patch('/saved/:id', requireAuth, handle(async (req, res) => {
    const { collection } = (req.body ?? {}) as { collection?: string };
    if (!collection) {
      badRequest(res, 'Missing collection.');
      return;
    }
    const updated = await updateSavedCollection(req.owner!, String(req.params.id), collection.slice(0, 60));
    if (!updated) {
      res.status(404).json({ error: 'Saved item not found.' });
      return;
    }
    res.json(updated);
  }));

  api.delete('/saved/:id', requireAuth, handle(async (req, res) => {
    const removed = await removeSaved(req.owner!, String(req.params.id));
    if (!removed) {
      res.status(404).json({ error: 'Saved item not found.' });
      return;
    }
    res.status(204).end();
  }));

  // ── Ask DRIFT ──
  api.post('/ask', requireAuth, handle(async (req, res) => {
    const { question, useWeb } = (req.body ?? {}) as { question?: string; useWeb?: boolean };
    if (!question || typeof question !== 'string' || question.trim().length < 4) {
      badRequest(res, 'Ask a fuller question.');
      return;
    }
    const profile = await getProfile(req.owner!);
    // Web search stays OFF unless explicitly enabled for this question.
    res.json(await askDrift(req.owner!, question.trim().slice(0, 500), profile.onboarding, { useWeb: useWeb === true }));
  }));

  // ── Dev/admin research — run a research query, review extracted signals ──
  api.post('/research', requireAuth, handle(async (req, res) => {
    const { query, extract, sources } = (req.body ?? {}) as { query?: string; extract?: boolean; sources?: unknown };
    if (!query || typeof query !== 'string' || query.trim().length < 1) {
      badRequest(res, 'Provide a research query.');
      return;
    }
    try {
      if (query.trim().length > 300) { badRequest(res, 'Use a query of at most 300 characters.'); return; }
      const selected = parseSources(sources);
      const research = await collectResearch(query.trim(), selected);
      const body: Record<string, unknown> = {
        answer: research.answer,
        provider: research.provider,
        fallbackReason: research.fallbackReason,
        insufficientEvidence: research.insufficientEvidence,
        citations: research.citations,
        evidence: research.evidence,
        providers: research.providers,
        reason: research.reason,
        extractedSignals: null,
      };
      if (extract === true) {
        // Process research separately into validated structured signal data.
        // These are returned for review only; the catalog is not mutated.
        body.extractedSignals = await extractSignals({ query: query.trim(), answer: research.answer, evidence: research.evidence });
      }
      res.json(body);
    } catch (error) {
      if (error instanceof ResearchError) {
        res.status(researchStatus(error.kind)).json({ error: error.message, kind: error.kind, provider: error.provider, reason: error.reason, providers: error.reports, evidence: error.partialEvidence });
        return;
      }
      throw error;
    }
  }));

  // ── Conversations (Ask DRIFT chat) ──
  api.get('/chat', requireAuth, handle(async (req, res) => {
    res.json(await listConversations(req.owner!));
  }));

  api.post('/chat', requireAuth, handle(async (req, res) => {
    res.json(await createConversation(req.owner!));
  }));

  api.get('/chat/:id', requireAuth, handle(async (req, res) => {
    const convo = await getConversation(req.owner!, String(req.params.id));
    if (!convo) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json(convo);
  }));

  api.patch('/chat/:id', requireAuth, handle(async (req, res) => {
    const { title } = (req.body ?? {}) as { title?: string };
    if (!title) {
      badRequest(res, 'Missing title.');
      return;
    }
    const updated = await updateConversation(req.owner!, String(req.params.id), { title: title.slice(0, 120) });
    if (!updated) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.json(updated);
  }));

  api.delete('/chat/:id', requireAuth, handle(async (req, res) => {
    const removed = await deleteConversation(req.owner!, String(req.params.id));
    if (!removed) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    res.status(204).end();
  }));

  // Streaming message endpoint (SSE).
  api.post('/chat/:id/messages', requireAuth, async (req, res) => {
    const owner = req.owner!;
    const { text, useWeb } = (req.body ?? {}) as { text?: string; useWeb?: boolean };
    if (!text || typeof text !== 'string' || text.trim().length < 2) {
      badRequest(res, 'Message is too short.');
      return;
    }
    const convo = await getConversation(owner, String(req.params.id));
    if (!convo) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const profile = await getProfile(owner);

    const sse = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    res.status(200);
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders?.();

    const userMessage: ChatMessage = {
      id: randomId(),
      role: 'user',
      content: text.trim().slice(0, 1000),
      createdAt: new Date().toISOString(),
    };
    // Persist the user turn immediately so the thread is intact even if the stream fails.
    let messages = [...convo.messages, userMessage];
    const title = convo.messages.length === 0 ? text.trim().slice(0, 60) : convo.title;
    await updateConversation(owner, convo.id, { messages, title });

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    try {
      const outcome = env.openrouterKey
        ? await runAgent({
            owner,
            prefs: profile.onboarding,
            history: convo.messages,
            userText: userMessage.content,
            useWeb: useWeb === true,
            signal: abort.signal,
            onToken: (delta) => sse({ type: 'token', delta }),
            onTool: (ev) => sse({ type: 'tool', name: ev.name, summary: ev.summary }),
          })
        : await seededAnswer(owner, profile.onboarding, userMessage.content, useWeb === true);

      messages = [...messages, outcome.assistantMessage];
      await updateConversation(owner, convo.id, { messages });
      sse({
        type: 'done',
        message: outcome.assistantMessage,
        references: outcome.references,
        proposals: outcome.proposals,
        research: outcome.research,
      });
    } catch (error) {
      const kind = error instanceof LlmError || error instanceof ResearchError ? error.kind : 'unavailable';
      if (kind === 'cancelled') {
        sse({ type: 'error', kind, message: 'Stopped.' });
      } else {
        sse({ type: 'error', kind, message: error instanceof Error ? error.message : 'Something went wrong.' });
      }
    } finally {
      res.end();
    }
  });

  // Execute a confirmed proposal (read-only + suggest: writes only happen here, on user confirm).
  api.post('/chat/:id/proposals/:proposalId/execute', requireAuth, handle(async (req, res) => {
    const owner = req.owner!;
    const convo = await getConversation(owner, String(req.params.id));
    if (!convo) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const proposal = convo.messages
      .flatMap((m) => m.proposals ?? [])
      .find((p) => p.id === String(req.params.proposalId));
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found.' });
      return;
    }

    let note = '';
    let links: { label: string; href: string }[] = [];
    if (proposal.kind === 'transfer' && proposal.params.signalId && proposal.params.industryId) {
      const transfer = await generation.transfer(owner, proposal.params.signalId, proposal.params.industryId);
      note = `Created a transfer hypothesis: ${proposal.label}.`;
      links = [{ label: proposal.label, href: `/app/transfer?transfer=${transfer.id}` }];
    } else if (proposal.kind === 'generate_opportunities' && proposal.params.signalId && proposal.params.industryId) {
      const created = await generation.opportunities(owner, proposal.params.signalId, proposal.params.industryId);
      note = 'Generated three opportunity hypotheses.';
      links = created.map(o => ({ label: o.name, href: `/app/opportunities/${o.id}` }));
    } else if (proposal.kind === 'save' && proposal.params.type && proposal.params.refId) {
      await saveItem(owner, proposal.params.type, proposal.params.refId, proposal.params.collection ?? 'Inbox');
      note = `Saved — ${proposal.label}.`;
      links = [{ label: 'Open Saved', href: '/app/saved' }];
    } else {
      badRequest(res, 'This proposal cannot be executed.');
      return;
    }

    const noteMessage: ChatMessage = {
      id: randomId(),
      role: 'assistant',
      content: note,
      createdAt: new Date().toISOString(),
    };
    await updateConversation(owner, convo.id, { messages: [...convo.messages, noteMessage] });
    res.json({ note, links });
  }));

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GenerationError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof LlmError) { res.status(err.kind === 'rate_limited' ? 429 : 503).json({ error: `Analysis unavailable (${err.kind}). Existing results are unchanged.`, kind: err.kind }); return; }
    if (err instanceof ResearchError) {
      res.status(researchStatus(err.kind)).json({ error: err.message, kind: err.kind, provider: err.provider, reason: err.reason, providers: err.reports, evidence: err.partialEvidence });
      return;
    }
    console.error('[drift] API error:', err);
    res.status(500).json({ error: 'Something went wrong inside DRIFT.' });
  });

  return api;
}

const PROTECTED_PATHS = [/^\/app(\/|$)/, /^\/onboarding(\/|$)/];

/** Works on both Express requests and Vite/connect's plain IncomingMessage. */
function requestPath(req: Request): string {
  const url = req.url ?? '';
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function redirect(res: Response, location: string): void {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

/** HTML route guard: redirects unauthenticated users to /login and completed users past onboarding. */
export function pageGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.method !== 'GET') {
        next();
        return;
      }
      const path = requestPath(req).replace(/\.html$/, '').replace(/\/$/, '') || '/';
      if (path === '/login') {
        const owner = await sessionOwner(tokenFromRequest(req));
        if (owner) {
          const profile = await getProfile(owner);
          redirect(res, profile.onboarding.completed ? '/app/discover' : '/onboarding');
          return;
        }
        next();
        return;
      }
      if (PROTECTED_PATHS.some((re) => re.test(path))) {
        const owner = await sessionOwner(tokenFromRequest(req));
        if (!owner) {
          redirect(res, '/login');
          return;
        }
        if (path === '/onboarding') {
          const profile = await getProfile(owner);
          if (profile.onboarding.completed) {
            redirect(res, '/app/discover');
            return;
          }
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Rewrites clean URLs to the actual HTML entries (used by both Vite dev and the prod server). */
export function cleanUrls() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const path = requestPath(req);
    if (path === '/login') req.url = '/login.html';
    else if (path === '/onboarding' || path === '/app' || path.startsWith('/app/')) req.url = '/app.html';
    next();
  };
}
