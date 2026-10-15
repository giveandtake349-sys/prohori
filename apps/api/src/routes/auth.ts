import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { isPgUniqueViolation, validateBody } from '../validate.js';
import { requireAuth } from '../auth.js';
import { users } from 'db';

export const authRouter = Router();

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(6).max(24),
});

// The user UUID comes only from the verified Supabase session.
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [profile] = await db
      .select({ id: users.id, name: users.name, phone: users.phone, role: users.role })
      .from(users)
      .where(eq(users.id, req.authIdentity!.id));
    res.json({
      auth: { id: req.authIdentity!.id, email: req.authIdentity!.email },
      profile: profile ?? null,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  '/profile',
  requireAuth,
  validateBody(profileSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, phone } = req.body as z.infer<typeof profileSchema>;
      const [profile] = await db
        .insert(users)
        .values({ id: req.authIdentity!.id, name, phone })
        .onConflictDoUpdate({
          target: users.id,
          set: { name, phone },
        })
        .returning({ id: users.id, name: users.name, phone: users.phone, role: users.role });
      res.status(201).json({ profile });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        res.status(409).json({ error: 'এই ফোন নম্বরটি অন্য একটি Prohori account-এ ব্যবহার করা হয়েছে।' });
        return;
      }
      next(error);
    }
  },
);
