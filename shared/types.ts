/** Shared types for the DRIFT client and server. */
import type { Evidence, ResearchMetadata, TrendMomentum } from './evidence.js';
export type { Evidence, ResearchSource, ResearchProvider, ProviderReport, ResearchMetadata, TrendMomentum } from './evidence.js';

export type SignalStage = 'Weak' | 'Emerging' | 'Accelerating' | 'Mainstream';

export type TrendChannel = 'reddit' | 'youtube' | 'google-trends' | 'web';

export interface TrendSource {
  /** Normalized evidence; absent only on research saved by earlier versions. */
  evidence?: Evidence;
  url: string;
  title: string;
  channel: TrendChannel;
  /** Provider-supplied excerpt, never an AI-generated quotation. */
  excerpt: string | null;
  retrievedAt: string;
}

export interface TrendTopic {
  id: string;
  title: string;
  summary: string;
  usRelevance: string;
  whyUseful: string;
  opportunity: { concept: string; audience: string; firstStep: string };
  sources: TrendSource[];
  firstFoundAt: string;
  lastFoundAt: string;
}

export interface TrendCoverage {
  channel: TrendChannel;
  status: 'pending' | 'running' | 'complete' | 'limited' | 'failed';
  topicCount: number;
  note: string | null;
}

export interface TrendResearchState {
  initialized: boolean;
  runId: string;
  status: 'idle' | 'running' | 'complete' | 'partial' | 'failed';
  startedAt: string | null;
  lastPulledAt: string | null;
  coverage: TrendCoverage[];
  error: string | null;
}

export interface TrendFeed {
  state: TrendResearchState;
  topics: TrendTopic[];
  configured: boolean;
}

export interface SignalTimelinePoint {
  period: string;
  value: number; // 0–100 momentum
}

export interface SignalEvidence {
  observation: string;
  source: string;
  date: string;
}

export interface Signal {
  id: string;
  serial: string;
  name: string;
  category: string;
  summary: string;
  meaning: string;
  why: string;
  need: string;
  evidence: SignalEvidence[];
  sourceCount: number;
  industries: string[];
  origin: string;
  nextDomains: string[];
  path: string[];
  momentum: number;
  stage: SignalStage;
  confidence: number;
  timeline: SignalTimelinePoint[];
  related: string[];
  tags: string[];
}

export interface ExtractionStatus {
  state: 'idle' | 'running' | 'complete' | 'partial' | 'failed' | 'unavailable';
  totalEvidence: number;
  processedEvidence: number;
  pendingEvidence: number;
  unavailableTopics: number;
  topicCount: number;
  failures: { evidenceRevisions: string[]; message: string; kind: string }[];
  updatedAt: string | null;
  analysisVersion: string;
}

export interface GenerationProvenance {
  sourceSignalId: string;
  sourceSignalName: string;
  evidenceSnapshot: Evidence[];
  model: string;
  generatedAt: string;
  analysisVersion: string;
}

export interface HypothesisAnalysis {
  label: 'Hypothesis';
  observations: { text: string; evidenceUrls: string[] }[];
  assumptions: string[];
}

/** Live extraction uses only normalized saved evidence. */
export interface ExtractedSignal extends Omit<Signal, 'evidence' | 'momentum'> {
  classificationVersion?: string;
  evidence: Evidence[];
  /** No invented composite score. Use momentumEvidence for measured search momentum. */
  momentum: null;
  momentumEvidence: TrendMomentum[];
}

export interface Industry {
  id: string;
  name: string;
  description: string;
  customers: string[];
  behaviors: string[];
  frictions: string[];
}

export interface OnboardingPrefs {
  completed: boolean;
  completedAt: string | null;
  exploring: string[];
  purposes: string[];
  interests: string[];
}

export interface Profile {
  owner: string;
  email: string;
  onboarding: OnboardingPrefs;
  updatedAt: string;
}

export interface SessionInfo {
  authenticated: boolean;
  email: string | null;
  onboardingCompleted: boolean;
}

export interface TransferInterpretation {
  meaning: string;
  whyTransfer: string;
  changingBehavior: string;
  unmetNeeds: string[];
  productImplications: string[];
  brandImplications: string[];
  risks: string[];
  opportunitySpaces: string[];
}

export interface Transfer {
  provenance?: GenerationProvenance;
  analysis?: HypothesisAnalysis;
  id: string;
  owner: string;
  signalId: string;
  industryId: string;
  seed: number;
  interpretation: TransferInterpretation;
  createdAt: string;
}

export interface WorkspaceSections {
  concept: string;
  targetCustomer: string;
  problem: string;
  productBehavior: string;
  whyNow: string;
  differentiation: string;
  culturalEvidence: string;
  assumptions: string;
  risks: string;
  validationExperiment: string;
}

export interface Opportunity {
  provenance?: GenerationProvenance;
  analysis?: HypothesisAnalysis;
  refinements?: Partial<Record<keyof WorkspaceSections, { provenance: GenerationProvenance; analysis: HypothesisAnalysis }>>;
  id: string;
  owner: string;
  transferId: string | null;
  signalId: string;
  industryId: string;
  seed: number;
  name: string;
  concept: string;
  audience: string;
  culturalInsight: string;
  whyNow: string;
  differentiation: string;
  risk: string;
  /** Legacy template scores only. New hypotheses have no measured confidence. */
  confidence: number | null;
  workspace: WorkspaceSections;
  createdAt: string;
  updatedAt: string;
}

export type SavedItemType = 'signal' | 'transfer' | 'opportunity';

export interface SavedItem {
  id: string;
  owner: string;
  type: SavedItemType;
  refId: string;
  collection: string;
  createdAt: string;
}

export interface AskReference {
  kind: 'signal' | 'map' | 'transfer' | 'opportunity';
  label: string;
  href: string;
}

export interface AskCitation {
  url: string;
  title: string;
}

/** A proposed (not yet executed) write action the assistant suggests. */
export interface ActionProposal {
  id: string;
  kind: 'generate_opportunities' | 'transfer' | 'save';
  label: string;
  /** Params passed to the existing write endpoints when the user confirms. */
  params: {
    signalId?: string;
    industryId?: string;
    type?: 'signal' | 'transfer' | 'opportunity';
    refId?: string;
    collection?: string;
  };
}

export type ChatRole = 'user' | 'assistant';

export interface ToolEvent {
  name: string;
  summary: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  toolEvents?: ToolEvent[];
  references?: AskReference[];
  research?: ResearchMetadata | null;
  proposals?: ActionProposal[];
}

export interface Conversation {
  id: string;
  owner: string;
  title: string;
  summary: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface AskResult {
  question: string;
  answer: string;
  signalIds: string[];
  opportunities: Opportunity[];
  references: AskReference[];
  engine: 'drift' | 'openrouter';
  /** Present when web research was explicitly enabled for this question. */
  research?: ResearchMetadata | null;
}
