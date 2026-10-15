import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, lt, count } from 'drizzle-orm';
import { db } from '../db.js';
import { validateBody } from '../validate.js';
import { requireAuth, requireModerator } from '../auth.js';
import { sendToUserIds } from '../lib/notify.js';
import { petitions, petitionSignatures, petitionEvents, reports } from 'db';

// Mounted at /api/admin in index.ts. Houses admin endpoints that don't
// belong under /api/admin/reports.
export const adminOpsRouter = Router();

const notifyTestSchema = z.object({
  // The recipient user id (not the actor — the actor is the signed-in moderator).
  user_id: z.string().uuid(),
  title: z.string().min(1).max(120).default('Prohori test'),
  body: z.string().min(1).max(300).default('Push notification test'),
});

// POST /api/admin/notify/test — smoke-test FCM delivery to one user.
// Requires a signed-in moderator/admin (server-side role check).
// Never throws: returns the push result.
adminOpsRouter.post(
  '/notify/test',
  requireAuth,
  requireModerator,
  validateBody(notifyTestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user_id, title, body } = req.body as z.infer<typeof notifyTestSchema>;
      const result = await sendToUserIds([user_id], { title, body, data: { kind: 'test' } });
      res.json({ ok: true, result });
    } catch (e) {
      next(e);
    }
  },
);

const ESCALATION_AGE_DAYS = 7;
const LEVEL_ORDER = ['thana', 'sp', 'dig'] as const;

// POST /api/admin/escalation/run — cron entrypoint (hit daily, e.g. via a
// Render Cron Job). For every ACTIVE petition that is older than 7 days,
// has reached its signature threshold, and whose linked report (if any) is
// still unresolved: mark it escalated and bump its level one step
// (thana → sp → dig). Idempotent: escalated petitions are never re-picked.
//
// Auth: if CRON_SECRET is set, the request must carry it as the
// `x-cron-secret` header. If CRON_SECRET is unset, the endpoint is open
// (documented MVP tradeoff — the action itself is idempotent and can only
// fire when the public criteria are already met).
adminOpsRouter.post('/escalation/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret && req.header('x-cron-secret') !== secret) {
      res.status(403).json({ error: 'invalid cron secret' });
      return;
    }
    const cutoff = new Date(Date.now() - ESCALATION_AGE_DAYS * 24 * 3600 * 1000);
    const candidates = await db
      .select()
      .from(petitions)
      .where(and(eq(petitions.status, 'active'), lt(petitions.createdAt, cutoff)));

    const escalated: Array<{ petition_id: string; title: string; from_level: string; to_level: string; signatures: number }> = [];
    for (const p of candidates) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(petitionSignatures)
        .where(eq(petitionSignatures.petitionId, p.id));
      if (n < p.threshold) continue;

      if (p.reportId) {
        const [r] = await db.select({ status: reports.status }).from(reports).where(eq(reports.id, p.reportId));
        // Skip if the linked case is already closed out.
        if (!r || r.status === 'resolved' || r.status === 'rejected') continue;
      }

      const idx = LEVEL_ORDER.indexOf(p.level as (typeof LEVEL_ORDER)[number]);
      const toLevel = LEVEL_ORDER[Math.min(idx + 1, LEVEL_ORDER.length - 1)];
      await db.update(petitions).set({ status: 'escalated', level: toLevel }).where(eq(petitions.id, p.id));
      await db.insert(petitionEvents).values({
        petitionId: p.id,
        event: `auto-escalated to ${toLevel} after ${ESCALATION_AGE_DAYS} days with ${n} signatures`,
      });
      escalated.push({ petition_id: p.id, title: p.title, from_level: p.level, to_level: toLevel, signatures: n });
    }
    res.json({ ok: true, checked: candidates.length, escalated });
  } catch (e) {
    next(e);
  }
});
