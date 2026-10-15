import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, isNotNull, count } from 'drizzle-orm';
import { db } from '../db.js';
import { validateBody, uuidParam } from '../validate.js';
import { haversineKm } from '../lib/geo.js';
import { sosAlerts, users, volunteerTeams, teamMembers, thanas } from 'db';

export const sosRouter = Router();

const createSosSchema = z.object({
  user_id: z.string().uuid(),
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
  validateBody(createSosSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as z.infer<typeof createSosSchema>;
      const [reporter] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, b.user_id));
      if (!reporter) {
        res.status(404).json({ error: 'user not found' });
        return;
      }

      // Keep the reporter's last known position fresh for future targeting.
      await db
        .update(users)
        .set({ lastLat: b.lat, lastLng: b.lng })
        .where(eq(users.id, b.user_id));

      const [alert] = await db
        .insert(sosAlerts)
        .values({
          userId: b.user_id,
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
            u.id !== b.user_id &&
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
          lastLat: users.lastLat,
          lastLng: users.lastLng,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(and(isNotNull(users.lastLat), isNotNull(users.lastLng)));
      for (const m of memberPositions) {
        if (
          m.lastLat !== null &&
          m.lastLng !== null &&
          haversineKm(b.lat, b.lng, m.lastLat, m.lastLng) <= 10
        ) {
          teamIds.add(m.teamId);
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
  user_id: z.string().uuid(),
});

// PATCH /api/sos/:id — resolve/cancel. Only the reporter may do this.
sosRouter.patch(
  '/:id',
  validateBody(updateSosSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const { status, user_id } = req.body as z.infer<typeof updateSosSchema>;
      const [alert] = await db.select().from(sosAlerts).where(eq(sosAlerts.id, id));
      if (!alert) {
        res.status(404).json({ error: 'sos not found' });
        return;
      }
      if (alert.userId !== user_id) {
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

// GET /api/sos/active?lat=&lng=&radius_km=5 — active SOS alerts in the area
// (powers the alert feed). Reporter name is included so rescuers know who
// needs help; no phone numbers are exposed.
sosRouter.get('/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Number(req.query.radius_km) || 5;
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'lat and lng are required numbers' });
      return;
    }
    const rows = await db
      .select({
        id: sosAlerts.id,
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
    const inArea = rows
      .filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm)
      .map((r) => ({
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        address_text: r.addressText,
        message: r.message,
        reporter_name: r.reporterName,
        created_at: r.createdAt,
        distance_km: Math.round(haversineKm(lat, lng, r.lat, r.lng) * 10) / 10,
      }));
    res.json({ sos: inArea, count: inArea.length });
  } catch (e) {
    next(e);
  }
});
