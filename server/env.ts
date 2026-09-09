/** Server-side environment. Never imported by client code. */
export interface DriftEnv {
  email: string;
  password: string;
  sessionSecret: string;
  mongoUri: string;
  mongoDb: string;
  openrouterKey: string;
  serpapiKey: string;
  signalModel: string;
  askModel: string;
  sonarModel: string;
  researchDataDir: string;
  researchMonthlyBudget: number;
  isProd: boolean;
  port: number;
}

const DEV_SECRET = 'drift-dev-only-secret-change-me';

export function loadEnv(): DriftEnv {
  const email = (process.env.DRIFT_LOGIN_EMAIL ?? '').trim();
  const password = process.env.DRIFT_LOGIN_PASSWORD ?? '';
  if (!email || !password) {
    console.warn('[drift] DRIFT_LOGIN_EMAIL / DRIFT_LOGIN_PASSWORD are not set — all logins will be rejected. See .env.example.');
  }
  const sessionSecret = process.env.SESSION_SECRET || DEV_SECRET;
  if (sessionSecret === DEV_SECRET) {
    console.warn('[drift] SESSION_SECRET is not set — using a development-only secret. Set it in .env.local.');
  }
  const mongoUri = (process.env.MONGODB_URI ?? '').trim();
  if (!mongoUri) {
    console.warn('[drift] MONGODB_URI is not set — using a temporary in-memory store. Data will NOT persist across restarts.');
  }
  return {
    email,
    password,
    sessionSecret,
    mongoUri,
    mongoDb: process.env.MONGODB_DB || 'drift',
    openrouterKey: (process.env.OPENROUTER_API_KEY ?? '').trim(),
    serpapiKey: (process.env.SERPAPI_API_KEY ?? '').trim(),
    signalModel: (process.env.OPENROUTER_SIGNAL_MODEL ?? 'google/gemini-2.5-flash-lite').trim(),
    askModel: (process.env.OPENROUTER_ASK_MODEL ?? 'google/gemini-3.1-flash-lite').trim(),
    sonarModel: (process.env.OPENROUTER_SONAR_MODEL ?? 'perplexity/sonar').trim(),
    researchDataDir: process.env.DRIFT_RESEARCH_DATA_DIR || '.drift/research',
    researchMonthlyBudget: Math.max(0, Math.min(75, Number(process.env.DRIFT_RESEARCH_MONTHLY_BUDGET ?? 75))),
    isProd: process.env.NODE_ENV === 'production',
    port: Number(process.env.PORT || 4173),
  };
}

export const env = loadEnv();
