import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, and, lt, not, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { sendToUserIds } from '../lib/notify.js';
import { reports, reportFollowers, statusHistory } from 'db';

// Mounted at /api/cron in index.ts.
export const cronRouter = Router();

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const LEVEL_LABEL: Record<string, string> = { thana: 'থানা', sp: 'SP', dig: 'DIG' };

/**
 * POST /api/cron/deadlines — daily deadline/escalation sweep (hit via a
 * Render Cron Job). For every report whose 7-day police-action deadline
 * (deadlineAt) has passed and is not yet marked overdue (and not
 * resolved/rejected):
 *   - marks overdue=true (drives the red "X দিন — পুলিশ ব্যবস্থা নেয়নি" pill
 *     and the +500 hot-feed boost),
 *   - escalates the level ladder thana → sp; an already-'sp' case that was
 *     escalated more than 7 days ago moves up to 'dig',
 *   - writes a status-history note,
 *   - FCM-notifies the case followers.
 *
 * Idempotent: already-overdue reports are never re-picked.
 *
 * Auth: CRON_SECRET must be set on the API and the request must carry it as
 * the `x-cron-secret` header. If CRON_SECRET is unset, the endpoint refuses
 * with a 403 + hint (unlike /api/admin/escalation/run, this one is strict
 * because overdue/escalation is user-visible).
 */
cronRouter.post('/deadlines', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      res.status(403).json({
        error: 'CRON_SECRET is not set on the API — set the env var and call again with the x-cron-secret header',
      });
      return;
    }
    if (req.header('x-cron-secret') !== secret) {
      res.status(403).json({ error: 'invalid cron secret' });
      return;
    }

    const now = new Date();
    const candidates = await db
      .select()
      .from(reports)
      .where(
        and(
          lt(reports.deadlineAt, now),
          eq(reports.overdue, false),
          not(inArray(reports.status, ['resolved', 'rejected'])),
        ),
      );

    const escalated: Array<{
      report_id: string;
      tracking_id: string;
      from_level: string;
      to_level: string;
      days_overdue: number;
    }> = [];

    for (const r of candidates) {
      const daysOverdue = Math.max(
        0,
        Math.floor((now.getTime() - new Date(r.deadlineAt!).getTime()) / 86400000),
      );
      let newLevel = r.escalationLevel;
      let didEscalate = false;
      if (r.escalationLevel === 'thana') {
        newLevel = 'sp';
        didEscalate = true;
      } else if (
        r.escalationLevel === 'sp' &&
        r.escalatedAt &&
        now.getTime() - new Date(r.escalatedAt).getTime() > SEVEN_DAYS_MS
      ) {
        newLevel = 'dig';
        didEscalate = true;
      }

      await db
        .update(reports)
        .set({
          overdue: true,
          escalationLevel: newLevel,
          ...(didEscalate ? { escalatedAt: now } : {}),
          lastActivityAt: now,
        })
        .where(eq(reports.id, r.id));

      const note = didEscalate
        ? `ডেডলাইন পার — ${daysOverdue} দিন ধরে পুলিশ ব্যবস্থা নেয়নি; case এখন ${LEVEL_LABEL[newLevel] ?? newLevel} level এ (was ${r.escalationLevel})`
        : `ডেডলাইন পার — ${daysOverdue} দিন ধরে পুলিশ ব্যবস্থা নেয়নি (overdue)`;
      await db.insert(statusHistory).values({
        reportId: r.id,
        fromStatus: r.status,
        toStatus: r.status,
        actorId: null,
        note,
      });

      if (didEscalate) {
        escalated.push({
          report_id: r.id,
          tracking_id: r.trackingId,
          from_level: r.escalationLevel,
          to_level: newLevel,
          days_overdue: daysOverdue,
        });
      }

      // Notify followers (fire-and-forget — a push failure never breaks the cron).
      const followerRows = await db
        .select({ userId: reportFollowers.userId })
        .from(reportFollowers)
        .where(eq(reportFollowers.reportId, r.id));
      const followerIds = followerRows.map((f) => f.userId);
      if (followerIds.length > 0) {
        void sendToUserIds(followerIds, {
          title: '🔴 ডেডলাইন পার',
          body: `${daysOverdue} দিন পার — পুলিশ ব্যবস্থা নেয়নি, case এখন ${LEVEL_LABEL[newLevel] ?? newLevel} level এ (${r.trackingId})`,
          data: { kind: 'overdue', report_id: r.id, level: newLevel, tracking_id: r.trackingId },
        });
      }
    }

    res.json({ overdue_marked: candidates.length, escalated });
  } catch (e) {
    next(e);
  }
});
