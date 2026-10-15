import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { validateBody } from '../validate.js';
import { fraudNumbers, users } from 'db';

export const fraudRouter = Router();

const reportFraudSchema = z.object({
  phone_number: z.string().min(6).max(20),
  reporter_id: z.string().uuid().optional(),
});

/** Normalizes to digits only so +8801... and 8801... dedupe to one row. */
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

// POST /api/fraud-numbers — report a scam/fraud number. verified at >= 5 reports.
fraudRouter.post(
  '/',
  validateBody(reportFraudSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phone_number, reporter_id } = req.body as z.infer<typeof reportFraudSchema>;
      const normalized = normalizePhone(phone_number);
      if (normalized.length < 6) {
        res.status(400).json({ error: 'invalid phone number' });
        return;
      }
      if (reporter_id) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, reporter_id));
        if (!u) {
          res.status(404).json({ error: 'reporter not found' });
          return;
        }
      }

      const [row] = await db
        .insert(fraudNumbers)
        .values({ phoneNumber: normalized })
        .onConflictDoUpdate({
          target: fraudNumbers.phoneNumber,
          set: {
            reportCount: sql`${fraudNumbers.reportCount} + 1`,
            lastReportedAt: new Date(),
          },
        })
        .returning();

      let verified = row.verified;
      if (!verified && row.reportCount >= 5) {
        const [v] = await db
          .update(fraudNumbers)
          .set({ verified: true })
          .where(eq(fraudNumbers.id, row.id))
          .returning();
        verified = v.verified;
      }
      res.status(201).json({
        phone_number: row.phoneNumber,
        report_count: row.reportCount,
        verified,
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/fraud-numbers/check?number= — is this a known scam number?
fraudRouter.get('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = typeof req.query.number === 'string' ? req.query.number : '';
    const normalized = normalizePhone(raw);
    if (!normalized) {
      res.status(400).json({ error: 'query param "number" is required' });
      return;
    }
    const [row] = await db
      .select()
      .from(fraudNumbers)
      .where(eq(fraudNumbers.phoneNumber, normalized));
    if (!row) {
      res.json({ is_fraud: false, report_count: 0, verified: false });
      return;
    }
    // Heuristic: confirmed-verified, or 3+ independent reports = treat as fraud.
    res.json({
      is_fraud: row.verified || row.reportCount >= 3,
      report_count: row.reportCount,
      verified: row.verified,
    });
  } catch (e) {
    next(e);
  }
});
