import type { Evidence, ProviderReport, ResearchErrorKind, ResearchProvider } from '../../shared/evidence';

export class ResearchError extends Error {
  reports?: ProviderReport[];
  constructor(
    public kind: ResearchErrorKind,
    message: string,
    public provider: ResearchProvider = 'perplexity-sonar',
    public reason: string = kind,
    public attempts = 1,
    public partialEvidence: Evidence[] = [],
  ) { super(message); }
}

export const researchStatus = (kind: ResearchErrorKind): number => kind === 'credentials' ? 502
  : kind === 'rate_limited' ? 429 : kind === 'budget' ? 402 : kind === 'invalid' ? 400
  : kind === 'timeout' ? 504 : 503;
