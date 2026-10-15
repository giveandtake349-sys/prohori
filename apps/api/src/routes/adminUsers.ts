import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { validateBody, uuidParam } from '../validate.js';
import { users } from 'db';

// Mounted at /api/admin in index.ts. Admin-only user management.
// The admin role itself is NEVER granted or changed here — it is set
// directly in the database (one-time SQL). This prevents privilege
// escalation through the API.
export const adminUsersRouter = Router();

const SETTABLE_ROLES = ['citizen', 'volunteer', 'moderator'] as const;

// GET /api/admin/users — list users for role management (admin only).
adminUsersRouter.get(
  '/users',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 100;
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          role: users.role,
          trustScore: users.trustScore,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(limit);
      res.json({ users: rows, count: rows.length });
    } catch (e) {
      next(e);
    }
  },
);

const setRoleSchema = z.object({
  role: z.enum(SETTABLE_ROLES),
});

// PATCH /api/admin/users/:id/role — set a user's role (admin only).
// Rules: 'admin' can never be granted or removed here; nobody can change
// their own role (not even an admin — prevents accidental lockout).
adminUsersRouter.patch(
  '/users/:id/role',
  requireAuth,
  requireAdmin,
  validateBody(setRoleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = uuidParam(req, res, 'id');
      if (!id) return;
      const { role } = req.body as z.infer<typeof setRoleSchema>;
      const me = req.appProfile!.id;

      if (id === me) {
        res.status(403).json({ error: 'you cannot change your own role' });
        return;
      }
      const [target] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, id));
      if (!target) {
        res.status(404).json({ error: 'user not found' });
        return;
      }
      if (target.role === 'admin') {
        res.status(403).json({ error: 'the admin role is protected and cannot be changed here' });
        return;
      }
      const [updated] = await db
        .update(users)
        .set({ role })
        .where(eq(users.id, id))
        .returning({ id: users.id, name: users.name, role: users.role });
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);
