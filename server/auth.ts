import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env';
import { getStore } from './db';

export const SESSION_COOKIE = 'drift_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return undefined;
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', env.sessionSecret).update(a).digest();
  const hb = createHmac('sha256', env.sessionSecret).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Constant-time comparison of both fields against the environment credentials. */
export function verifyCredentials(email: string, password: string): boolean {
  if (!env.email || !env.password) return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), env.email.toLowerCase());
  const passwordOk = safeEqual(password, env.password);
  return emailOk && passwordOk;
}

export async function createSession(owner: string): Promise<{ token: string; expiresAt: Date }> {
  const store = await getStore();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await store.sessions.insertOne({ token, owner, createdAt: new Date().toISOString(), expiresAt });
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/' });
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const store = await getStore();
  await store.sessions.deleteOne({ token });
}

export function tokenFromRequest(req: Request): string | undefined {
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

export async function sessionOwner(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const store = await getStore();
  const session = await store.sessions.findOne({ token });
  if (!session) return null;
  if (new Date(session.expiresAt as string).getTime() < Date.now()) {
    await store.sessions.deleteOne({ token });
    return null;
  }
  return session.owner as string;
}

declare module 'express-serve-static-core' {
  interface Request {
    owner?: string;
  }
}

/** Populates req.owner when a valid session cookie is present. */
export async function attachAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = tokenFromRequest(req);
    req.owner = (await sessionOwner(token)) ?? undefined;
    if (process.env.DRIFT_DEBUG) {
      console.log(`[auth] ${req.method} ${req.url} token=${token ? token.slice(0, 8) : 'none'} owner=${req.owner ?? 'none'}`);
    }
  } catch {
    req.owner = undefined;
  }
  next();
}

/** API guard: 401 JSON when unauthenticated. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.owner) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}
