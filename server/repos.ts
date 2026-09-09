import { randomUUID } from 'node:crypto';
import { getStore } from './db';
import { env } from './env';
import { validIndustries } from '../shared/signals';
import type { Evidence } from '../shared/evidence';
import type { Conversation, ConversationMeta, ExtractedSignal, OnboardingPrefs, Opportunity, Profile, SavedItem, SavedItemType, Transfer, TrendTopic, WorkspaceSections } from '../shared/types';

export const OWNER = () => env.email.toLowerCase() || 'owner';

function emptyOnboarding(): OnboardingPrefs {
  return { completed: false, completedAt: null, exploring: [], purposes: [], interests: [] };
}

export async function getProfile(owner: string): Promise<Profile> {
  const store = await getStore();
  const existing = await store.profiles.findOne({ owner });
  if (existing) return existing as Profile;
  const profile: Profile = { owner, email: env.email, onboarding: emptyOnboarding(), updatedAt: new Date().toISOString() };
  await store.profiles.insertOne(profile);
  return profile;
}

export async function saveOnboarding(owner: string, prefs: Omit<OnboardingPrefs, 'completed' | 'completedAt'>): Promise<Profile> {
  const store = await getStore();
  await getProfile(owner);
  await store.profiles.updateOne(
    { owner },
    {
      onboarding: { completed: true, completedAt: new Date().toISOString(), ...prefs },
      updatedAt: new Date().toISOString(),
    },
    true,
  );
  return getProfile(owner);
}

export async function insertTransfer(owner: string, data: Omit<Transfer, 'id' | 'owner' | 'createdAt'>): Promise<Transfer> {
  const store = await getStore();
  const transfer: Transfer = { id: randomUUID(), owner, createdAt: new Date().toISOString(), ...data };
  await store.transfers.insertOne(transfer);
  return transfer;
}

export async function getTransfer(owner: string, id: string): Promise<Transfer | null> {
  const store = await getStore();
  return (await store.transfers.findOne({ owner, id })) as Transfer | null;
}

export async function listTransfers(owner: string): Promise<Transfer[]> {
  const store = await getStore();
  const all = (await store.transfers.find({ owner })) as Transfer[];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function insertOpportunity(owner: string, data: Omit<Opportunity, 'id' | 'owner' | 'createdAt' | 'updatedAt'>): Promise<Opportunity> {
  const store = await getStore();
  const now = new Date().toISOString();
  const opportunity: Opportunity = { id: randomUUID(), owner, createdAt: now, updatedAt: now, ...data };
  await store.opportunities.insertOne(opportunity);
  return opportunity;
}

export async function getOpportunity(owner: string, id: string): Promise<Opportunity | null> {
  const store = await getStore();
  return (await store.opportunities.findOne({ owner, id })) as Opportunity | null;
}

export async function listOpportunities(owner: string): Promise<Opportunity[]> {
  const store = await getStore();
  const all = (await store.opportunities.find({ owner })) as Opportunity[];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateOpportunity(owner: string, id: string, set: Partial<Opportunity>): Promise<Opportunity | null> {
  const store = await getStore();
  await store.opportunities.updateOne({ owner, id }, { ...set, updatedAt: new Date().toISOString() });
  return getOpportunity(owner, id);
}

export async function setWorkspaceSection(owner: string, id: string, section: keyof WorkspaceSections, text: string): Promise<Opportunity | null> {
  const opportunity = await getOpportunity(owner, id);
  if (!opportunity) return null;
  const workspace = { ...opportunity.workspace, [section]: text };
  return updateOpportunity(owner, id, { workspace });
}

export async function saveItem(owner: string, type: SavedItemType, refId: string, collection: string): Promise<SavedItem> {
  const store = await getStore();
  const ref = type === 'signal' ? await getSignal(owner, refId) : type === 'transfer' ? await getTransfer(owner, refId) : type === 'opportunity' ? await getOpportunity(owner, refId) : null;
  if (!ref) throw new Error('Saved reference is not available for this owner.');
  const existing = (await store.saved.findOne({ owner, type, refId })) as SavedItem | null;
  if (existing) {
    if (existing.collection !== collection) {
      await store.saved.updateOne({ owner, type, refId }, { collection });
      return { ...existing, collection };
    }
    return existing;
  }
  const item: SavedItem = { id: randomUUID(), owner, type, refId, collection, createdAt: new Date().toISOString() };
  await store.saved.insertOne(item);
  return item;
}

export async function listSaved(owner: string): Promise<SavedItem[]> {
  const store = await getStore();
  const all = (await store.saved.find({ owner })) as SavedItem[];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function removeSaved(owner: string, id: string): Promise<boolean> {
  const store = await getStore();
  return (await store.saved.deleteOne({ owner, id })) > 0;
}

export async function updateSavedCollection(owner: string, id: string, collection: string): Promise<SavedItem | null> {
  const store = await getStore();
  await store.saved.updateOne({ owner, id }, { collection });
  return (await store.saved.findOne({ owner, id })) as SavedItem | null;
}

// ── Conversations (Ask DRIFT threads) ──

export async function createConversation(owner: string): Promise<Conversation> {
  const store = await getStore();
  const now = new Date().toISOString();
  const convo: Conversation = {
    id: randomUUID(),
    owner,
    title: 'New conversation',
    summary: '',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  await store.conversations.insertOne(convo);
  return convo;
}

export async function getConversation(owner: string, id: string): Promise<Conversation | null> {
  const store = await getStore();
  return (await store.conversations.findOne({ owner, id })) as Conversation | null;
}

export async function listConversations(owner: string): Promise<ConversationMeta[]> {
  const store = await getStore();
  const all = (await store.conversations.find({ owner })) as Conversation[];
  return all
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length }));
}

export async function updateConversation(
  owner: string,
  id: string,
  set: Partial<Pick<Conversation, 'title' | 'summary' | 'messages'>>,
): Promise<Conversation | null> {
  const store = await getStore();
  await store.conversations.updateOne({ owner, id }, { ...set, updatedAt: new Date().toISOString() });
  return getConversation(owner, id);
}

export async function deleteConversation(owner: string, id: string): Promise<boolean> {
  const store = await getStore();
  return (await store.conversations.deleteOne({ owner, id })) > 0;
}

// ── Signals (extracted from Trend Research evidence) ──
function researchSignal(doc: ExtractedSignal): ExtractedSignal {
  const evidence = doc.evidence ?? [];
  return { ...doc, industries: doc.classificationVersion === 'saved-evidence-v2' ? validIndustries(doc.industries) : [],
    path: [], nextDomains: [], momentum: null, timeline: [],
    momentumEvidence: evidence.flatMap(e => e.provider === 'serpapi-trends' && e.metrics.trends ? [e.metrics.trends] : []) };
}

export async function listSignals(owner: string): Promise<ExtractedSignal[]> {
  const store = await getStore();
  const docs = await store.signals.find({ owner }) as ExtractedSignal[];
  return docs.map(researchSignal).sort((a, b) => {
    const aM = a.momentumEvidence[0]?.slope12Month ?? -9999;
    const bM = b.momentumEvidence[0]?.slope12Month ?? -9999;
    return bM - aM || b.sourceCount - a.sourceCount;
  });
}

export async function getSignal(owner: string, id: string): Promise<ExtractedSignal | null> {
  const store = await getStore();
  const doc = await store.signals.findOne({ owner, id }) as ExtractedSignal | null;
  return doc ? researchSignal(doc) : null;
}

/**
 * Merge an extracted signal into the owner's collection. Signals are identified
 * by slug (id); on collision, evidence unions and metadata is refreshed. No
 * signal is ever deleted by a merge — it only gains evidence over time.
 */
export async function mergeSignal(owner: string, incoming: ExtractedSignal): Promise<void> {
  const store = await getStore();
  const existing = await store.signals.findOne({ owner, id: incoming.id }) as ExtractedSignal | null;
  if (!existing) {
    await store.signals.insertOne({ owner, ...incoming });
    return;
  }
  const now = new Date().toISOString();
  const evidenceMap = new Map<string, Evidence>();
  for (const e of [...existing.evidence, ...incoming.evidence]) evidenceMap.set(e.url, e);
  const momentumEvidence = [...evidenceMap.values()].flatMap(e => e.provider === 'serpapi-trends' && e.metrics.trends ? [e.metrics.trends] : []);
  await store.signals.updateOne({ owner, id: incoming.id }, {
    name: incoming.name,
    summary: incoming.summary,
    meaning: incoming.meaning || existing.meaning,
    why: incoming.why || existing.why,
    need: incoming.need || existing.need,
    category: incoming.category,
    industries: incoming.industries,
    classificationVersion: incoming.classificationVersion,
    path: [],
    nextDomains: [],
    evidence: [...evidenceMap.values()],
    sourceCount: evidenceMap.size,
    momentumEvidence,
    stage: incoming.stage,
    confidence: incoming.confidence,
    tags: [...new Set([...existing.tags, ...incoming.tags])].slice(0, 8),
    timeline: [],
    related: [],
    updatedAt: now,
  });
}

export { extractSignalsFromTopics } from './signals/extraction';
