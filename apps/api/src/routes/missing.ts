import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, desc, sql, isNotNull } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody, isPgUniqueViolation, uuidParam } from '../validate.js';
import { missingPersons, missingFollowers, users } from 'db';
import { haversineKm } from '../lib/geo.js';
import { sendToUserIds } from '../lib/notify.js';

export const missingRouter = Router();

const GENDERS = ['male', 'female', 'other'] as const;

const createMissingSchema = z.object({
  name: z.string().min(2).max(120),
  age: z.number().int().min(0).max(130).nullable().optional(),
  gender: z.enum(GENDERS).nullable().optional(),
  photo_url: z.string().url().max(2000).nullable().optional(),
  last_seen_lat: z.number().min(-90).max(90).nullable().optional(),
  last_seen_lng: z.number().min(-180).max(180).nullable().optional(),
  last_seen_text: z.string().max(300).nullable().optional(),
  last_seen_date: z.string().datetime({ offset: true }).nullable().optional(),
  contact_phone: z.string().min(6).max(20),
});

// POST /api/missing — add a missing-person entry to the public board.
// The reporter is always the signed-in user from the verified bearer token.
missingRouter.post(
  '/',
  requireAuth,
  requireProfile,
  validateBody(createMissingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as z.infer<typeof createMissingSchema>;
      const [row] = await db
        .insert(missingPersons)
        .values({
          name: b.name.trim(),
          age: b.age ?? null,
          gender: b.gender ?? null,
          photoUrl: b.photo_url ?? null,
          lastSeenLat: b.last_seen_lat ?? null,
          lastSeenLng: b.last_seen_lng ?? null,
          lastSeenText: b.last_seen_text?.trim() || null,
          lastSeenDate: b.last_seen_date ? new Date(b.last_seen_date) : null,
          contactPhone: b.contact_phone.trim(),
          reporterId: req.appProfile!.id,
        })
        .returning();
      // v15: AMBER-style alert — if a location was given, push to all users
      // within 10 km (reporter excluded). Fire-and-forget.
      if (row.lastSeenLat != null && row.lastSeenLng != null) {
        void (async () => {
          try {
            const candidates = await db
              .select({ id: users.id, lastLat: users.lastLat, lastLng: users.lastLng })
              .from(users)
              .where(and(isNotNull(users.lastLat), isNotNull(users.lastLng)));
            const nearby = candidates
              .filter(
                (u) =>
                  u.id !== req.appProfile!.id &&
                  u.lastLat !== null &&
                  u.lastLng !== null &&
                  haversineKm(row.lastSeenLat!, row.lastSeenLng!, u.lastLat, u.lastLng) <= 10,
              )
              .map((u) => u.id);
            if (nearby.length > 0) {
              await sendToUserIds(nearby, {
                title: '⚠️ MISSING ALERT — নিখোঁজ!',
                body: `${row.name} (${row.lastSeenText ?? 'অজ্ঞাত স্থান'}) এলাকায় নিখোঁজ — চোখ রাখুন!`,
                data: { kind: 'missing_alert', missing_id: row.id },
              });
            }
          } catch (e) {
            console.warn('[missing] alert push failed:', (e as Error).message);
          }
        })();
      }
      res.status(201).json(row);
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/missing?status=missing|found|all&sort=hot|new — public board
// (contact phone is intentionally public: that's how a finder reaches the
// family). ?sort=hot (default) ranks by engagement × recency, still missing
// first then found; ?sort=new is reverse-chronological.
missingRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'missing';
    if (!['missing', 'found', 'all'].includes(status)) {
      res.status(400).json({ error: 'status must be missing, found or all' });
      return;
    }
    const sort = req.query.sort === 'new' ? 'new' : 'hot';
    const hotScore = sql`(${missingPersons.followerCount} * 2 + ${missingPersons.shareCount} * 2)
      / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(${missingPersons.lastActivityAt}, ${missingPersons.createdAt}))) / 3600, 0) + 2, 1.5)`;
    const rows = await db
      .select()
      .from(missingPersons)
      .where(status === 'all' ? undefined : eq(missingPersons.status, status))
      .orderBy(
        ...(sort === 'hot'
          ? [sql`CASE WHEN ${missingPersons.status} = 'missing' THEN 0 ELSE 1 END`, desc(hotScore)]
          : [desc(missingPersons.createdAt)]),
      )
      .limit(100);
    const counts = {
      missing: rows.filter((r) => r.status === 'missing').length,
      found: rows.filter((r) => r.status === 'found').length,
    };
    res.json({ persons: rows, count: rows.length, counts, sort });
  } catch (e) {
    next(e);
  }
});

// POST /api/missing/:id/found — mark as found. Allowed for the original
// reporter or a moderator/admin. Identity comes from the bearer token.
missingRouter.post(
  '/:id/found',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const [row] = await db.select().from(missingPersons).where(eq(missingPersons.id, id));
      if (!row) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (row.status === 'found') {
        res.json(row);
        return;
      }
      const me = req.appProfile!;
      const isReporter = row.reporterId !== null && row.reporterId === me.id;
      const isPrivileged = me.role === 'moderator' || me.role === 'admin';
      if (!isReporter && !isPrivileged) {
        res.status(403).json({ error: 'only the reporter or a moderator can mark as found' });
        return;
      }
      const [updated] = await db
        .update(missingPersons)
        .set({ status: 'found', foundAt: new Date(), lastActivityAt: new Date() })
        .where(eq(missingPersons.id, id))
        .returning();
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// v15: POST /api/missing/:id/seen — "আমি দেখেছি" — someone spotted the person.
// Notifies the reporter instantly (push). Rate-limited: one sighting per user
// per person per hour (best-effort, in-memory).
const seenCooldown = new Map<string, number>();
missingRouter.post('/:id/seen', requireAuth, requireProfile, async (req, res, next) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const me = req.appProfile!;
    const key = `${me.id}:${id}`;
    const last = seenCooldown.get(key) ?? 0;
    if (Date.now() - last < 3600_000) {
      res.status(429).json({ error: 'এক ঘণ্টায় একবার জানাতে পারবেন' });
      return;
    }
    seenCooldown.set(key, Date.now());
    const [row] = await db.select().from(missingPersons).where(eq(missingPersons.id, id));
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (row.status !== 'missing') {
      res.json({ ok: true, already_found: true });
      return;
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : '';
    // Bump activity so the case stays hot.
    await db
      .update(missingPersons)
      .set({ lastActivityAt: new Date() })
      .where(eq(missingPersons.id, id));
    if (row.reporterId && row.reporterId !== me.id) {
      void sendToUserIds([row.reporterId], {
        title: '👀 কেউ দেখেছে!',
        body: `${row.name}-কে কেউ দেখেছে বলে জানিয়েছে${note ? ': ' + note : ''} — দ্রুত যোগাযোগ করুন!`,
        data: { kind: 'missing_seen', missing_id: id },
      }).catch((e: unknown) => console.warn('[missing] seen push failed:', (e as Error).message));
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// POST /api/missing/:id/follow — follow a missing-person entry. 409 if
// already following.
missingRouter.post(
  '/:id/follow',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const userId = req.appProfile!.id;
      const [row] = await db.select({ id: missingPersons.id }).from(missingPersons).where(eq(missingPersons.id, id));
      if (!row) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      try {
        await db.insert(missingFollowers).values({ missingId: id, userId });
      } catch (e) {
        if (isPgUniqueViolation(e)) {
          res.status(409).json({ error: 'already following this entry' });
          return;
        }
        throw e;
      }
      const [updated] = await db
        .update(missingPersons)
        .set({
          followerCount: sql`${missingPersons.followerCount} + 1`,
          lastActivityAt: new Date(),
        })
        .where(eq(missingPersons.id, id))
        .returning({ followerCount: missingPersons.followerCount });
      res.status(201).json({ following: true, follower_count: updated?.followerCount ?? 0 });
    } catch (e) {
      next(e);
    }
  },
);

// DELETE /api/missing/:id/follow — unfollow a missing-person entry.
missingRouter.delete(
  '/:id/follow',
  requireAuth,
  requireProfile,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const userId = req.appProfile!.id;
      const [row] = await db.select({ id: missingPersons.id }).from(missingPersons).where(eq(missingPersons.id, id));
      if (!row) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      const deleted = await db
        .delete(missingFollowers)
        .where(and(eq(missingFollowers.missingId, id), eq(missingFollowers.userId, userId)))
        .returning({ id: missingFollowers.id });
      if (deleted.length === 0) {
        res.status(404).json({ error: 'not following this entry' });
        return;
      }
      const [updated] = await db
        .update(missingPersons)
        .set({
          followerCount: sql`GREATEST(${missingPersons.followerCount} - 1, 0)`,
          lastActivityAt: new Date(),
        })
        .where(eq(missingPersons.id, id))
        .returning({ followerCount: missingPersons.followerCount });
      res.json({ following: false, follower_count: updated?.followerCount ?? 0 });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/missing/:id/share — record a share (public; powers the hot feed).
missingRouter.post('/:id/share', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [row] = await db.select({ id: missingPersons.id }).from(missingPersons).where(eq(missingPersons.id, id));
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const [updated] = await db
      .update(missingPersons)
      .set({ shareCount: sql`${missingPersons.shareCount} + 1`, lastActivityAt: new Date() })
      .where(eq(missingPersons.id, id))
      .returning({ shareCount: missingPersons.shareCount });
    res.json({ share_count: updated?.shareCount ?? 0 });
  } catch (e) {
    next(e);
  }
});
