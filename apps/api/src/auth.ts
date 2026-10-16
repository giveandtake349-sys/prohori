import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { users } from 'db';

export interface AuthIdentity {
  id: string;
  email: string | null;
}

export interface AppProfile {
  id: string;
  name: string;
  phone: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      authIdentity?: AuthIdentity;
      appProfile?: AppProfile;
    }
  }
}

/** Verify the bearer token with Supabase Auth itself; never trust a client-supplied user ID. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '');
  if (!match) {
    res.status(401).json({ error: 'sign in required' });
    return;
  }

  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!baseUrl || !apiKey) {
    res.status(503).json({ error: 'authentication is not configured on the API' });
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${match[1]}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      res.status(401).json({ error: 'session expired or invalid; sign in again' });
      return;
    }
    if (!response.ok) {
      res.status(503).json({ error: 'authentication service unavailable' });
      return;
    }

    const body = (await response.json()) as { id?: unknown; email?: unknown };
    if (typeof body.id !== 'string') {
      res.status(401).json({ error: 'invalid authentication response' });
      return;
    }
    req.authIdentity = {
      id: body.id,
      email: typeof body.email === 'string' ? body.email : null,
    };
    next();
  } catch {
    res.status(503).json({ error: 'could not verify session with authentication service' });
  }
}

/** Load the Prohori profile whose UUID is the verified Supabase Auth user UUID. */
export async function requireProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.authIdentity) {
    res.status(401).json({ error: 'sign in required' });
    return;
  }
  try {
    const [profile] = await db
      .select({ id: users.id, name: users.name, phone: users.phone, role: users.role })
      .from(users)
      .where(eq(users.id, req.authIdentity.id));
    if (!profile) {
      res.status(409).json({ error: 'complete your Prohori profile first', code: 'profile_incomplete' });
      return;
    }
    req.appProfile = profile;
    next();
  } catch (error) {
    next(error);
  }
}

/** Require a profile and a privileged server-side role; the client cannot submit its own role. */
export async function requireModerator(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.authIdentity) {
    res.status(401).json({ error: 'sign in required' });
    return;
  }
  try {
    const [profile] = await db
      .select({ id: users.id, name: users.name, phone: users.phone, role: users.role })
      .from(users)
      .where(eq(users.id, req.authIdentity.id));
    if (!profile || (profile.role !== 'moderator' && profile.role !== 'admin')) {
      res.status(403).json({ error: 'moderator permission required' });
      return;
    }
    req.appProfile = profile;
    next();
  } catch (error) {
    next(error);
  }
}

/** Require a profile with the admin role (server-side). Admin role can never
 *  be granted through the API — it is set directly in the database. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.authIdentity) {
    res.status(401).json({ error: 'sign in required' });
    return;
  }
  try {
    const [profile] = await db
      .select({ id: users.id, name: users.name, phone: users.phone, role: users.role })
      .from(users)
      .where(eq(users.id, req.authIdentity.id));
    if (!profile || profile.role !== 'admin') {
      res.status(403).json({ error: 'admin permission required' });
      return;
    }
    req.appProfile = profile;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional auth: if a Bearer token is present it is verified with Supabase
 * Auth (same as requireAuth) and the matching profile loaded onto
 * req.appProfile; if absent, or if verification fails, the request proceeds
 * anonymously (req.appProfile stays unset). Used for public routes that
 * add a small personalization flag (e.g. `following`) for signed-in users.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '');
  if (!match) {
    next();
    return;
  }
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!baseUrl || !apiKey) {
    next();
    return;
  }
  try {
    const userEndpoint = `${baseUrl}/auth/v1/user`;
    const keyHeader = apiKey;
    const authHeaderValue = `Bearer ${match[1]}`;
    const response = await fetch(userEndpoint, {
      headers: {
        apikey: keyHeader,
        authorization: authHeaderValue,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      next();
      return;
    }
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string') {
      next();
      return;
    }
    const [profile] = await db
      .select({ id: users.id, name: users.name, phone: users.phone, role: users.role })
      .from(users)
      .where(eq(users.id, body.id));
    if (profile) req.appProfile = profile;
    next();
  } catch {
    // Best-effort: an unverifiable token just means anonymous mode.
    next();
  }
}
