import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody, isPgUniqueViolation, pathParam, uuidParam } from '../validate.js';
import { generateTrackingId } from '../lib/tracking.js';
import { haversineKm } from '../lib/geo.js';
import { publicReportColumns, PUBLIC_STATUSES, CATEGORIES } from '../lib/public.js';
import { reports, reportMedia, corroborations, actionClaims, statusHistory, districts } from 'db';

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
reportsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const radiusKm = req.query.radius_km !== undefined ? Number(req.query.radius_km) : 50;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const districtId = typeof req.query.district_id === 'string' ? req.query.district_id : undefined;
    const limit = Math.min(Number(req.query.limit) || 30, 100);

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

    let rows = await db
      .select(publicReportColumns)
      .from(reports)
      .where(where)
      .orderBy(desc(reports.createdAt))
      .limit(200);

    if (lat !== undefined && lng !== undefined) {
      rows = rows.filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm);
    }
    res.json({ reports: rows.slice(0, limit), count: Math.min(rows.length, limit) });
  } catch (e) {
    next(e);
  }
});

// GET /api/reports/:trackingId — public status + timeline (reporter hidden if anonymous)
reportsRouter.get('/:trackingId', async (req: Request, res: Response, next: NextFunction) => {
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
    res.json({ report: row, media, history });
  } catch (e) {
    next(e);
  }
});

// POST /api/reports/:id/corroborate — "I saw this too".
// >=3 corroborations move submitted -> verifying (review queue).
// NEVER auto-verifies: final verification is always human (moderator/admin).
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
      let newStatus = report.status;
      if (report.status === 'submitted' && newCount >= 3) {
        newStatus = 'verifying'; // review queue — a moderator still verifies by hand
      }
      await db.update(reports).set({ corroborationCount: newCount, status: newStatus }).where(eq(reports.id, id));
      if (newStatus !== report.status) {
        await db.insert(statusHistory).values({
          reportId: id,
          fromStatus: report.status,
          toStatus: newStatus,
          actorId: null,
          note: `Moved to review queue (${newCount} corroborations)`,
        });
      }
      res.json({ corroboration_count: newCount, status: newStatus });
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
