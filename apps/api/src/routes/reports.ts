import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, or, inArray, desc, gte, lt, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile, optionalAuth } from '../auth.js';
import { validateBody, isPgUniqueViolation, pathParam, uuidParam } from '../validate.js';
import { generateTrackingId } from '../lib/tracking.js';
import { haversineKm } from '../lib/geo.js';
import {
  publicReportColumns,
  PUBLIC_STATUSES,
  CATEGORIES,
  toPublicReport,
  STAGE1_THRESHOLD,
  stageThresholdFor,
  verificationStageOf,
} from '../lib/public.js';
import { sendToUserIds } from '../lib/notify.js';
import { checkHotspotAlert } from './hotspots.js';
import { reports, reportMedia, corroborations, actionClaims, actionClaimVotes, reportFollowers, statusHistory, districts, users } from 'db';

export const reportsRouter = Router();

const mediaSchema = z.object({
  url: z.string().url().max(2000),
  sha256: z.string().length(64),
  captured_at: z.string().datetime({ offset: true }).optional(),
});

const createReportSchema = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address_text: z.string().min(2).max(300),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  is_anonymous: z.boolean().default(false),
  // Denormalized incident district for cheap filtering (optional).
  district_id: z.string().uuid().nullable().optional(),
  // Sensitive-case name; public responses redact it until official verification.
  accused_name: z.string().min(2).max(200).nullable().optional(),
  media: z.array(mediaSchema).max(10).optional(),
});

// POST /api/reports — submit a report (anonymous allowed: reporter_id null)
reportsRouter.post(
  '/',
  requireAuth,
  requireProfile,
  validateBody(createReportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as z.infer<typeof createReportSchema>;
      const anonymous = b.is_anonymous === true;
      const sensitiveCategory = ['dhorshon', 'khun', 'ghum'].includes(b.category);
      if (b.accused_name && !sensitiveCategory) {
        res.status(400).json({ error: 'accused_name is only supported for sensitive case categories' });
        return;
      }
      if (b.district_id) {
        const [d] = await db.select({ id: districts.id }).from(districts).where(eq(districts.id, b.district_id));
        if (!d) {
          res.status(404).json({ error: 'district not found' });
          return;
        }
      }

      // Retry on the rare tracking-id collision.
      let row;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          [row] = await db
            .insert(reports)
            .values({
              trackingId: generateTrackingId(),
              reporterId: anonymous ? null : req.appProfile!.id,
              category: b.category,
              title: b.title,
              description: b.description,
              lat: b.lat,
              lng: b.lng,
              addressText: b.address_text,
              occurredAt: b.occurred_at ? new Date(b.occurred_at) : new Date(),
              isAnonymous: anonymous,
              districtId: b.district_id ?? null,
              accusedName: b.accused_name ?? null,
            })
            .returning();
          break;
        } catch (e) {
          if (isPgUniqueViolation(e)) continue;
          throw e;
        }
      }
      if (!row) {
        res.status(500).json({ error: 'could not generate tracking id' });
        return;
      }

      if (b.media?.length) {
        await db.insert(reportMedia).values(
          b.media.map((m) => ({
            reportId: row.id,
            url: m.url,
            sha256: m.sha256,
            capturedAt: m.captured_at ? new Date(m.captured_at) : null,
          })),
        );
      }

      await db.insert(statusHistory).values({
        reportId: row.id,
        fromStatus: null,
        toStatus: 'submitted',
        actorId: req.appProfile!.id,
        note: 'Report submitted',
      });

      res.status(201).json({ tracking_id: row.trackingId, id: row.id, status: row.status });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/reports — public feed (verified pipeline only). Never exposes reporter identity.
// ?sort=hot|new — "hot" (default) ranks by engagement × recency with big
// boosts for overdue cases, looming deadlines and verified cases; "new" is
// plain reverse-chronological.
reportsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const radiusKm = req.query.radius_km !== undefined ? Number(req.query.radius_km) : 50;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const districtId = typeof req.query.district_id === 'string' ? req.query.district_id : undefined;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const sort = req.query.sort === 'new' ? 'new' : 'hot';

    if ((lat !== undefined && Number.isNaN(lat)) || (lng !== undefined && Number.isNaN(lng))) {
      res.status(400).json({ error: 'lat/lng must be numbers' });
      return;
    }
    if (category && !(CATEGORIES as readonly string[]).includes(category)) {
      res.status(400).json({ error: 'unknown category' });
      return;
    }
    if (districtId && !/^[0-9a-f-]{36}$/i.test(districtId)) {
      res.status(400).json({ error: 'invalid district_id' });
      return;
    }

    const conds = [inArray(reports.status, [...PUBLIC_STATUSES])];
    if (category) conds.push(eq(reports.category, category));
    if (districtId) conds.push(eq(reports.districtId, districtId));
    const where = and(...conds);

    // Hot score: engagement (corroborations×3, follows×2, shares×2, claims)
    // decayed by age, with fixed boosts: +100 community-verified, +50 at
    // stage 1 (≥2 corroborations), +200 deadline within 48h, +500 overdue.
    const hotScore = sql`
      ((${reports.corroborationCount} * 3 + ${reports.followerCount} * 2 + ${reports.shareCount} * 2
        + ${reports.actionTakenCount} + ${reports.noActionCount})
       / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(${reports.lastActivityAt}, ${reports.createdAt}))) / 3600, 0) + 2, 1.5))
      + CASE WHEN ${reports.communityVerified} THEN 100 ELSE 0 END
      + CASE WHEN ${reports.corroborationCount} >= ${STAGE1_THRESHOLD} THEN 50 ELSE 0 END
      + CASE WHEN ${reports.overdue} THEN 500 ELSE 0 END
      + CASE WHEN NOT ${reports.overdue} AND ${reports.deadlineAt} IS NOT NULL
             AND ${reports.deadlineAt} < NOW() + INTERVAL '48 hours' THEN 200 ELSE 0 END
    `;

    let rows = await db
      .select(publicReportColumns)
      .from(reports)
      .where(where)
      .orderBy(sort === 'hot' ? desc(hotScore) : desc(reports.createdAt))
      .limit(200);

    if (lat !== undefined && lng !== undefined) {
      rows = rows.filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm);
    }
    const sliced = rows.slice(0, limit);
    // Attach evidence media per report (card shows up to 3 previews + "+N").
    const mediaByReport = new Map<string, { url: string; sha256: string }[]>();
    if (sliced.length) {
      const allMedia = await db
        .select({ reportId: reportMedia.reportId, url: reportMedia.url, sha256: reportMedia.sha256 })
        .from(reportMedia)
        .where(inArray(reportMedia.reportId, sliced.map((r) => r.id)));
      for (const m of allMedia) {
        const arr = mediaByReport.get(m.reportId) ?? [];
        arr.push({ url: m.url, sha256: m.sha256 });
        mediaByReport.set(m.reportId, arr);
      }
    }
    res.json({
      reports: sliced.map((r) => ({ ...toPublicReport(r), media: mediaByReport.get(r.id) ?? [] })),
      count: sliced.length,
      sort,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/spotlight — urgent cases: overdue, deadline within 48h,
// or community-verified within the last 48h. Public. Max 10.
// NOTE: registered BEFORE /:trackingId — Express matches in order.
reportsRouter.get('/spotlight', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select(publicReportColumns)
      .from(reports)
      .where(
        and(
          inArray(reports.status, [...PUBLIC_STATUSES]),
          or(
            eq(reports.overdue, true),
            and(isNotNull(reports.deadlineAt), lt(reports.deadlineAt, sql`NOW() + INTERVAL '48 hours'`)),
            gte(reports.communityVerifiedAt, sql`NOW() - INTERVAL '48 hours'`),
          ),
        ),
      )
      .orderBy(desc(reports.overdue), desc(reports.lastActivityAt))
      .limit(10);
    const mediaByReport = new Map<string, { url: string; sha256: string }[]>();
    if (rows.length) {
      const allMedia = await db
        .select({ reportId: reportMedia.reportId, url: reportMedia.url, sha256: reportMedia.sha256 })
        .from(reportMedia)
        .where(inArray(reportMedia.reportId, rows.map((r) => r.id)));
      for (const m of allMedia) {
        const arr = mediaByReport.get(m.reportId) ?? [];
        arr.push({ url: m.url, sha256: m.sha256 });
        mediaByReport.set(m.reportId, arr);
      }
    }
    res.json({
      reports: rows.map((r) => ({ ...toPublicReport(r), media: mediaByReport.get(r.id) ?? [] })),
      count: rows.length,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/nearby-summary?lat=&lng= — 30-day verified crime history
// within 1 km of a point, counted by category. Used by the report form's map
// pin picker ("এই এলাকায় গত ৩০ দিনে ৪টি চুরি").
// NOTE: registered BEFORE /:trackingId — Express matches in order and
// "nearby-summary" would otherwise be captured as a tracking id.
reportsRouter.get('/nearby-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      req.query.lat === undefined ||
      req.query.lng === undefined ||
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: 'lat and lng query params are required and must be valid coordinates' });
      return;
    }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ category: reports.category, lat: reports.lat, lng: reports.lng })
      .from(reports)
      .where(and(eq(reports.status, 'verified'), gte(reports.occurredAt, since)))
      .limit(500);
    const nearby = rows.filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= 1);
    const byCategory: Record<string, number> = {};
    for (const r of nearby) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    res.json({
      lat,
      lng,
      radius_km: 1,
      days: 30,
      total: nearby.length,
      by_category: byCategory,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/:trackingId — public status + timeline (reporter hidden if anonymous).
// For signed-in users (Bearer token) also returns `following`: whether this
// user follows the case.
reportsRouter.get('/:trackingId', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trackingId = pathParam(req, 'trackingId');
    if (!trackingId) {
      res.status(400).json({ error: 'invalid trackingId' });
      return;
    }
    const [row] = await db
      .select(publicReportColumns)
      .from(reports)
      .where(eq(reports.trackingId, trackingId));
    if (!row) {
      res.status(404).json({ error: 'report not found' });
      return;
    }
    // v17: reporter display name (only if not anonymous; never expose reporterId).
    let reporterName: string | null = null;
    if (!row.isAnonymous) {
      const [rep] = await db
        .select({ reporterId: reports.reporterId })
        .from(reports)
        .where(eq(reports.id, row.id));
      if (rep?.reporterId) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, rep.reporterId));
        reporterName = u?.name ?? null;
      }
    }
    const media = await db
      .select({
        url: reportMedia.url,
        sha256: reportMedia.sha256,
        capturedAt: reportMedia.capturedAt,
      })
      .from(reportMedia)
      .where(eq(reportMedia.reportId, row.id));
    const history = await db
      .select({
        fromStatus: statusHistory.fromStatus,
        toStatus: statusHistory.toStatus,
        note: statusHistory.note,
        createdAt: statusHistory.createdAt,
      })
      .from(statusHistory)
      .where(eq(statusHistory.reportId, row.id))
      .orderBy(statusHistory.createdAt);
    let following = false;
    const me = req.appProfile;
    if (me) {
      const [f] = await db
        .select({ id: reportFollowers.id })
        .from(reportFollowers)
        .where(and(eq(reportFollowers.reportId, row.id), eq(reportFollowers.userId, me.id)))
        .limit(1);
      following = !!f;
    }
    // Action claims with confirm/dispute vote counts (powers ClaimVotes UI).
    const claimRows = await db
      .select({
        id: actionClaims.id,
        claim: actionClaims.claim,
        note: actionClaims.note,
        createdAt: actionClaims.createdAt,
      })
      .from(actionClaims)
      .where(eq(actionClaims.reportId, row.id))
      .orderBy(actionClaims.createdAt);
    const voteRows = claimRows.length
      ? await db
          .select({ claimId: actionClaimVotes.claimId, vote: actionClaimVotes.vote })
          .from(actionClaimVotes)
          .where(inArray(actionClaimVotes.claimId, claimRows.map((c) => c.id)))
      : [];
    const confirmsBy = new Map<string, number>();
    const disputesBy = new Map<string, number>();
    for (const v of voteRows) {
      if (v.vote === 'confirm') confirmsBy.set(v.claimId, (confirmsBy.get(v.claimId) ?? 0) + 1);
      else disputesBy.set(v.claimId, (disputesBy.get(v.claimId) ?? 0) + 1);
    }
    const claims = claimRows.map((c) => ({
      ...c,
      confirms: confirmsBy.get(c.id) ?? 0,
      disputes: disputesBy.get(c.id) ?? 0,
    }));
    res.json({ report: { ...toPublicReport(row), following, reporterName }, media, history, claims });
  } catch (e) {
    next(e);
  }
});

// POST /api/reports/:id/corroborate — "I saw this too".
// v12 STAGED VERIFICATION:
//   Stage 0: fresh submission.
//   Stage 1 (count reaches 2, STAGE1_THRESHOLD): প্রাথমিক যাচাই — first real
//     signal, recorded in status history.
//   >=3 corroborations: submitted -> verifying (review queue, unchanged).
//   Stage 2 (count reaches the category-wise community threshold): জনতা
//     যাচাইকৃত — sets communityVerified, communityVerifiedAt and starts the
//     7-day police-action deadline (deadlineAt); followers are notified.
// NEVER auto-verifies: Stage 3 (official) is always human (moderator/admin).
reportsRouter.post(
  '/:id/corroborate',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const userId = req.appProfile!.id;
      const [report] = await db.select().from(reports).where(eq(reports.id, id));
      if (!report) {
        res.status(404).json({ error: 'report not found' });
        return;
      }
      if (report.status === 'rejected' || report.status === 'resolved') {
        res.status(400).json({ error: `cannot corroborate a ${report.status} report` });
        return;
      }

      try {
        await db.insert(corroborations).values({ reportId: id, userId });
      } catch (e) {
        if (isPgUniqueViolation(e)) {
          res.status(409).json({ error: 'already corroborated by this user' });
          return;
        }
        throw e;
      }

      const newCount = report.corroborationCount + 1;
      const stageThreshold = stageThresholdFor(report.category);
      let newStatus = report.status;
      const reachedStage1 = report.corroborationCount < STAGE1_THRESHOLD && newCount >= STAGE1_THRESHOLD;
      const newlyCommunityVerified = !report.communityVerified && newCount >= stageThreshold;
      if (report.status === 'submitted' && newCount >= 3) {
        newStatus = 'verifying'; // review queue — a moderator still verifies by hand
      }
      await db
        .update(reports)
        .set({
          corroborationCount: newCount,
          status: newStatus,
          lastActivityAt: new Date(),
          ...(newlyCommunityVerified
            ? {
                communityVerified: true,
                communityVerifiedAt: new Date(),
                deadlineAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
              }
            : {}),
        })
        .where(eq(reports.id, id));
      if (reachedStage1) {
        await db.insert(statusHistory).values({
          reportId: id,
          fromStatus: newStatus,
          toStatus: newStatus,
          actorId: null,
          note: `প্রাথমিক যাচাই — ${newCount} জন ঘটনাটি নিশ্চিত করেছে (stage 1)`,
        });
        // v13: a newly verified report may form a new hotspot — alert nearby users.
        void checkHotspotAlert({ id, lat: report.lat, lng: report.lng, title: report.title });
      }
      if (newStatus !== report.status) {
        await db.insert(statusHistory).values({
          reportId: id,
          fromStatus: report.status,
          toStatus: newStatus,
          actorId: null,
          note: `Moved to review queue (${newCount} corroborations)`,
        });
      }
      if (newlyCommunityVerified) {
        await db.insert(statusHistory).values({
          reportId: id,
          fromStatus: newStatus,
          toStatus: newStatus,
          actorId: null,
          note: `জনতা যাচাইকৃত — ${newCount} জন নিশ্চিত করেছে (stage 2) — পুলিশ ব্যবস্থার জন্য ৭ দিনের ডেডলাইন শুরু`,
        });
        // Notify followers (not the corroborator) that the case reached stage 2.
        const followerRows = await db
          .select({ userId: reportFollowers.userId })
          .from(reportFollowers)
          .where(eq(reportFollowers.reportId, id));
        const followerIds = followerRows.map((r) => r.userId).filter((uid) => uid !== userId);
        if (followerIds.length > 0) {
          void sendToUserIds(followerIds, {
            title: 'জনতা যাচাইকৃত ✓',
            body: `${report.title} — জনগণ যাচাই করেছে। পুলিশ ব্যবস্থার জন্য ৭ দিনের ডেডলাইন শুরু হলো।`,
            data: { kind: 'stage', report_id: id, stage: '2', tracking_id: report.trackingId },
          });
        }
      }
      res.json({
        corroboration_count: newCount,
        status: newStatus,
        community_verified: report.communityVerified || newlyCommunityVerified,
        verification_tier: newlyCommunityVerified ? 'community' : undefined,
        verification_stage: verificationStageOf({
          status: newStatus,
          communityVerified: report.communityVerified || newlyCommunityVerified,
          corroborationCount: newCount,
          category: report.category,
        }),
        stage_threshold: stageThreshold,
      });
    } catch (e) {
      next(e);
    }
  },
);

const actionClaimSchema = z.object({
  claim: z.enum(['action_taken', 'no_action']),
  note: z.string().max(1000).optional(),
});

// POST /api/reports/:id/action-claim — citizen says whether authorities acted.
// One claim per user per report (upsert); both counters recomputed every write.
reportsRouter.post(
  '/:id/action-claim',
  requireAuth,
  requireProfile,
  validateBody(actionClaimSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const { claim, note } = req.body as z.infer<typeof actionClaimSchema>;
      const userId = req.appProfile!.id;
      const [report] = await db.select().from(reports).where(eq(reports.id, id));
      if (!report) {
        res.status(404).json({ error: 'report not found' });
        return;
      }
      if (report.status === 'rejected') {
        res.status(400).json({ error: 'cannot claim action on a rejected report' });
        return;
      }

      await db
        .insert(actionClaims)
        .values({ reportId: id, userId, claim, note: note ?? null })
        .onConflictDoUpdate({
          target: [actionClaims.reportId, actionClaims.userId],
          set: { claim, note: note ?? null, createdAt: new Date() },
        });

      const claims = await db
        .select({ claim: actionClaims.claim })
        .from(actionClaims)
        .where(eq(actionClaims.reportId, id));
      const actionTakenCount = claims.filter((c) => c.claim === 'action_taken').length;
      const noActionCount = claims.length - actionTakenCount;
      await db
        .update(reports)
        .set({ actionTakenCount, noActionCount })
        .where(eq(reports.id, id));

      res.json({ report_id: id, action_taken_count: actionTakenCount, no_action_count: noActionCount });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/reports/:id/follow — follow a case (push on stage/deadline updates).
// 409 if already following.
reportsRouter.post(
  '/:id/follow',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const userId = req.appProfile!.id;
      const [report] = await db.select({ id: reports.id }).from(reports).where(eq(reports.id, id));
      if (!report) {
        res.status(404).json({ error: 'report not found' });
        return;
      }
      try {
        await db.insert(reportFollowers).values({ reportId: id, userId });
      } catch (e) {
        if (isPgUniqueViolation(e)) {
          res.status(409).json({ error: 'already following this case' });
          return;
        }
        throw e;
      }
      const [updated] = await db
        .update(reports)
        .set({
          followerCount: sql`${reports.followerCount} + 1`,
          lastActivityAt: new Date(),
        })
        .where(eq(reports.id, id))
        .returning({ followerCount: reports.followerCount });
      res.status(201).json({ following: true, follower_count: updated?.followerCount ?? 0 });
    } catch (e) {
      next(e);
    }
  },
);

// DELETE /api/reports/:id/follow — unfollow a case.
reportsRouter.delete(
  '/:id/follow',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const userId = req.appProfile!.id;
      const [report] = await db.select({ id: reports.id }).from(reports).where(eq(reports.id, id));
      if (!report) {
        res.status(404).json({ error: 'report not found' });
        return;
      }
      const deleted = await db
        .delete(reportFollowers)
        .where(and(eq(reportFollowers.reportId, id), eq(reportFollowers.userId, userId)))
        .returning({ id: reportFollowers.id });
      if (deleted.length === 0) {
        res.status(404).json({ error: 'not following this case' });
        return;
      }
      const [updated] = await db
        .update(reports)
        .set({
          followerCount: sql`GREATEST(${reports.followerCount} - 1, 0)`,
          lastActivityAt: new Date(),
        })
        .where(eq(reports.id, id))
        .returning({ followerCount: reports.followerCount });
      res.json({ following: false, follower_count: updated?.followerCount ?? 0 });
    } catch (e) {
      next(e);
    }
  },
);

const claimVoteSchema = z.object({
  vote: z.enum(['confirm', 'dispute']),
});

// POST /api/reports/:id/claims/:claimId/vote — vote "confirm"/"dispute" on a
// police-action claim. One vote per user per claim (upsert). If disputes >= 5
// AND disputes > confirms, the report is flagged disputed_claim (the thana
// scorecard then subtracts 15 points).
reportsRouter.post(
  '/:id/claims/:claimId/vote',
  requireAuth,
  requireProfile,
  validateBody(claimVoteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const claimId = uuidParam(req, res, 'claimId');
      if (!claimId) return;
      const userId = req.appProfile!.id;
      const { vote } = req.body as z.infer<typeof claimVoteSchema>;

      const [claim] = await db
        .select({ id: actionClaims.id, reportId: actionClaims.reportId })
        .from(actionClaims)
        .where(eq(actionClaims.id, claimId));
      if (!claim || claim.reportId !== id) {
        res.status(404).json({ error: 'claim not found for this report' });
        return;
      }

      await db
        .insert(actionClaimVotes)
        .values({ claimId, userId, vote })
        .onConflictDoUpdate({
          target: [actionClaimVotes.claimId, actionClaimVotes.userId],
          set: { vote, createdAt: new Date() },
        });

      const votes = await db
        .select({ vote: actionClaimVotes.vote })
        .from(actionClaimVotes)
        .innerJoin(actionClaims, eq(actionClaimVotes.claimId, actionClaims.id))
        .where(eq(actionClaims.reportId, id));
      const confirms = votes.filter((v) => v.vote === 'confirm').length;
      const disputes = votes.length - confirms;
      const disputed = disputes >= 5 && disputes > confirms;

      await db
        .update(reports)
        .set({ disputedClaim: disputed, lastActivityAt: new Date() })
        .where(eq(reports.id, id));

      res.json({ confirms, disputes, disputed_claim: disputed });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/reports/:id/share — record a share (public; powers the hot feed).
reportsRouter.post('/:id/share', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [report] = await db.select({ id: reports.id }).from(reports).where(eq(reports.id, id));
    if (!report) {
      res.status(404).json({ error: 'report not found' });
      return;
    }
    const [updated] = await db
      .update(reports)
      .set({ shareCount: sql`${reports.shareCount} + 1`, lastActivityAt: new Date() })
      .where(eq(reports.id, id))
      .returning({ shareCount: reports.shareCount });
    res.json({ share_count: updated?.shareCount ?? 0 });
  } catch (e) {
    next(e);
  }
});

// POST /api/reports/:id/view — public view counter (frontend dedups per session).
reportsRouter.post('/:id/view', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [updated] = await db
      .update(reports)
      .set({ viewCount: sql`${reports.viewCount} + 1` })
      .where(eq(reports.id, id))
      .returning({ viewCount: reports.viewCount });
    if (!updated) {
      res.status(404).json({ error: 'report not found' });
      return;
    }
    res.json({ view_count: updated.viewCount });
  } catch (e) {
    next(e);
  }
});
