import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, count, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody, isPgUniqueViolation, uuidParam } from '../validate.js';
import { haversineKm } from '../lib/geo.js';
import { volunteerTeams, teamMembers, users, thanas, districts } from 'db';

export const teamsRouter = Router();

export const TEAM_TYPES = [
  'general',
  'medical',
  'blood',
  'women_child',
  'disaster',
  'night_patrol',
  'road',
] as const;

const createTeamSchema = z.object({
  name: z.string().min(3).max(120),
  district_id: z.string().uuid(),
  thana_id: z.string().uuid(),
  elaka_text: z.string().min(2).max(200),
  goli_text: z.string().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  description: z.string().max(1000).nullable().optional(),
  team_type: z.enum(TEAM_TYPES),
  // Lead's emergency contact number for this team.
  emergency_phone: z.string().min(6).max(20),
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
      const [d] = await db.select({ id: districts.id }).from(districts).where(eq(districts.id, b.district_id));
      if (!d) {
        res.status(404).json({ error: 'district not found' });
        return;
      }
      const [t] = await db.select({ id: thanas.id }).from(thanas).where(eq(thanas.id, b.thana_id));
      if (!t) {
        res.status(404).json({ error: 'thana not found' });
        return;
      }
      const [team] = await db
        .insert(volunteerTeams)
        .values({
          name: b.name.trim(),
          districtId: b.district_id,
          thanaId: b.thana_id,
          areaText: b.elaka_text.trim(),
          elakaText: b.elaka_text.trim(),
          goliText: b.goli_text?.trim() || null,
          lat: b.lat,
          lng: b.lng,
          description: b.description?.trim() || null,
          teamType: b.team_type,
          isActive: true,
          createdBy: req.appProfile!.id,
        })
        .returning();
      await db.insert(teamMembers).values({
        teamId: team.id,
        userId: req.appProfile!.id,
        role: 'lead',
        emergencyPhone: b.emergency_phone.trim(),
      });
      res.status(201).json({
        team: {
          id: team.id,
          name: team.name,
          district_id: team.districtId,
          thana_id: team.thanaId,
          elaka_text: team.elakaText,
          goli_text: team.goliText,
          lat: team.lat,
          lng: team.lng,
          team_type: team.teamType,
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

// POST /api/teams/:id/join — join a team as a member (open join, one tap).
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
      const [team] = await db
        .select({ id: volunteerTeams.id, isActive: volunteerTeams.isActive })
        .from(volunteerTeams)
        .where(eq(volunteerTeams.id, id));
      if (!team) {
        res.status(404).json({ error: 'team not found' });
        return;
      }
      if (!team.isActive) {
        res.status(410).json({ error: 'team is no longer active' });
        return;
      }
      try {
        await db.insert(teamMembers).values({
          teamId: id,
          userId: req.appProfile!.id,
          role: 'member',
          emergencyPhone: emergency_phone.trim(),
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

// DELETE /api/teams/:id/leave — leave a team (members only; lead must deactivate instead).
teamsRouter.delete(
  '/:id/leave',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const [membership] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userId, req.appProfile!.id)));
      if (!membership) {
        res.status(404).json({ error: 'not a member of this team' });
        return;
      }
      if (membership.role === 'lead') {
        res.status(400).json({ error: 'team lead cannot leave; deactivate the team instead' });
        return;
      }
      await db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userId, req.appProfile!.id)));
      res.json({ left: true });
    } catch (e) {
      next(e);
    }
  },
);

// DELETE /api/teams/:id/members/:userId — lead-only member removal.
teamsRouter.delete(
  '/:id/members/:userId',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const targetUserId = uuidParam(req, res, 'userId');
      if (!targetUserId) return;
      const [leadership] = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, id),
            eq(teamMembers.userId, req.appProfile!.id),
            eq(teamMembers.role, 'lead'),
          ),
        );
      if (!leadership) {
        res.status(403).json({ error: 'only the team lead can remove members' });
        return;
      }
      if (targetUserId === req.appProfile!.id) {
        res.status(400).json({ error: 'lead cannot remove themselves' });
        return;
      }
      await db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, id), eq(teamMembers.userId, targetUserId)));
      res.json({ removed: true });
    } catch (e) {
      next(e);
    }
  },
);

interface TeamRow {
  id: string;
  name: string;
  districtId: string | null;
  thanaId: string | null;
  areaText: string | null;
  elakaText: string | null;
  goliText: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  teamType: string;
  isActive: boolean;
  createdAt: Date;
}

function toTeamJson(r: TeamRow, memberCount: number, distanceKm: number | null) {
  return {
    id: r.id,
    name: r.name,
    district_id: r.districtId,
    thana_id: r.thanaId,
    area_text: r.areaText ?? r.elakaText,
    elaka_text: r.elakaText,
    goli_text: r.goliText,
    lat: r.lat,
    lng: r.lng,
    description: r.description,
    team_type: r.teamType,
    is_active: r.isActive,
    member_count: memberCount,
    distance_km: distanceKm !== null ? Math.round(distanceKm * 10) / 10 : null,
    created_at: r.createdAt,
  };
}

async function memberCount(teamId: string): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
  return n;
}

// GET /api/teams/nearby?lat=&lng=&radius_km=8&type= — teams with exact
// lat/lng within radius, sorted by distance. Falls back to thana centroid
// for legacy teams without coordinates. NOTE: declared BEFORE /:id.
teamsRouter.get('/nearby', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Number(req.query.radius_km) || 8;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'lat and lng are required numbers' });
      return;
    }
    if (type && !(TEAM_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: 'invalid team type' });
      return;
    }
    const conds = [eq(volunteerTeams.isActive, true)];
    if (type) conds.push(eq(volunteerTeams.teamType, type));
    const rows = await db
      .select({
        id: volunteerTeams.id,
        name: volunteerTeams.name,
        districtId: volunteerTeams.districtId,
        thanaId: volunteerTeams.thanaId,
        areaText: volunteerTeams.areaText,
        elakaText: volunteerTeams.elakaText,
        goliText: volunteerTeams.goliText,
        lat: volunteerTeams.lat,
        lng: volunteerTeams.lng,
        description: volunteerTeams.description,
        teamType: volunteerTeams.teamType,
        isActive: volunteerTeams.isActive,
        createdAt: volunteerTeams.createdAt,
        thanaLat: thanas.lat,
        thanaLng: thanas.lng,
      })
      .from(volunteerTeams)
      .leftJoin(thanas, eq(volunteerTeams.thanaId, thanas.id))
      .where(and(...conds));

    const teams = [];
    for (const r of rows) {
      // Exact pin first; legacy teams fall back to thana centroid.
      const pLat = r.lat ?? r.thanaLat ?? null;
      const pLng = r.lng ?? r.thanaLng ?? null;
      if (pLat === null || pLng === null) continue;
      const d = haversineKm(lat, lng, pLat, pLng);
      if (d > radiusKm) continue;
      teams.push(toTeamJson(r, await memberCount(r.id), d));
    }
    teams.sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
    res.json({ teams, count: teams.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/teams?type=&search=&district_id=&thana_id=&limit= — all teams
// with optional filters. search matches name + elaka (case-insensitive).
teamsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const districtId = typeof req.query.district_id === 'string' ? req.query.district_id : undefined;
    const thanaId = typeof req.query.thana_id === 'string' ? req.query.thana_id : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    if (type && !(TEAM_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: 'invalid team type' });
      return;
    }
    const conds = [eq(volunteerTeams.isActive, true)];
    if (type) conds.push(eq(volunteerTeams.teamType, type));
    if (districtId) conds.push(eq(volunteerTeams.districtId, districtId));
    if (thanaId) conds.push(eq(volunteerTeams.thanaId, thanaId));
    if (search) {
      const like = `%${search}%`;
      conds.push(
        or(
          ilike(volunteerTeams.name, like),
          ilike(volunteerTeams.elakaText, like),
          ilike(volunteerTeams.areaText, like),
        )!,
      );
    }
    const rows = await db
      .select({
        id: volunteerTeams.id,
        name: volunteerTeams.name,
        districtId: volunteerTeams.districtId,
        thanaId: volunteerTeams.thanaId,
        areaText: volunteerTeams.areaText,
        elakaText: volunteerTeams.elakaText,
        goliText: volunteerTeams.goliText,
        lat: volunteerTeams.lat,
        lng: volunteerTeams.lng,
        description: volunteerTeams.description,
        teamType: volunteerTeams.teamType,
        isActive: volunteerTeams.isActive,
        createdAt: volunteerTeams.createdAt,
      })
      .from(volunteerTeams)
      .where(and(...conds))
      .orderBy(sql`${volunteerTeams.createdAt} DESC`)
      .limit(limit);

    const teams = [];
    for (const r of rows) {
      teams.push(toTeamJson(r, await memberCount(r.id), null));
    }
    res.json({ teams, count: teams.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/teams/:id — team detail (public info; emergency phones stay member-only).
teamsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [r] = await db
      .select({
        id: volunteerTeams.id,
        name: volunteerTeams.name,
        districtId: volunteerTeams.districtId,
        thanaId: volunteerTeams.thanaId,
        areaText: volunteerTeams.areaText,
        elakaText: volunteerTeams.elakaText,
        goliText: volunteerTeams.goliText,
        lat: volunteerTeams.lat,
        lng: volunteerTeams.lng,
        description: volunteerTeams.description,
        teamType: volunteerTeams.teamType,
        isActive: volunteerTeams.isActive,
        createdAt: volunteerTeams.createdAt,
        districtName: districts.nameBn,
        thanaName: thanas.name,
      })
      .from(volunteerTeams)
      .leftJoin(districts, eq(volunteerTeams.districtId, districts.id))
      .leftJoin(thanas, eq(volunteerTeams.thanaId, thanas.id))
      .where(eq(volunteerTeams.id, id));
    if (!r) {
      res.status(404).json({ error: 'team not found' });
      return;
    }
    // Public roster: names + roles only (no phones — those stay behind /members).
    const roster = await db
      .select({ userId: teamMembers.userId, name: users.name, role: teamMembers.role, joinedAt: teamMembers.joinedAt })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, id));
    roster.sort((a, b) => {
      if (a.role === 'lead' && b.role !== 'lead') return -1;
      if (b.role === 'lead' && a.role !== 'lead') return 1;
      return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
    });
    res.json({
      team: {
        ...toTeamJson(r, roster.length, null),
        district_name: r.districtName,
        thana_name: r.thanaName,
      },
      roster: roster.map((m) => ({ user_id: m.userId, name: m.name, role: m.role, joined_at: m.joinedAt })),
    });
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

// GET /api/teams/:id/members — team roster (emergency phones included, members only).
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
