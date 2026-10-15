import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { validateBody, uuidParam } from '../validate.js';
import { publicReportColumns, ALL_STATUSES } from '../lib/public.js';
import { reports, statusHistory, users, alerts } from 'db';

export const adminRouter = Router();

// TODO(auth): replace the body `actor_id` with the Supabase auth session once
// login lands. The role check below stays — it just reads the session user.
async function requireModerator(actorId: string | null | undefined, res: Response): Promise<boolean> {
  if (!actorId) {
    res.status(403).json({ error: 'actor_id is required for this action' });
    return false;
  }
  const [actor] = await db.select({ role: users.role }).from(users).where(eq(users.id, actorId));
  if (!actor || (actor.role !== 'moderator' && actor.role !== 'admin')) {
    res.status(403).json({ error: 'only moderators/admins can perform this action' });
    return false;
  }
  return true;
}

const statusChangeSchema = z.object({
  to_status: z.enum(ALL_STATUSES),
  actor_id: z.string().uuid().nullable().optional(),
  note: z.string().max(1000).optional(),
});

// GET /api/admin/reports/queue — moderator review queue.
// Only 'verifying' reports (community corroboration got them here);
// ordered by corroboration count so the hottest reports are reviewed first.
// Includes police-action accountability counters.
adminRouter.get('/queue', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select(publicReportColumns)
      .from(reports)
      .where(eq(reports.status, 'verifying'))
      .orderBy(desc(reports.corroborationCount))
      .limit(100);
    res.json({ queue: rows, count: rows.length });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/reports/:id/status — move a report through the pipeline.
// VERIFICATION AUTHORITY: only moderator/admin may set 'verified' or 'rejected'.
// Community corroboration can only ever reach 'verifying' (see reports router).
adminRouter.patch(
  '/:id/status',
  validateBody(statusChangeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const { to_status, actor_id, note } = req.body as z.infer<typeof statusChangeSchema>;

      const [report] = await db.select().from(reports).where(eq(reports.id, id));
      if (!report) {
        res.status(404).json({ error: 'report not found' });
        return;
      }
      if (report.status === to_status) {
        res.status(400).json({ error: `report is already ${to_status}` });
        return;
      }

      if (to_status === 'verified' || to_status === 'rejected') {
        const ok = await requireModerator(actor_id ?? null, res);
        if (!ok) return;
      }

      const [updated] = await db
        .update(reports)
        .set({ status: to_status })
        .where(eq(reports.id, id))
        .returning();

      await db.insert(statusHistory).values({
        reportId: id,
        fromStatus: report.status,
        toStatus: to_status,
        actorId: actor_id ?? null,
        note: note ?? null,
      });

      // A verified report goes public: create its 5 km community alert.
      if (to_status === 'verified') {
        await db.insert(alerts).values({ reportId: id, radiusKm: '5' });
      }

      res.json({
        id: updated.id,
        tracking_id: updated.trackingId,
        status: updated.status,
        corroboration_count: updated.corroborationCount,
        action_taken_count: updated.actionTakenCount,
        no_action_count: updated.noActionCount,
      });
    } catch (e) {
      next(e);
    }
  },
);
