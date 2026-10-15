import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody } from '../validate.js';
import { deviceTokens } from 'db';

export const devicesRouter = Router();

const registerSchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(['android', 'ios', 'web']).default('android'),
});

// POST /api/devices/register — link an FCM device token to the SIGNED-IN user.
// The user always comes from the verified bearer token; the body never
// carries a user id. Idempotent: re-registering the same token re-links it.
devicesRouter.post(
  '/register',
  requireAuth,
  requireProfile,
  validateBody(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, platform } = req.body as z.infer<typeof registerSchema>;
      const userId = req.appProfile!.id;
      await db
        .insert(deviceTokens)
        .values({ userId, token, platform })
        .onConflictDoUpdate({
          target: deviceTokens.token,
          set: { userId, platform },
        });
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);
