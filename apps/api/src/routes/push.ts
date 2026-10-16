import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody } from '../validate.js';
import { deviceTokens } from 'db';

export const pushRouter = Router();

const tokenSchema = z.object({
  token: z.string().min(1).max(2048),
  platform: z.enum(['android', 'ios', 'web']).default('web'),
});

// POST /api/push/token — register an FCM device token for the SIGNED-IN user.
// The user always comes from the verified bearer <redacted>; the body never
// carries a user id. Idempotent: re-registering the same token re-links it.
pushRouter.post(
  '/token',
  requireAuth,
  requireProfile,
  validateBody(tokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, platform } = req.body as z.infer<typeof tokenSchema>;
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
