import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, desc, sql, ilike, count } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody, uuidParam } from '../validate.js';
import {
  users,
  reports,
  volunteerTeams,
  teamMembers,
  institutions,
  ambassadorApplications,
  featureIdeas,
  ideaVotes,
  caseTeams,
  locationRequests,
  caseStories,
  referrals,
} from 'db';

export const growthRouter = Router();

// ---------------------------------------------------------------------------
// Public counter — GET /api/growth/stats
// Live totals: users (প্রহরী), reports, resolved cases. Zero fake data.
// ---------------------------------------------------------------------------
growthRouter.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [[u], [r], [s]] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(reports),
      db.select({ n: count() }).from(reports).where(eq(reports.status, 'resolved')),
    ]);
    res.json({ users: u.n, reports: r.n, resolved: s.n });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Invite system
// ---------------------------------------------------------------------------
function makeInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** GET /api/growth/invite/me — my invite code (creates one lazily). */
growthRouter.get('/invite/me', requireAuth, requireProfile, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.appProfile!.id;
    const [u] = await db.select({ inviteCode: users.inviteCode }).from(users).where(eq(users.id, me));
    if (u?.inviteCode) {
      res.json({ code: u.inviteCode });
      return;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeInviteCode();
      try {
        await db.update(users).set({ inviteCode: code }).where(eq(users.id, me));
        res.json({ code });
        return;
      } catch {
        // collision — retry
      }
    }
    res.status(500).json({ error: 'কোড বানানো যায়নি। আবার চেষ্টা করুন।' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/growth/invite/:code — resolve a code to the inviter's name (public). */
growthRouter.get('/invite/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.params.code as string).toUpperCase().trim();
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.inviteCode, code))
      .limit(1);
    if (!u) {
      res.status(404).json({ error: 'ভুল invite কোড' });
      return;
    }
    res.json({ inviterName: u.name });
  } catch (e) {
    next(e);
  }
});

const redeemSchema = z.object({ code: z.string().min(4).max(12) });

/** POST /api/growth/invite/redeem — record who invited me (after profile save). */
growthRouter.post(
  '/invite/redeem',
  requireAuth,
  requireProfile,
  validateBody(redeemSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const { code } = req.body as z.infer<typeof redeemSchema>;
      const [inviter] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.inviteCode, code.toUpperCase().trim()))
        .limit(1);
      if (!inviter || inviter.id === me) {
        res.status(404).json({ error: 'ভুল invite কোড' });
        return;
      }
      await db.update(users).set({ invitedBy: inviter.id }).where(eq(users.id, me));
      await db.insert(referrals).values({ inviterId: inviter.id, invitedId: me });
      // Inviter earns the প্রহরী badge credit implicitly — count surfaced via /invite/stats.
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

/** GET /api/growth/invite/stats — how many friends I brought. */
growthRouter.get('/invite/stats', requireAuth, requireProfile, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.appProfile!.id;
    const [row] = await db
      .select({ n: count() })
      .from(referrals)
      .where(eq(referrals.inviterId, me));
    res.json({ invited: row.n });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Onboarding — POST /api/growth/onboarding/complete
// ---------------------------------------------------------------------------
const onboardingSchema = z.object({
  thanaId: z.string().uuid().optional(),
});

growthRouter.post(
  '/onboarding/complete',
  requireAuth,
  requireProfile,
  validateBody(onboardingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const { thanaId } = req.body as z.infer<typeof onboardingSchema>;
      await db
        .update(users)
        .set({ onboardingDone: true, ...(thanaId ? { thanaId } : {}) })
        .where(eq(users.id, me));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Institutions — GET /api/growth/institutions?q=&level=
// ---------------------------------------------------------------------------
growthRouter.get('/institutions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const level = String(req.query.level ?? '').trim();
    if (q.length < 2) {
      res.json({ institutions: [] });
      return;
    }
    const conds = [ilike(institutions.name, `%${q}%`)];
    if (['university', 'college', 'school'].includes(level)) conds.push(eq(institutions.level, level));
    const rows = await db
      .select({ id: institutions.id, name: institutions.name, level: institutions.level, district: institutions.district })
      .from(institutions)
      .where(and(...conds))
      .limit(20);
    res.json({ institutions: rows });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Campus ambassador
// ---------------------------------------------------------------------------
const applySchema = z.object({
  name: z.string().min(2).max(80),
  phone: z.string().min(6).max(20),
  institutionId: z.string().uuid().optional(),
  institutionName: z.string().min(2).max(160),
  level: z.enum(['university', 'college', 'school']),
  idPhotoUrl: z.string().url().max(500).optional(),
  reason: z.string().max(500).optional(),
});

/** POST /api/growth/ambassador/apply — student applies to be a দূত. */
growthRouter.post(
  '/ambassador/apply',
  requireAuth,
  requireProfile,
  validateBody(applySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const [existing] = await db
        .select({ id: ambassadorApplications.id, status: ambassadorApplications.status })
        .from(ambassadorApplications)
        .where(eq(ambassadorApplications.userId, me))
        .limit(1);
      if (existing && existing.status !== 'rejected') {
        res.status(409).json({ error: 'তোমার application ইতিমধ্যে জমা আছে' });
        return;
      }
      const body = req.body as z.infer<typeof applySchema>;
      const [app] = await db
        .insert(ambassadorApplications)
        .values({
          userId: me,
          name: body.name,
          phone: body.phone,
          institutionId: body.institutionId ?? null,
          institutionName: body.institutionName,
          level: body.level,
          idPhotoUrl: body.idPhotoUrl ?? null,
          reason: body.reason ?? null,
        })
        .returning({ id: ambassadorApplications.id });
      res.status(201).json({ id: app.id });
    } catch (e) {
      next(e);
    }
  },
);

/** GET /api/growth/ambassador/my-status — my application status + level. */
growthRouter.get('/ambassador/my-status', requireAuth, requireProfile, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const me = req.appProfile!.id;
    const [app] = await db
      .select({ status: ambassadorApplications.status, level: ambassadorApplications.level })
      .from(ambassadorApplications)
      .where(eq(ambassadorApplications.userId, me))
      .orderBy(desc(ambassadorApplications.createdAt))
      .limit(1);
    res.json({ status: app?.status ?? null, level: req.appProfile!.ambassadorLevel ?? app?.level ?? null });
  } catch (e) {
    next(e);
  }
});

function requireAdminLike(req: Request, res: Response): boolean {
  const role = req.appProfile?.role;
  if (role !== 'admin' && role !== 'moderator') {
    res.status(403).json({ error: 'অনুমতি নেই' });
    return false;
  }
  return true;
}

/** GET /api/growth/ambassador/applications — pending list (admin/mod). */
growthRouter.get(
  '/ambassador/applications',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAdminLike(req, res)) return;
      const scope = String(req.query.scope ?? 'pending');
      const cond = scope === 'all' ? undefined : eq(ambassadorApplications.status, 'pending');
      const rows = await db
        .select()
        .from(ambassadorApplications)
        .where(cond)
        .orderBy(desc(ambassadorApplications.createdAt))
        .limit(100);
      res.json({ applications: rows });
    } catch (e) {
      next(e);
    }
  },
);

const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']) });

/** POST /api/growth/ambassador/applications/:id/review — approve/reject (admin/mod). */
growthRouter.post(
  '/ambassador/applications/:id/review',
  requireAuth,
  requireProfile,
  validateBody(reviewSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAdminLike(req, res)) return;
      const { decision } = req.body as z.infer<typeof reviewSchema>;
      const appId = uuidParam(req, res, 'id');
      if (!appId) return;
      const [app] = await db
        .select()
        .from(ambassadorApplications)
        .where(eq(ambassadorApplications.id, appId))
        .limit(1);
      if (!app) {
        res.status(404).json({ error: 'application পাওয়া যায়নি' });
        return;
      }
      await db
        .update(ambassadorApplications)
        .set({ status: decision, reviewedBy: req.appProfile!.id })
        .where(eq(ambassadorApplications.id, app.id));
      if (decision === 'approved') {
        await db.update(users).set({ ambassadorLevel: app.level }).where(eq(users.id, app.userId));
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

/** GET /api/growth/ambassadors — public ambassador leaderboard. */
growthRouter.get('/ambassadors', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        name: ambassadorApplications.name,
        institutionName: ambassadorApplications.institutionName,
        level: ambassadorApplications.level,
      })
      .from(ambassadorApplications)
      .where(eq(ambassadorApplications.status, 'approved'))
      .orderBy(desc(ambassadorApplications.createdAt))
      .limit(50);
    res.json({ ambassadors: rows });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Feature ideas ("ফিচার চাও?")
// ---------------------------------------------------------------------------
/** GET /api/growth/ideas — top voted first. */
growthRouter.get('/ideas', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        id: featureIdeas.id,
        title: featureIdeas.title,
        voteCount: featureIdeas.voteCount,
        status: featureIdeas.status,
        createdAt: featureIdeas.createdAt,
        author: users.name,
      })
      .from(featureIdeas)
      .leftJoin(users, eq(users.id, featureIdeas.userId))
      .orderBy(desc(featureIdeas.voteCount), desc(featureIdeas.createdAt))
      .limit(100);
    res.json({ ideas: rows });
  } catch (e) {
    next(e);
  }
});

const ideaSchema = z.object({ title: z.string().min(4).max(200) });

/** POST /api/growth/ideas — suggest a feature. */
growthRouter.post(
  '/ideas',
  requireAuth,
  requireProfile,
  validateBody(ideaSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { title } = req.body as z.infer<typeof ideaSchema>;
      const [idea] = await db
        .insert(featureIdeas)
        .values({ userId: req.appProfile!.id, title: title.trim() })
        .returning({ id: featureIdeas.id });
      res.status(201).json({ id: idea.id });
    } catch (e) {
      next(e);
    }
  },
);

/** POST /api/growth/ideas/:id/vote — one vote per user (toggle). */
growthRouter.post(
  '/ideas/:id/vote',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const ideaId = uuidParam(req, res, 'id');
      if (!ideaId) return;
      const [existing] = await db
        .select({ id: ideaVotes.id })
        .from(ideaVotes)
        .where(and(eq(ideaVotes.ideaId, ideaId), eq(ideaVotes.userId, me)))
        .limit(1);
      if (existing) {
        await db.delete(ideaVotes).where(eq(ideaVotes.id, existing.id));
        await db
          .update(featureIdeas)
          .set({ voteCount: sql`${featureIdeas.voteCount} - 1` })
          .where(eq(featureIdeas.id, ideaId));
        res.json({ voted: false });
        return;
      }
      await db.insert(ideaVotes).values({ ideaId, userId: me });
      await db
        .update(featureIdeas)
        .set({ voteCount: sql`${featureIdeas.voteCount} + 1` })
        .where(eq(featureIdeas.id, ideaId));
      res.json({ voted: true });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Case → team loop
// ---------------------------------------------------------------------------
const joinTeamSchema = z.object({ teamId: z.string().uuid() });

/**
 * POST /api/growth/reports/:reportId/join-team — a team joins a case.
 * Any team member can join their team; team needs ≥3 members.
 */
growthRouter.post(
  '/reports/:reportId/join-team',
  requireAuth,
  requireProfile,
  validateBody(joinTeamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const reportId = uuidParam(req, res, 'reportId');
      if (!reportId) return;
      const { teamId } = req.body as z.infer<typeof joinTeamSchema>;

      const [report] = await db.select({ id: reports.id }).from(reports).where(eq(reports.id, reportId)).limit(1);
      if (!report) {
        res.status(404).json({ error: 'রিপোর্ট পাওয়া যায়নি' });
        return;
      }
      // Requester must be a member of the team.
      const [membership] = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, me)))
        .limit(1);
      if (!membership) {
        res.status(403).json({ error: 'তুমি এই টিমের member নও' });
        return;
      }
      // Team needs at least 3 members to take a case.
      const [mc] = await db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
      if (mc.n < 3) {
        res.status(400).json({ error: `কেস নিতে টিমে কমপক্ষে ৩ জন member লাগবে (এখন ${mc.n} জন)` });
        return;
      }
      const [existing] = await db
        .select({ id: caseTeams.id })
        .from(caseTeams)
        .where(and(eq(caseTeams.reportId, reportId), eq(caseTeams.teamId, teamId)))
        .limit(1);
      if (existing) {
        res.status(409).json({ error: 'টিম ইতিমধ্যে এই কেসে আছে' });
        return;
      }
      await db.insert(caseTeams).values({ reportId, teamId });
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

/** GET /api/growth/reports/:reportId/teams — teams on this case. */
growthRouter.get('/reports/:reportId/teams', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        teamId: volunteerTeams.id,
        name: volunteerTeams.name,
        teamType: volunteerTeams.teamType,
        joinedAt: caseTeams.joinedAt,
      })
      .from(caseTeams)
      .innerJoin(volunteerTeams, eq(volunteerTeams.id, caseTeams.teamId))
      .where(eq(caseTeams.reportId, uuidParam(req, res, 'reportId') ?? ''))
      .orderBy(caseTeams.joinedAt);
    // member counts per team
    const withCounts = await Promise.all(
      rows.map(async (r) => {
        const [mc] = await db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, r.teamId));
        return { ...r, memberCount: mc.n };
      }),
    );
    res.json({ teams: withCounts });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/growth/reports/:reportId/request-location — a joined team asks
 * the reporter for the exact location. Reporter approves → team sees pin.
 */
growthRouter.post(
  '/reports/:reportId/request-location',
  requireAuth,
  requireProfile,
  validateBody(joinTeamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const reportId = uuidParam(req, res, 'reportId');
      if (!reportId) return;
      const { teamId } = req.body as z.infer<typeof joinTeamSchema>;
      const [joined] = await db
        .select({ id: caseTeams.id })
        .from(caseTeams)
        .where(and(eq(caseTeams.reportId, reportId), eq(caseTeams.teamId, teamId)))
        .limit(1);
      if (!joined) {
        res.status(400).json({ error: 'আগে টিমকে কেসে join করতে হবে' });
        return;
      }
      const [existing] = await db
        .select({ id: locationRequests.id, status: locationRequests.status })
        .from(locationRequests)
        .where(and(eq(locationRequests.reportId, reportId), eq(locationRequests.teamId, teamId)))
        .limit(1);
      if (existing) {
        res.json({ ok: true, status: existing.status });
        return;
      }
      const [lr] = await db
        .insert(locationRequests)
        .values({ reportId, teamId, requestedBy: me, status: 'pending' })
        .returning({ id: locationRequests.id });
      res.status(201).json({ ok: true, id: lr.id, status: 'pending' });
    } catch (e) {
      next(e);
    }
  },
);

/** GET /api/growth/location-requests/mine — pending requests on MY reports. */
growthRouter.get(
  '/location-requests/mine',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const rows = await db
        .select({
          id: locationRequests.id,
          reportId: locationRequests.reportId,
          teamId: locationRequests.teamId,
          teamName: volunteerTeams.name,
          reportTitle: reports.title,
          status: locationRequests.status,
          createdAt: locationRequests.createdAt,
        })
        .from(locationRequests)
        .innerJoin(reports, eq(reports.id, locationRequests.reportId))
        .innerJoin(volunteerTeams, eq(volunteerTeams.id, locationRequests.teamId))
        .where(and(eq(reports.reporterId, me), eq(locationRequests.status, 'pending')))
        .orderBy(desc(locationRequests.createdAt))
        .limit(50);
      res.json({ requests: rows });
    } catch (e) {
      next(e);
    }
  },
);

const lrReviewSchema = z.object({ decision: z.enum(['approved', 'rejected']) });

/** POST /api/growth/location-requests/:id/review — reporter approves/rejects. */
growthRouter.post(
  '/location-requests/:id/review',
  requireAuth,
  requireProfile,
  validateBody(lrReviewSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = req.appProfile!.id;
      const [lr] = await db
        .select({ id: locationRequests.id, reportId: locationRequests.reportId })
        .from(locationRequests)
        .innerJoin(reports, eq(reports.id, locationRequests.reportId))
        .where(and(eq(locationRequests.id, uuidParam(req, res, 'id') ?? ''), eq(reports.reporterId, me)))
        .limit(1);
      if (!lr) {
        res.status(404).json({ error: 'request পাওয়া যায়নি' });
        return;
      }
      const { decision } = req.body as z.infer<typeof lrReviewSchema>;
      await db.update(locationRequests).set({ status: decision }).where(eq(locationRequests.id, lr.id));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

/** GET /api/growth/reports/:reportId/location-status?teamId= — can this team see the pin? */
growthRouter.get('/reports/:reportId/location-status', requireAuth, requireProfile, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const teamId = String(req.query.teamId ?? '');
    const rid = uuidParam(req, res, 'reportId');
    if (!rid) return;
    if (!teamId) {
      res.json({ status: null });
      return;
    }
    const [lr] = await db
      .select({ status: locationRequests.status })
      .from(locationRequests)
      .where(and(eq(locationRequests.reportId, rid), eq(locationRequests.teamId, teamId)))
      .limit(1);
    res.json({ status: lr?.status ?? null });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Case stories (viral loop)
// ---------------------------------------------------------------------------
/**
 * Build + save the auto-story for a resolved report. Exported so the admin
 * status-change route can call it when a report is marked resolved.
 */
export async function generateCaseStory(reportId: string): Promise<void> {
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  if (!report || report.status !== 'resolved') return;
  const [existing] = await db.select({ id: caseStories.id }).from(caseStories).where(eq(caseStories.reportId, reportId)).limit(1);
  if (existing) return;

  const teams = await db
    .select({ teamId: caseTeams.teamId, name: volunteerTeams.name })
    .from(caseTeams)
    .innerJoin(volunteerTeams, eq(volunteerTeams.id, caseTeams.teamId))
    .where(eq(caseTeams.reportId, reportId));
  let memberCount = 0;
  for (const t of teams) {
    const [mc] = await db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, t.teamId));
    memberCount += mc.n;
  }
  const teamNames = teams.map((t) => t.name).join(', ');
  const title = `${report.title} — সমাধান!`;
  const body =
    `📸 রিপোর্ট করেছিল ${report.isAnonymous ? 'একজন সচেতন নাগরিক' : 'রিপোর্টার'}\n` +
    (teams.length > 0
      ? `👥 পাশে দাঁড়িয়েছিল ${teams.length}টা টিম (${memberCount} জন): ${teamNames}\n`
      : `👥 জনতা যাচাই করেছিল\n`) +
    `✅ কেস সমাধান হয়েছে। তোমার এলাকায় এমন হলে তুমিও পারো — প্রহরীতে রিপোর্ট করো।`;

  await db.insert(caseStories).values({
    reportId,
    title,
    body,
    teamCount: teams.length,
    memberCount,
  });
}

/** GET /api/growth/stories — latest solved-case stories. */
growthRouter.get('/stories', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select()
      .from(caseStories)
      .orderBy(desc(caseStories.createdAt))
      .limit(30);
    res.json({ stories: rows });
  } catch (e) {
    next(e);
  }
});

/** POST /api/growth/reports/:reportId/story — (re)generate story for a resolved case. */
growthRouter.post(
  '/reports/:reportId/story',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sid = uuidParam(req, res, 'reportId');
      if (!sid) return;
      await generateCaseStory(sid);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);
