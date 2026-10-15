import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, desc, count } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody, uuidParam, isPgUniqueViolation } from '../validate.js';
import { petitions, petitionSignatures, petitionEvents, reports } from 'db';

export const petitionsRouter = Router();

const LEVELS = ['thana', 'sp', 'dig'] as const;

const createPetitionSchema = z.object({
  report_id: z.string().uuid().nullable().optional(),
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(2000),
  threshold: z.number().int().min(10).max(100000).optional(),
});

// POST /api/petitions — start a "dabi" (community demand).
// May link a report, or stand alone (e.g. a demand about an unsafe area).
// The creator is always the signed-in user from the verified bearer token.
petitionsRouter.post(
  '/',
  requireAuth,
  requireProfile,
  validateBody(createPetitionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as z.infer<typeof createPetitionSchema>;
      if (b.report_id) {
        const [r] = await db.select({ id: reports.id }).from(reports).where(eq(reports.id, b.report_id));
        if (!r) {
          res.status(404).json({ error: 'report not found' });
          return;
        }
      }
      const [p] = await db
        .insert(petitions)
        .values({
          reportId: b.report_id ?? null,
          title: b.title,
          description: b.description,
          createdBy: req.appProfile!.id,
          threshold: b.threshold ?? 100,
        })
        .returning();
      await db.insert(petitionEvents).values({ petitionId: p.id, event: 'created' });
      res.status(201).json({
        id: p.id,
        title: p.title,
        threshold: p.threshold,
        level: p.level,
        status: p.status,
        signature_count: 0,
        progress_pct: 0,
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/petitions/:id/sign — sign a petition as the signed-in user.
// Idempotent: signing twice is a no-op that returns the current count.
petitionsRouter.post(
  '/:id/sign',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const userId = req.appProfile!.id;
      const [p] = await db.select({ id: petitions.id }).from(petitions).where(eq(petitions.id, id));
      if (!p) {
        res.status(404).json({ error: 'petition not found' });
        return;
      }
      try {
        await db.insert(petitionSignatures).values({ petitionId: id, userId });
      } catch (e) {
        if (!isPgUniqueViolation(e)) throw e; // already signed → no-op
      }
      const [{ n }] = await db
        .select({ n: count() })
        .from(petitionSignatures)
        .where(eq(petitionSignatures.petitionId, id));
      // Threshold just crossed (idempotent signing means n === threshold only on
      // the exact signature that crosses it) → audit it + fire the share-webhook
      // placeholder. SHARE_WEBHOOK_URL (optional env): a future bot endpoint that
      // auto-posts the share text. Fire-and-forget — a webhook failure never
      // breaks signing.
      const [full] = await db.select().from(petitions).where(eq(petitions.id, id));
      if (full && n === full.threshold) {
        await db.insert(petitionEvents).values({ petitionId: id, event: 'threshold_reached' });
        const hook = process.env.SHARE_WEBHOOK_URL;
        if (hook) {
          const payload = {
            petition_id: id,
            title: full.title,
            signature_count: n,
            threshold: full.threshold,
            share_text: composePetitionShareText(full.title, n, full.threshold, petitionShareUrl()),
          };
          void fetch(hook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch((e: unknown) =>
            console.warn('[petitions] share webhook failed:', (e as Error).message),
          );
        }
      }
      res.json({ petition_id: id, signature_count: n, already_signed: true });
    } catch (e) {
      next(e);
    }
  },
);

async function withCounts(rows: Array<typeof petitions.$inferSelect>) {
  return Promise.all(
    rows.map(async (p) => {
      const [{ n }] = await db
        .select({ n: count() })
        .from(petitionSignatures)
        .where(eq(petitionSignatures.petitionId, p.id));
      let reportInfo: { tracking_id: string; title: string } | null = null;
      if (p.reportId) {
        const [r] = await db
          .select({ trackingId: reports.trackingId, title: reports.title })
          .from(reports)
          .where(eq(reports.id, p.reportId));
        if (r) reportInfo = { tracking_id: r.trackingId, title: r.title };
      }
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        threshold: p.threshold,
        level: p.level,
        status: p.status,
        created_at: p.createdAt,
        signature_count: n,
        progress_pct: Math.min(100, Math.round((n / Math.max(1, p.threshold)) * 100)),
        report: reportInfo,
      };
    }),
  );
}

// GET /api/petitions — list with signature counts + progress (public).
petitionsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db.select().from(petitions).orderBy(desc(petitions.createdAt)).limit(100);
    res.json({ petitions: await withCounts(rows), count: rows.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/petitions/:id — detail with event log (public).
petitionsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [p] = await db.select().from(petitions).where(eq(petitions.id, id));
    if (!p) {
      res.status(404).json({ error: 'petition not found' });
      return;
    }
    const [detail] = await withCounts([p]);
    const events = await db
      .select({ event: petitionEvents.event, createdAt: petitionEvents.createdAt })
      .from(petitionEvents)
      .where(eq(petitionEvents.petitionId, id))
      .orderBy(desc(petitionEvents.createdAt));
    res.json({ ...detail, events });
  } catch (e) {
    next(e);
  }
});

/** Base URL of the web app for share links (set WEB_APP_URL on Render). */
export function petitionShareUrl(): string {
  const base = (process.env.WEB_APP_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/#/dabi` : '';
}

/** Auto-generated Bangla share text shown once a petition hits its threshold. */
export function composePetitionShareText(
  title: string,
  signatureCount: number,
  threshold: number,
  shareUrl: string,
): string {
  const lines = [
    `✊ দাবি: ${title}`,
    `${signatureCount} জন স্বাক্ষর করেছে (লক্ষ্য: ${threshold}) — এবার ব্যবস্থা নিতেই হবে!`,
    'প্রহরী — জনতার চোখ',
  ];
  if (shareUrl) lines.push(shareUrl);
  return lines.join('\n');
}

// GET /api/petitions/:id/share — share-ready text for a petition that
// reached its signature threshold (public).
petitionsRouter.get('/:id/share', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [p] = await db.select().from(petitions).where(eq(petitions.id, id));
    if (!p) {
      res.status(404).json({ error: 'petition not found' });
      return;
    }
    const [detail] = await withCounts([p]);
    const thresholdReached = detail.signature_count >= p.threshold;
    res.json({
      petition_id: id,
      threshold_reached: thresholdReached,
      signature_count: detail.signature_count,
      threshold: p.threshold,
      share_text: composePetitionShareText(p.title, detail.signature_count, p.threshold, petitionShareUrl()),
      share_url: petitionShareUrl(),
    });
  } catch (e) {
    next(e);
  }
});

export { LEVELS };
