import { existsSync } from 'node:fs';

/** Server-side environment. Never imported by client code. */
export interface DriftEnv {
  loginAccounts: LoginAccount[];
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

export interface LoginAccount {
  email: string;
  password: string;
}

const DEV_SECRET = 'drift-dev-only-secret-change-me';

// Direct Node entry points (tests excluded) bypass vite.config.ts, so load the
// documented server env file before reading process.env. Vercel uses project
// environment variables instead.
if (!process.env.VERCEL && !process.env.DRIFT_TEST && existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

export function loadEnv(): DriftEnv {
  const configuredAccounts = [
    ['DRIFT_LOGIN_EMAIL', 'DRIFT_LOGIN_PASSWORD'],
    ['DRIFT_LOGIN_EMAIL_2', 'DRIFT_LOGIN_PASSWORD_2'],
    ['DRIFT_LOGIN_EMAIL_3', 'DRIFT_LOGIN_PASSWORD_3'],
  ] as const;
  const loginAccounts: LoginAccount[] = [];
  const seenEmails = new Set<string>();
  for (const [emailKey, passwordKey] of configuredAccounts) {
    const email = (process.env[emailKey] ?? '').trim();
    const password = process.env[passwordKey] ?? '';
    if (!email && !password) continue;
    if (!email || !password) {
      console.warn(`[drift] ${emailKey} / ${passwordKey} is incomplete and will be ignored.`);
      continue;
    }
    const owner = email.toLowerCase();
    if (seenEmails.has(owner)) {
      console.warn(`[drift] Duplicate login email in ${emailKey} will be ignored.`);
      continue;
    }
    seenEmails.add(owner);
    loginAccounts.push({ email, password });
  }
  if (!loginAccounts.length) {
    console.warn('[drift] No complete DRIFT login credentials are set — all logins will be rejected. See .env.example.');
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
    loginAccounts,
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
