import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { validateBody } from '../validate.js';
import { apiKeys, apiKeyRequests } from 'db';
import { runShieldCheck, sha256 } from '../lib/shieldCheck.js';

/**
 * BlackHole Dhapa 2 — Bank Trust API.
 * Banks/MFS buy fraud intelligence; users stay free.
 * Auth: x-api-key header (only sha256 hash stored server-side).
 */
export const trustRouter = Router();

async function keyAuth(req: Request, res: Response): Promise<{ id: string; plan: string } | null> {
  const raw = req.header('x-api-key')?.trim();
  if (!raw) {
    res.status(401).json({ error: 'missing x-api-key' });
    return null;
  }
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, sha256(raw))).limit(1);
  if (!key || !key.active) {
    res.status(401).json({ error: 'invalid or inactive api key' });
    return null;
  }
  return { id: key.id, plan: key.plan ?? 'starter' };
}

// POST /api/v1/check — one fraud check against the live scam DB
trustRouter.post(
  '/check',
  validateBody(z.object({ input: z.string().min(1).max(2000) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = await keyAuth(req, res);
      if (!key) return;
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id)).limit(1);
      if (!row) {
        res.status(401).json({ error: 'invalid api key' });
        return;
      }
      const used = row.usedThisMonth ?? 0;
      const quota = row.quotaMonthly ?? 10000;
      if (used >= quota) {
        res.status(429).json({ error: 'monthly quota exceeded', plan: row.plan, quota, used });
        return;
      }
      const started = Date.now();
      const { input } = req.body as { input: string };
      const v = await runShieldCheck(input);
      // meter usage
      await db
        .update(apiKeys)
        .set({ usedThisMonth: sql`${apiKeys.usedThisMonth} + 1` })
        .where(eq(apiKeys.id, row.id));
      res.json({
        verdict: v.verdict,
        riskPct: v.riskPct,
        reports: v.stats.reports,
        confirms: v.stats.confirms,
        label: v.title,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/v1/request-key — key request form (from #/developers)
trustRouter.post(
  '/request-key',
  validateBody(
    z.object({
      name: z.string().min(1).max(120),
      org: z.string().max(160).optional().default(''),
      email: z.string().email().max(160),
      plan: z.enum(['starter', 'growth', 'bank']).default('starter'),
      note: z.string().max(1000).optional().default(''),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, org, email, plan, note } = req.body as {
        name: string;
        org: string;
        email: string;
        plan: 'starter' | 'growth' | 'bank';
        note: string;
      };
      const [saved] = await db
        .insert(apiKeyRequests)
        .values({ name, org: org || null, email, plan, note: note || null })
        .returning({ id: apiKeyRequests.id });
      res.json({ ok: true, id: saved?.id ?? null });
    } catch (e) {
      next(e);
    }
  },
);
