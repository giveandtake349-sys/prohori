import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { and, desc, eq, gt, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireModerator } from '../auth.js';
import { validateBody } from '../validate.js';
import { SAVED_AVG, detectType, buildVerdict, sha256, type InputType } from '../lib/shieldCheck.js';
import {
  scamEntities,
  scamReports,
  scamChecks,
  shieldStats,
  scamConfirms,
} from 'db';

export const shieldRouter = Router();

/** Optional auth: attach identity when a valid bearer token is present, else continue anonymous. */
async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
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
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${match[1]}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const body = (await response.json()) as { id?: unknown; email?: unknown };
      if (typeof body.id === 'string') {
        req.authIdentity = { id: body.id, email: typeof body.email === 'string' ? body.email : null };
      }
    }
  } catch {
    /* anonymous */
  }
  next();
}

// NOTE: detectType / scoreText / buildVerdict / sha256 / SAVED_AVG live in
// ../lib/shieldCheck.ts (shared with /api/v1 + /api/fb). This file only keeps
// the optional-auth helper + stats bookkeeping.

async function touchStats(userId: string, type: InputType, verdict: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const [row] = await db.select().from(shieldStats).where(eq(shieldStats.userId, userId)).limit(1);
  const dodged = verdict === 'fraud' || verdict === 'suspect' || verdict === 'blacklisted';
  if (!row) {
    await db.insert(shieldStats).values({
      userId,
      checks: 1,
      dodged: dodged ? 1 : 0,
      savedEstimate: dodged ? SAVED_AVG[type] ?? 15000 : 0,
      streak: 1,
      lastCheckDate: today,
    });
    return;
  }
  const last = row.lastCheckDate;
  const streak = last === today ? row.streak ?? 0 : last === yesterday ? (row.streak ?? 0) + 1 : 1;
  await db
    .update(shieldStats)
    .set({
      checks: (row.checks ?? 0) + 1,
      dodged: (row.dodged ?? 0) + (dodged ? 1 : 0),
      savedEstimate: (row.savedEstimate ?? 0) + (dodged ? SAVED_AVG[type] ?? 15000 : 0),
      streak,
      lastCheckDate: today,
    })
    .where(eq(shieldStats.userId, userId));
}

// POST /api/shield/check — paste anything, get a verdict
shieldRouter.post(
  '/check',
  optionalAuth,
  validateBody(z.object({ input: z.string().min(1).max(2000) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { input } = req.body as { input: string };
      const { type, normalized } = detectType(input);
      const v = await buildVerdict(type, normalized);
      const userId = req.authIdentity?.id ?? null;
      // Log the check (hash only — never raw input); return the check id so the
      // guarantee flow can issue a Protected receipt for safe verdicts.
      const [logged] = await db
        .insert(scamChecks)
        .values({
          userId,
          inputType: type,
          inputHash: sha256(`${type}:${normalized}`),
          verdict: v.verdict,
        })
        .returning({ id: scamChecks.id });
      if (userId) await touchStats(userId, type, v.verdict);
      res.json({
        checkId: logged?.id ?? null,
        type,
        verdict: v.verdict,
        title: v.title,
        reasons: v.reasons.filter(Boolean),
        riskPct: v.riskPct,
        stats: v.stats,
        entityId: v.entity?.id ?? null,
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/shield/radar — live scam feed
shieldRouter.get('/radar', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entities = await db
      .select()
      .from(scamEntities)
      .where(
        and(
          inArray(scamEntities.status, ['fraud', 'suspect', 'blacklisted']),
          or(
            gte(scamEntities.verifiedAt, sql`now() - interval '30 days'`),
            gte(scamEntities.createdAt, sql`now() - interval '30 days'`),
          ),
          // only entities with real user activity — no zero-report clutter
          or(gt(scamEntities.reportCount, 0), gt(scamEntities.confirmCount, 0)),
        ),
      )
      .orderBy(desc(scamEntities.confirmCount), desc(scamEntities.reportCount))
      .limit(20);
    const ids = entities.map((e) => e.id);
    const reports =
      ids.length > 0
        ? await db
            .select()
            .from(scamReports)
            .where(and(inArray(scamReports.entityId, ids), eq(scamReports.status, 'verified')))
            .orderBy(desc(scamReports.createdAt))
            .limit(60)
        : [];
    const byEntity = new Map<string, typeof reports>();
    for (const r of reports) {
      if (!r.entityId) continue;
      const arr = byEntity.get(r.entityId) ?? [];
      if (arr.length < 3) arr.push(r);
      byEntity.set(r.entityId, arr);
    }
    res.json({
      alerts: entities.map((e) => ({
        id: e.id,
        type: e.type,
        value: e.type === 'number' ? e.value : undefined,
        label: e.label,
        status: e.status,
        reportCount: e.reportCount,
        confirmCount: e.confirmCount,
        verifiedAt: e.verifiedAt,
        reports: (byEntity.get(e.id) ?? []).map((r) => ({ id: r.id, title: r.title, details: r.details, createdAt: r.createdAt })),
      })),
    });
  } catch (e) {
    next(e);
  }
});

const reportSchema = z.object({
  type: z.enum(['number', 'shop', 'app', 'link', 'offer']),
  value: z.string().min(1).max(500),
  title: z.string().min(1).max(200),
  details: z.string().max(2000).optional().default(''),
});

// POST /api/shield/report — submit a scam report (auth)
shieldRouter.post(
  '/report',
  requireAuth,
  validateBody(reportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type, value, title, details } = req.body as z.infer<typeof reportSchema>;
      const normalized = type === 'number' ? value.replace(/\D/g, '') : value.trim().slice(0, 300);
      // find-or-create entity
      let [entity] = await db
        .select()
        .from(scamEntities)
        .where(and(eq(scamEntities.type, type), eq(scamEntities.value, normalized)))
        .limit(1);
      if (!entity) {
        [entity] = await db
          .insert(scamEntities)
          .values({ type, value: normalized, label: title, status: 'unknown' })
          .returning();
      }
      const [report] = await db
        .insert(scamReports)
        .values({
          entityId: entity.id,
          reporterId: req.authIdentity!.id,
          category: type,
          title,
          details,
          status: 'pending',
        })
        .returning();
      // bump report count
      await db
        .update(scamEntities)
        .set({ reportCount: sql`${scamEntities.reportCount} + 1` })
        .where(eq(scamEntities.id, entity.id));
      res.json({ report, entity });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/shield/confirm/:id — "আমিও পেয়েছি" (auth, once per user)
shieldRouter.post(
  '/confirm/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      const [entity] = await db.select().from(scamEntities).where(eq(scamEntities.id, id)).limit(1);
      if (!entity) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const userId = req.authIdentity!.id;
      const inserted = await db
        .insert(scamConfirms)
        .values({ entityId: id, userId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length > 0) {
        await db
          .update(scamEntities)
          .set({ confirmCount: sql`${scamEntities.confirmCount} + 1` })
          .where(eq(scamEntities.id, id));
      }
      const [fresh] = await db.select().from(scamEntities).where(eq(scamEntities.id, id)).limit(1);
      res.json({ confirmed: inserted.length > 0, confirmCount: fresh?.confirmCount ?? entity.confirmCount });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/shield/stats — my shield stats (auth)
shieldRouter.get('/stats', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.authIdentity!.id;
    let [row] = await db.select().from(shieldStats).where(eq(shieldStats.userId, userId)).limit(1);
    if (!row) {
      [row] = await db
        .insert(shieldStats)
        .values({ userId, checks: 0, dodged: 0, savedEstimate: 0, streak: 0, lastCheckDate: null })
        .returning();
    }
    // recent fraud-verdict checks for the Bachalam ledger
    const recent = await db
      .select({ verdict: scamChecks.verdict, inputType: scamChecks.inputType, createdAt: scamChecks.createdAt })
      .from(scamChecks)
      .where(and(eq(scamChecks.userId, userId), inArray(scamChecks.verdict, ['fraud', 'suspect', 'blacklisted'])))
      .orderBy(desc(scamChecks.createdAt))
      .limit(10);
    res.json({
      stats: {
        checks: row.checks ?? 0,
        dodged: row.dodged ?? 0,
        savedEstimate: row.savedEstimate ?? 0,
        streak: row.streak ?? 0,
        lastCheckDate: row.lastCheckDate,
      },
      ledger: recent.map((r) => ({
        verdict: r.verdict,
        inputType: r.inputType,
        savedEstimate: SAVED_AVG[r.inputType] ?? 15000,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/shield/watchdog — public fraud wall
shieldRouter.get('/watchdog', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entities = await db
      .select()
      .from(scamEntities)
      .where(inArray(scamEntities.status, ['fraud', 'blacklisted']))
      .orderBy(desc(scamEntities.reportCount))
      .limit(30);
    const ids = entities.map((e) => e.id);
    const reports =
      ids.length > 0
        ? await db
            .select()
            .from(scamReports)
            .where(and(inArray(scamReports.entityId, ids), eq(scamReports.status, 'verified')))
            .orderBy(desc(scamReports.createdAt))
            .limit(90)
        : [];
    const byEntity = new Map<string, typeof reports>();
    for (const r of reports) {
      if (!r.entityId) continue;
      const arr = byEntity.get(r.entityId) ?? [];
      if (arr.length < 3) arr.push(r);
      byEntity.set(r.entityId, arr);
    }
    res.json({
      wall: entities.map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
        status: e.status,
        reportCount: e.reportCount,
        confirmCount: e.confirmCount,
        verifiedAt: e.verifiedAt,
        reports: (byEntity.get(e.id) ?? []).map((r) => ({ id: r.id, title: r.title, details: r.details, createdAt: r.createdAt })),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/shield/moderate/:reportId — verify/reject a scam report (moderator)
shieldRouter.post(
  '/moderate/:reportId',
  requireModerator,
  validateBody(z.object({ action: z.enum(['verify', 'reject']) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reportId } = req.params as { reportId: string };
      const { action } = req.body as { action: 'verify' | 'reject' };
      const [report] = await db.select().from(scamReports).where(eq(scamReports.id, reportId)).limit(1);
      if (!report) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const status = action === 'verify' ? 'verified' : 'rejected';
      await db.update(scamReports).set({ status }).where(eq(scamReports.id, reportId));
      if (action === 'verify' && report.entityId) {
        await db
          .update(scamEntities)
          .set({ status: 'fraud', verifiedAt: new Date() })
          .where(eq(scamEntities.id, report.entityId));
      }
      res.json({ ok: true, status });
    } catch (e) {
      next(e);
    }
  },
);
