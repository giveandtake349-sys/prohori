import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, count } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody, isPgUniqueViolation, uuidParam } from '../validate.js';
import { haversineKm } from '../lib/geo.js';
import { volunteerTeams, teamMembers, users, thanas, districts } from 'db';

export const teamsRouter = Router();

const createTeamSchema = z.object({
  name: z.string().min(3).max(120),
  district_id: z.string().uuid().nullable().optional(),
  thana_id: z.string().uuid().nullable().optional(),
  area_text: z.string().max(300).nullable().optional(),
  // Lead's emergency contact number; defaults to their account phone.
  emergency_phone: z.string().min(6).max(20).optional(),
});

// POST /api/teams — create a "Pashe Achi" team; creator becomes the lead.
teamsRouter.post(
  '/',
  requireAuth,
  requireProfile,
  validateBody(createTeamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as z.infer<typeof createTeamSchema>;
      const [creator] = await db
        .select({ id: users.id, phone: users.phone })
        .from(users)
        .where(eq(users.id, req.appProfile!.id));
      if (b.district_id) {
        const [d] = await db.select({ id: districts.id }).from(districts).where(eq(districts.id, b.district_id));
        if (!d) {
          res.status(404).json({ error: 'district not found' });
          return;
        }
      }
      if (b.thana_id) {
        const [t] = await db.select({ id: thanas.id }).from(thanas).where(eq(thanas.id, b.thana_id));
        if (!t) {
          res.status(404).json({ error: 'thana not found' });
          return;
        }
      }
      const [team] = await db
        .insert(volunteerTeams)
        .values({
          name: b.name,
          districtId: b.district_id ?? null,
          thanaId: b.thana_id ?? null,
          areaText: b.area_text ?? null,
          createdBy: req.appProfile!.id,
        })
        .returning();
      await db.insert(teamMembers).values({
        teamId: team.id,
        userId: req.appProfile!.id,
        role: 'lead',
        emergencyPhone: b.emergency_phone ?? creator.phone,
      });
      res.status(201).json({
        team: {
          id: team.id,
          name: team.name,
          district_id: team.districtId,
          thana_id: team.thanaId,
          area_text: team.areaText,
        },
        lead_user_id: req.appProfile!.id,
      });
    } catch (e) {
      next(e);
    }
  },
);

const joinTeamSchema = z.object({
  emergency_phone: z.string().min(6).max(20),
});

// POST /api/teams/:id/join — join a team as a member.
teamsRouter.post(
  '/:id/join',
  requireAuth,
  requireProfile,
  validateBody(joinTeamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const { emergency_phone } = req.body as z.infer<typeof joinTeamSchema>;
      const [team] = await db.select({ id: volunteerTeams.id }).from(volunteerTeams).where(eq(volunteerTeams.id, id));
      if (!team) {
        res.status(404).json({ error: 'team not found' });
        return;
      }
      try {
        await db.insert(teamMembers).values({
          teamId: id,
          userId: req.appProfile!.id,
          role: 'member',
          emergencyPhone: emergency_phone,
        });
      } catch (e) {
        if (isPgUniqueViolation(e)) {
          res.status(409).json({ error: 'already a member of this team' });
          return;
        }
        throw e;
      }
      res.status(201).json({ team_id: id, user_id: req.appProfile!.id, role: 'member' });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/teams?district_id=&thana_id=&lat=&lng=&radius_km= — list teams,
// optionally nearby. NOTE: team position is approximated from its thana
// (falling back to its district centroid) — documented approximation.
// Phase 2 could store an exact team lat/lng.
teamsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const districtId = typeof req.query.district_id === 'string' ? req.query.district_id : undefined;
    const thanaId = typeof req.query.thana_id === 'string' ? req.query.thana_id : undefined;
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const radiusKm = Number(req.query.radius_km) || 50;
    if ((lat !== undefined && Number.isNaN(lat)) || (lng !== undefined && Number.isNaN(lng))) {
      res.status(400).json({ error: 'lat/lng must be numbers' });
      return;
    }

    const conds = [];
    if (districtId) conds.push(eq(volunteerTeams.districtId, districtId));
    if (thanaId) conds.push(eq(volunteerTeams.thanaId, thanaId));

    const rows = await db
      .select({
        id: volunteerTeams.id,
        name: volunteerTeams.name,
        districtId: volunteerTeams.districtId,
        thanaId: volunteerTeams.thanaId,
        areaText: volunteerTeams.areaText,
        createdAt: volunteerTeams.createdAt,
        thanaLat: thanas.lat,
        thanaLng: thanas.lng,
        distLat: districts.lat,
        distLng: districts.lng,
      })
      .from(volunteerTeams)
      .leftJoin(thanas, eq(volunteerTeams.thanaId, thanas.id))
      .leftJoin(districts, eq(volunteerTeams.districtId, districts.id))
      .where(conds.length ? and(...conds) : undefined);

    const teams = [];
    for (const r of rows) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, r.id));
      // Proxy position: thana first, then district centroid.
      const pLat = r.thanaLat ?? r.distLat ?? null;
      const pLng = r.thanaLng ?? r.distLng ?? null;
      let distanceKm: number | null = null;
      if (lat !== undefined && lng !== undefined && pLat !== null && pLng !== null) {
        distanceKm = haversineKm(lat, lng, pLat, pLng);
        if (distanceKm > radiusKm) continue;
      }
      teams.push({
        id: r.id,
        name: r.name,
        district_id: r.districtId,
        thana_id: r.thanaId,
        area_text: r.areaText,
        member_count: n,
        distance_km: distanceKm !== null ? Math.round(distanceKm * 10) / 10 : null,
        created_at: r.createdAt,
      });
    }
    teams.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
    res.json({ teams, count: teams.length });
  } catch (e) {
    next(e);
  }
});

// Shared member listing: name + role + emergency phone only (leads first).
// The users.phone account number is NEVER exposed here.
async function listMembers(teamId: string) {
  const rows = await db
    .select({
      userId: teamMembers.userId,
      name: users.name,
      role: teamMembers.role,
      emergencyPhone: teamMembers.emergencyPhone,
      joinedAt: teamMembers.joinedAt,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));
  rows.sort((a, b) => {
    if (a.role === 'lead' && b.role !== 'lead') return -1;
    if (b.role === 'lead' && a.role !== 'lead') return 1;
    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  });
  return rows.map((r) => ({
    user_id: r.userId,
    name: r.name,
    role: r.role,
    emergency_phone: r.emergencyPhone,
    joined_at: r.joinedAt,
  }));
}

// GET /api/teams/:id/members — team roster (emergency phones included).
teamsRouter.get('/:id/members', requireAuth, requireProfile, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [team] = await db.select({ id: volunteerTeams.id }).from(volunteerTeams).where(eq(volunteerTeams.id, id));
    if (!team) {
      res.status(404).json({ error: 'team not found' });
      return;
    }
    const [membership] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userId, req.appProfile!.id)));
    if (!membership) {
      res.status(403).json({ error: 'only team members can view emergency contact numbers' });
      return;
    }
    res.json({ members: await listMembers(id) });
  } catch (e) {
    next(e);
  }
});

// GET /api/teams/:id/emergency-contacts — 999 + member emergency numbers.
// Shown on the big red call screen during an emergency.
teamsRouter.get('/:id/emergency-contacts', requireAuth, requireProfile, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [team] = await db
      .select({ id: volunteerTeams.id, name: volunteerTeams.name })
      .from(volunteerTeams)
      .where(eq(volunteerTeams.id, id));
    if (!team) {
      res.status(404).json({ error: 'team not found' });
      return;
    }
    const [membership] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userId, req.appProfile!.id)));
    if (!membership) {
      res.status(403).json({ error: 'only team members can view emergency contact numbers' });
      return;
    }
    res.json({
      team_id: team.id,
      team_name: team.name,
      nine_one_one: '999',
      members: await listMembers(id),
    });
  } catch (e) {
    next(e);
  }
});
