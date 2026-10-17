import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, desc, inArray, count, and, gte } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireModerator } from '../auth.js';
import { validateBody, uuidParam } from '../validate.js';
import { publicReportColumns, ALL_STATUSES, verificationTierOf } from '../lib/public.js';
import { reports, statusHistory, alerts, moderationActions, users, reportFollowers } from 'db';
import { sendToUserIds } from '../lib/notify.js';
import { generateCaseStory } from './growth.js';

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
    res.json({
      queue: rows.map((row) => ({ ...row, verificationTier: verificationTierOf(row) })),
      count: total,
      scope,
      nextOffset,
    });
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
        .set({ status: to_status, lastActivityAt: new Date() })
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
      // v16: resolved → auto-generate the viral case story (fire-and-forget).
      if (to_status === 'resolved') {
        void generateCaseStory(id).catch((e) => console.error('[story] generate failed:', e));
      }

      // Moderation audit log — verify/reject. Who did what, when, and why.
      if (to_status === 'verified' || to_status === 'rejected') {
        await db.insert(moderationActions).values({
          reportId: id,
          moderatorId: req.appProfile!.id,
          action: to_status === 'verified' ? 'verify' : 'reject',
          reason: note?.trim() || null,
        });
      }

      // Notify the reporter (if not anonymous) that a moderator acted.
      // Fire-and-forget: push failure must never break moderation.
      if (report.reporterId && (to_status === 'verified' || to_status === 'rejected')) {
        const title = to_status === 'verified' ? 'রিপোর্ট যাচাই হয়েছে ✓' : 'রিপোর্ট বাতিল হয়েছে';
        const body =
          to_status === 'verified'
            ? `${report.trackingId}: প্রহরী যাচাইকৃত — এখন ৫ কি.মি. এলাকায় অ্যালার্ট যাবে।`
            : `${report.trackingId}: মডারেটর রিপোর্টটি বাতিল করেছেন।${note?.trim() ? ` কারণ: ${note.trim()}` : ''}`;
        void sendToUserIds([report.reporterId], {
          title,
          body,
          data: { kind: 'moderation', report_id: id, status: to_status },
        });
      }

      // Notify case followers (except the acting moderator) of the status change.
      // Fire-and-forget: push failure must never break moderation.
      const followerRows = await db
        .select({ userId: reportFollowers.userId })
        .from(reportFollowers)
        .where(eq(reportFollowers.reportId, id));
      const followerIds = followerRows
        .map((r) => r.userId)
        .filter((uid) => uid !== req.appProfile!.id && uid !== report.reporterId);
      if (followerIds.length > 0) {
        const statusBn: Record<string, string> = {
          submitted: 'জমা হয়েছে',
          verifying: 'যাচাই চলছে',
          verified: 'প্রহরী যাচাইকৃত ✓',
          forwarded: 'থানায় পাঠানো হয়েছে',
          investigating: 'তদন্ত চলছে',
          resolved: 'সমাধান হয়েছে ✓',
          rejected: 'বাতিল হয়েছে',
        };
        void sendToUserIds(followerIds, {
          title: 'কেস আপডেট',
          body: `${report.trackingId}: স্ট্যাটাস এখন — ${statusBn[to_status] ?? to_status}`,
          data: { kind: 'moderation', report_id: id, status: to_status },
        });
      }

      res.json({
        id: updated.id,
        tracking_id: updated.trackingId,
        status: updated.status,
        corroboration_count: updated.corroborationCount,
        action_taken_count: updated.actionTakenCount,
        no_action_count: updated.noActionCount,
        verification_tier: verificationTierOf(updated),
        accused_name: updated.accusedName,
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/admin/reports/:id/history — per-report status timeline +
// moderation audit log. Moderators see the RAW accused name here (the public
// API redacts it until the official seal).
adminRouter.get(
  '/:id/history',
  requireAuth,
  requireModerator,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const [report] = await db.select().from(reports).where(eq(reports.id, id));
      if (!report) {
        res.status(404).json({ error: 'report not found' });
        return;
      }
      const timeline = await db
        .select({
          fromStatus: statusHistory.fromStatus,
          toStatus: statusHistory.toStatus,
          note: statusHistory.note,
          createdAt: statusHistory.createdAt,
        })
        .from(statusHistory)
        .where(eq(statusHistory.reportId, id))
        .orderBy(statusHistory.createdAt);
      const auditRows = await db
        .select({
          action: moderationActions.action,
          reason: moderationActions.reason,
          createdAt: moderationActions.createdAt,
          moderatorName: users.name,
        })
        .from(moderationActions)
        .leftJoin(users, eq(moderationActions.moderatorId, users.id))
        .where(eq(moderationActions.reportId, id))
        .orderBy(desc(moderationActions.createdAt));
      res.json({
        report_id: id,
        tracking_id: report.trackingId,
        status: report.status,
        verification_tier: verificationTierOf(report),
        // Raw value for moderators; the public feed redacts until official seal.
        accused_name: report.accusedName,
        status_history: timeline,
        moderation_actions: auditRows,
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/admin/reports/stats — moderation panel header stats.
adminRouter.get('/stats', requireAuth, requireModerator, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [pendingRow] = await db
      .select({ n: count() })
      .from(reports)
      .where(inArray(reports.status, ['submitted', 'verifying']));
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [verifiedRow] = await db
      .select({ n: count() })
      .from(statusHistory)
      .where(and(eq(statusHistory.toStatus, 'verified'), gte(statusHistory.createdAt, dayAgo)));
    const [rejectedRow] = await db
      .select({ n: count() })
      .from(statusHistory)
      .where(and(eq(statusHistory.toStatus, 'rejected'), gte(statusHistory.createdAt, dayAgo)));

    // Avg hours from report creation to a moderator's verify/reject decision,
    // over the last 30 days.
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const decisions = await db
      .select({ reportId: moderationActions.reportId, createdAt: moderationActions.createdAt })
      .from(moderationActions)
      .where(
        and(
          inArray(moderationActions.action, ['verify', 'reject']),
          gte(moderationActions.createdAt, monthAgo),
        ),
      )
      .limit(500);
    let avgVerifyHours: number | null = null;
    if (decisions.length > 0) {
      const reportIds = [...new Set(decisions.map((d) => d.reportId))];
      const created = await db
        .select({ id: reports.id, createdAt: reports.createdAt })
        .from(reports)
        .where(inArray(reports.id, reportIds));
      const createdAt = new Map(created.map((r) => [r.id, new Date(r.createdAt).getTime()]));
      const hours: number[] = [];
      for (const d of decisions) {
        const c = createdAt.get(d.reportId);
        if (c !== undefined) {
          const h = (new Date(d.createdAt).getTime() - c) / 3600000;
          if (h >= 0) hours.push(h);
        }
      }
      if (hours.length > 0) {
        avgVerifyHours = Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10;
      }
    }

    res.json({
      pending: pendingRow?.n ?? 0,
      verified_today: verifiedRow?.n ?? 0,
      rejected_today: rejectedRow?.n ?? 0,
      avg_verify_hours: avgVerifyHours,
    });
  } catch (e) {
    next(e);
  }
});
