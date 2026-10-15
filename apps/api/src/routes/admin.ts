import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, desc, inArray, count } from 'drizzle-orm';
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

// GET /api/admin/reports/queue?scope=pending|all — moderators control all reports.
// Pending includes every new submission, not just community-corroborated reports.
adminRouter.get('/queue', requireAuth, requireModerator, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = req.query.scope === 'all' ? 'all' : 'pending';
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 100;
    const rawOffset = Number(req.query.offset);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    const condition = scope === 'pending' ? inArray(reports.status, ['submitted', 'verifying']) : undefined;
    const countRows = condition
      ? await db.select({ total: count() }).from(reports).where(condition)
      : await db.select({ total: count() }).from(reports);
    const total = countRows[0]?.total ?? 0;
    const rows = condition
      ? await db
          .select(publicReportColumns)
          .from(reports)
          .where(condition)
          .orderBy(desc(reports.corroborationCount), desc(reports.createdAt))
          .limit(limit)
          .offset(offset)
      : await db
          .select(publicReportColumns)
          .from(reports)
          .orderBy(desc(reports.createdAt))
          .limit(limit)
          .offset(offset);
    const nextOffset = offset + rows.length < total ? offset + rows.length : null;
    res.json({ queue: rows, count: total, scope, nextOffset });
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
      if (report.status === to_status && !note?.trim()) {
        res.status(400).json({ error: `report is already ${to_status}; add a note or choose another status` });
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

      // The report is already public; verification creates one 5 km community alert.
      if (to_status === 'verified') {
        const [existingAlert] = await db
          .select({ id: alerts.id })
          .from(alerts)
          .where(eq(alerts.reportId, id))
          .limit(1);
        if (!existingAlert) {
          await db.insert(alerts).values({ reportId: id, radiusKm: '5' });
        }
      }
      // Rejected reports are removed from the public feed and no longer alertable.
      if (to_status === 'rejected') {
        await db.delete(alerts).where(eq(alerts.reportId, id));
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
