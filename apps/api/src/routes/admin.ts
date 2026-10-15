import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireModerator } from '../auth.js';
import { validateBody, uuidParam } from '../validate.js';
import { publicReportColumns, ALL_STATUSES } from '../lib/public.js';
import { reports, statusHistory, alerts } from 'db';

export const adminRouter = Router();

const statusChangeSchema = z.object({
  to_status: z.enum(ALL_STATUSES),
  note: z.string().max(1000).optional(),
});

// GET /api/admin/reports/queue — moderator review queue.
// Only 'verifying' reports (community corroboration got them here);
// ordered by corroboration count so the hottest reports are reviewed first.
// Includes police-action accountability counters.
adminRouter.get('/queue', requireAuth, requireModerator, async (_req: Request, res: Response, next: NextFunction) => {
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
  requireAuth,
  requireModerator,
  validateBody(statusChangeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const { to_status, note } = req.body as z.infer<typeof statusChangeSchema>;

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
        if (req.appProfile?.role !== 'moderator' && req.appProfile?.role !== 'admin') {
          res.status(403).json({ error: 'moderator permission required' });
          return;
        }
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
        actorId: req.appProfile!.id,
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
