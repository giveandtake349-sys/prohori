import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { and, desc, eq, gt, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireModerator } from '../auth.js';
import { validateBody } from '../validate.js';
import {
  scamPatterns,
  scamEntities,
  scamReports,
  scamChecks,
  shieldStats,
  scamConfirms,
  type ScamEntity,
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

type InputType = 'number' | 'shop' | 'app' | 'offer' | 'text';

/** Auto-detect what the user pasted. */
function detectType(raw: string): { type: InputType; normalized: string } {
  const input = raw.trim();
  const lower = input.toLowerCase();
  const digits = input.replace(/\D/g, '');
  if (/^01[3-9]\d{8}$/.test(digits)) return { type: 'number', normalized: digits };
  if (lower.includes('t.me') || lower.includes('telegram')) return { type: 'offer', normalized: input.slice(0, 500) };
  if (lower.includes('fb.com') || lower.includes('facebook.com')) return { type: 'shop', normalized: input.slice(0, 300) };
  if (lower.includes('play.google')) return { type: 'app', normalized: input.slice(0, 200) };
  return { type: 'text', normalized: input.slice(0, 500) };
}

const SAVED_AVG: Record<string, number> = { offer: 45000, app: 30000, number: 9000, shop: 13700, text: 15000 };

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface VerdictResult {
  verdict: 'fraud' | 'suspect' | 'blacklisted' | 'unknown' | 'clean';
  title: string;
  reasons: string[];
  stats: { reports: number; confirms: number };
  entity: ScamEntity | null;
  riskPct: number;
}

/** Score free text against active scam playbooks. */
async function scoreText(text: string): Promise<{ pattern: string; riskPct: number; matched: string[] } | null> {
  const patterns = await db.select().from(scamPatterns).where(eq(scamPatterns.active, true));
  const lower = text.toLowerCase();
  let best: { pattern: string; riskPct: number; matched: string[] } | null = null;
  for (const p of patterns) {
    const keywords = (p.keywords ?? []) as string[];
    if (!keywords.length) continue;
    const signals = (p.signals ?? {}) as Record<string, number>;
    const matched = keywords.filter((k) => lower.includes(k.toLowerCase()));
    if (!matched.length) continue;
    const totalWeight = keywords.reduce((s, k) => s + (signals[k.toLowerCase()] ?? 10), 0);
    const hitWeight = matched.reduce((s, k) => s + (signals[k.toLowerCase()] ?? 10), 0);
    const riskPct = Math.min(99, Math.round((hitWeight / totalWeight) * 100));
    if (!best || riskPct > best.riskPct) best = { pattern: p.name, riskPct, matched };
  }
  return best;
}

async function buildVerdict(type: InputType, normalized: string): Promise<VerdictResult> {
  // 1) Entity lookup for number/shop/app
  if (type === 'number' || type === 'shop' || type === 'app') {
    const like = `%${normalized.slice(0, 60)}%`;
    const rows = await db
      .select()
      .from(scamEntities)
      .where(and(eq(scamEntities.type, type), or(eq(scamEntities.value, normalized), ilike(scamEntities.value, like))))
      .limit(1);
    const entity = rows[0] ?? null;
    if (entity) {
      const stats = { reports: entity.reportCount ?? 0, confirms: entity.confirmCount ?? 0 };
      if (entity.status === 'fraud')
        return { verdict: 'fraud', title: entity.label ?? 'Fraud', reasons: [`${stats.reports} টা verified রিপোর্ট`, entity.label ?? ''], stats, entity, riskPct: 95 };
      if (entity.status === 'blacklisted')
        return { verdict: 'blacklisted', title: entity.label ?? 'Blacklisted', reasons: ['কর্তৃপক্ষের blacklist এ আছে'], stats, entity, riskPct: 99 };
      if (entity.status === 'suspect')
        return { verdict: 'suspect', title: entity.label ?? 'সন্দেহজনক', reasons: [`${stats.reports} টা রিপোর্ট — যাচাই চলছে`], stats, entity, riskPct: 55 };
      if (entity.status === 'verified_clean')
        return { verdict: 'clean', title: entity.label ?? 'যাচাইকৃত', reasons: ['কোনো fraud রিপোর্ট নাই'], stats, entity, riskPct: 5 };
    }
    return {
      verdict: 'unknown',
      title: 'এখনো রিপোর্ট হয়নি',
      reasons: ['এই database এ কোনো রিপোর্ট নাই — "নিরাপদ" বলা যাচ্ছে না, সতর্ক থাকো'],
      stats: { reports: 0, confirms: 0 },
      entity,
      riskPct: 10,
    };
  }
  // 2) Text/offer: pattern scoring
  const scored = await scoreText(normalized);
  if (scored) {
    const { riskPct, matched, pattern } = scored;
    if (riskPct >= 60)
      return {
        verdict: 'fraud',
        title: 'Scam pattern match',
        reasons: [`"${pattern}" playbook এর সাথে মিলেছে`, `মিলেছে: ${matched.join(', ')}`],
        stats: { reports: 0, confirms: 0 },
        entity: null,
        riskPct,
      };
    if (riskPct >= 30)
      return {
        verdict: 'suspect',
        title: 'সন্দেহজনক লক্ষণ',
        reasons: [`আংশিক মিল: ${matched.join(', ')}`, 'টাকা পাঠানোর আগে আরো যাচাই করো'],
        stats: { reports: 0, confirms: 0 },
        entity: null,
        riskPct,
      };
  }
  return {
    verdict: 'unknown',
    title: 'চেনা pattern মিলেনি',
    reasons: ['known scam playbook এর সাথে মিলে নাই — তবু সতর্ক থাকো'],
    stats: { reports: 0, confirms: 0 },
    entity: null,
    riskPct: 10,
  };
}

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
      // Log the check (hash only — never raw input)
      await db.insert(scamChecks).values({
        userId,
        inputType: type,
        inputHash: sha256(`${type}:${normalized}`),
        verdict: v.verdict,
      });
      if (userId) await touchStats(userId, type, v.verdict);
      res.json({
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
