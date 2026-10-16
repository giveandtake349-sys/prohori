import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, isNotNull, count, gte, lt, inArray, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody, uuidParam } from '../validate.js';
import { haversineKm } from '../lib/geo.js';
import { sendToUserIds } from '../lib/notify.js';
import { sosAlerts, sosResponses, users, volunteerTeams, teamMembers, thanas } from 'db';

export const sosRouter = Router();

// SOS alerts older than this are treated as expired (lazy-marked on read).
const SOS_TTL_MS = 30 * 60 * 1000;
// Max SOS broadcasts per user per rolling hour (abuse protection).
const SOS_MAX_PER_HOUR = 3;

async function expireStaleSos(): Promise<void> {
  await db
    .update(sosAlerts)
    .set({ status: 'expired' })
    .where(
      and(eq(sosAlerts.status, 'active'), lt(sosAlerts.createdAt, new Date(Date.now() - SOS_TTL_MS))),
    );
}

const createSosSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address_text: z.string().max(300).optional(),
  message: z.string().max(500).optional(),
});

// POST /api/sos — emergency broadcast.
//
// Recipient rules (documented, MVP-simple):
//  (a) users whose last known position (last_lat/last_lng) is within 5 km
//      of the SOS point, excluding the reporter;
//  (b) volunteer teams: teams attached to the NEAREST thana to the SOS
//      point, plus any team with at least one member within 10 km.
//
// TODO (Phase 2): hook FCM push + SMS fan-out here. The recipient lists
// below are computed and returned, but no delivery is attempted yet.
sosRouter.post(
  '/',
  requireAuth,
  requireProfile,
  validateBody(createSosSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as z.infer<typeof createSosSchema>;
      const [reporter] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, req.appProfile!.id));
      if (!reporter) {
        res.status(404).json({ error: 'user not found' });
        return;
      }

      // Rate limit: max SOS_MAX_PER_HOUR broadcasts per rolling hour.
      const [{ n: recentCount }] = await db
        .select({ n: count() })
        .from(sosAlerts)
        .where(
          and(
            eq(sosAlerts.userId, req.appProfile!.id),
            gte(sosAlerts.createdAt, new Date(Date.now() - 3600_000)),
          ),
        );
      if (recentCount >= SOS_MAX_PER_HOUR) {
        res.status(429).json({
          error: 'গত এক ঘণ্টায় আপনি ৩টি SOS পাঠিয়েছেন। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
        });
        return;
      }

      // Keep the reporter's last known position fresh for future targeting.
      await db
        .update(users)
        .set({ lastLat: b.lat, lastLng: b.lng })
        .where(eq(users.id, req.appProfile!.id));

      const [alert] = await db
        .insert(sosAlerts)
        .values({
          userId: req.appProfile!.id,
          lat: b.lat,
          lng: b.lng,
          addressText: b.address_text ?? null,
          message: b.message ?? null,
          status: 'active',
        })
        .returning();

      // (a) Nearby users within 5 km (reporter excluded).
      const candidates = await db
        .select({ id: users.id, lastLat: users.lastLat, lastLng: users.lastLng })
        .from(users)
        .where(and(isNotNull(users.lastLat), isNotNull(users.lastLng)));
      const nearbyUserIds = candidates
        .filter(
          (u) =>
            u.id !== req.appProfile!.id &&
            u.lastLat !== null &&
            u.lastLng !== null &&
            haversineKm(b.lat, b.lng, u.lastLat, u.lastLng) <= 5,
        )
        .map((u) => u.id);

      // (b) Teams: nearest-thana teams + teams with a member within 10 km.
      const allThanas = await db.select().from(thanas);
      let nearestThanaId: string | null = null;
      let nearestDist = Infinity;
      for (const t of allThanas) {
        const d = haversineKm(b.lat, b.lng, t.lat, t.lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestThanaId = t.id;
        }
      }
      const teamIds = new Set<string>();
      if (nearestThanaId) {
        const thanaTeams = await db
          .select({ id: volunteerTeams.id })
          .from(volunteerTeams)
          .where(eq(volunteerTeams.thanaId, nearestThanaId));
        thanaTeams.forEach((t) => teamIds.add(t.id));
      }
      const memberPositions = await db
        .select({
          teamId: teamMembers.teamId,
          userId: teamMembers.userId,
          lastLat: users.lastLat,
          lastLng: users.lastLng,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(and(isNotNull(users.lastLat), isNotNull(users.lastLng)));
      const nearbyMemberUserIds = new Set<string>();
      for (const m of memberPositions) {
        if (
          m.lastLat !== null &&
          m.lastLng !== null &&
          haversineKm(b.lat, b.lng, m.lastLat, m.lastLng) <= 10
        ) {
          teamIds.add(m.teamId);
          if (m.userId !== req.appProfile!.id) nearbyMemberUserIds.add(m.userId);
        }
      }

      const notifiedTeams = [];
      for (const teamId of teamIds) {
        const [t] = await db
          .select({ id: volunteerTeams.id, name: volunteerTeams.name })
          .from(volunteerTeams)
          .where(eq(volunteerTeams.id, teamId));
        if (!t) continue;
        const [{ n }] = await db
          .select({ n: count() })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, teamId));
        notifiedTeams.push({ id: t.id, name: t.name, member_count: n });
      }

      // TODO (Phase 2): fan out via FCM + SMS to nearbyUserIds and
      // notifiedTeams[*].members here. Currently computed, not delivered.

      // FCM push fan-out (best-effort, fire-and-forget — never blocks SOS).
      // Recipients: nearby users (5 km) + volunteer-team members (10 km).
      const pushTargets = [...new Set([...nearbyUserIds, ...nearbyMemberUserIds])];
      if (pushTargets.length > 0) {
        void sendToUserIds(pushTargets, {
          title: '🆘 SOS — কাছেই কেউ বিপদে!',
          body: b.message?.trim() || `${b.address_text ?? 'আপনার এলাকায়'} সাহায্যের আবেদন`,
          data: { kind: 'sos', sos_id: alert.id },
        });
      }

      res.status(201).json({
        sos_id: alert.id,
        status: alert.status,
        notified_user_count: nearbyUserIds.length,
        notified_teams: notifiedTeams,
      });
    } catch (e) {
      next(e);
    }
  },
);

const updateSosSchema = z.object({
  status: z.enum(['resolved', 'cancelled']),
});

// PATCH /api/sos/:id — resolve/cancel. Only the reporter may do this.
sosRouter.patch(
  '/:id',
  requireAuth,
  requireProfile,
  validateBody(updateSosSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const { status } = req.body as z.infer<typeof updateSosSchema>;
      const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, id));
      if (!alert) {
        res.status(404).json({ error: 'sos not found' });
        return;
      }
      if (alert.userId !== req.appProfile!.id) {
        res.status(403).json({ error: 'only the reporter can update this SOS' });
        return;
      }
      const [updated] = await db
        .update(sosAlerts)
        .set({ status })
        .where(eq(sosAlerts.id, id))
        .returning({ id: sosAlerts.id, status: sosAlerts.status });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/sos/:id/respond — a volunteer responds to an active SOS.
// One response per user per SOS. Notifies the reporter via push.
sosRouter.post(
  '/:id/respond',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      await expireStaleSos();
      const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, id));
      if (!alert) {
        res.status(404).json({ error: 'SOS পাওয়া যায়নি।' });
        return;
      }
      if (alert.status !== 'active') {
        res.status(410).json({ error: 'এই SOS আর সক্রিয় নেই।' });
        return;
      }
      const me = req.appProfile!.id;
      const existing = await db
        .select({ id: sosResponses.id })
        .from(sosResponses)
        .where(and(eq(sosResponses.sosId, id), eq(sosResponses.userId, me)));
      if (existing.length > 0) {
        res.status(409).json({ error: 'আপনি ইতিমধ্যে respond করেছেন।' });
        return;
      }
      await db.insert(sosResponses).values({ sosId: id, userId: me });
      const [{ n }] = await db
        .select({ n: count() })
        .from(sosResponses)
        .where(eq(sosResponses.sosId, id));
      // Notify the reporter (fire-and-forget).
      if (alert.userId !== me) {
        void sendToUserIds([alert.userId], {
          title: `✅ ${req.appProfile!.name} আসছে!`,
          body: 'আপনার SOS-এ একজন volunteer respond করেছে।',
          data: { kind: 'sos_respond', sos_id: id },
        });
      }
      res.status(201).json({ ok: true, responders: n });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/sos/mine — the signed-in user's currently active SOS (with responders).
sosRouter.get('/mine', requireAuth, requireProfile, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await expireStaleSos();
    const [alert] = await db
      .select()
      .from(sosAlerts)
      .where(and(eq(sosAlerts.userId, req.appProfile!.id), eq(sosAlerts.status, 'active')))
      .orderBy(desc(sosAlerts.createdAt))
      .limit(1);
    if (!alert) {
      res.json({ sos: null });
      return;
    }
    const responders = await db
      .select({ name: users.name, createdAt: sosResponses.createdAt })
      .from(sosResponses)
      .innerJoin(users, eq(sosResponses.userId, users.id))
      .where(eq(sosResponses.sosId, alert.id))
      .orderBy(sosResponses.createdAt);
    res.json({
      sos: {
        id: alert.id,
        lat: alert.lat,
        lng: alert.lng,
        address_text: alert.addressText,
        message: alert.message,
        created_at: alert.createdAt,
        responders,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/sos/active?lat=&lng=&radius_km=5 — active SOS alerts in the area
// (powers the alert feed). Reporter name is included so rescuers know who
// needs help; no phone numbers are exposed. Alerts older than 30 min are
// lazily expired and excluded. Responder names are included per alert.
sosRouter.get('/active', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Number(req.query.radius_km) || 5;
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'lat and lng are required numbers' });
      return;
    }
    await expireStaleSos();
    const rows = await db
      .select({
        id: sosAlerts.id,
        userId: sosAlerts.userId,
        lat: sosAlerts.lat,
        lng: sosAlerts.lng,
        addressText: sosAlerts.addressText,
        message: sosAlerts.message,
        status: sosAlerts.status,
        createdAt: sosAlerts.createdAt,
        reporterName: users.name,
      })
      .from(sosAlerts)
      .innerJoin(users, eq(sosAlerts.userId, users.id))
      .where(eq(sosAlerts.status, 'active'));
    const inArea = rows.filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm);
    // Batch-load responders for all returned alerts (one query).
    const responderMap = new Map<string, Array<{ name: string; created_at: Date }>>();
    if (inArea.length > 0) {
      const respRows = await db
        .select({ sosId: sosResponses.sosId, name: users.name, createdAt: sosResponses.createdAt })
        .from(sosResponses)
        .innerJoin(users, eq(sosResponses.userId, users.id))
        .where(
          inArray(
            sosResponses.sosId,
            inArea.map((r) => r.id),
          ),
        );
      for (const rr of respRows) {
        const list = responderMap.get(rr.sosId) ?? [];
        list.push({ name: rr.name, created_at: rr.createdAt });
        responderMap.set(rr.sosId, list);
      }
    }
    const me = req.authIdentity?.id ?? null;
    // Which of these did I already respond to? (one extra query, batched)
    let myResponded = new Set<string>();
    if (me && inArea.length > 0) {
      const mine = await db
        .select({ sosId: sosResponses.sosId })
        .from(sosResponses)
        .where(
          and(
            eq(sosResponses.userId, me),
            inArray(
              sosResponses.sosId,
              inArea.map((r) => r.id),
            ),
          ),
        );
      myResponded = new Set(mine.map((r) => r.sosId));
    }
    const result = inArea.map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      address_text: r.addressText,
      message: r.message,
      reporter_name: r.reporterName,
      created_at: r.createdAt,
      distance_km: Math.round(haversineKm(lat, lng, r.lat, r.lng) * 10) / 10,
      responders: responderMap.get(r.id) ?? [],
      i_responded: myResponded.has(r.id),
      mine: me === r.userId,
    }));
    res.json({ sos: result, count: result.length });
  } catch (e) {
    next(e);
  }
});
