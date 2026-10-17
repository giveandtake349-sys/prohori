import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireModerator } from '../auth.js';
import { validateBody } from '../validate.js';
import {
  scamChecks,
  guaranteeReceipts,
  guaranteeClaims,
  guaranteeFund,
} from 'db';

/**
 * BlackHole Dhapa 3 — Guarantee ("verify kore thokle, taka ferot").
 * Receipts are issued only for safe/low-risk checks; claims need proof + GD
 * and moderator review. The fund ledger is public (transparency).
 */
export const guaranteeRouter = Router();

/** Safe verdicts eligible for a Protected receipt (riskPct <= 30 in the engine). */
const SAFE_VERDICTS = ['clean', 'unknown'];

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
  const bytes = randomBytes(6);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `PHR-${s}`;
}

// POST /guarantee/issue — issue a Protected receipt for a safe check (auth)
guaranteeRouter.post(
  '/issue',
  requireAuth,
  validateBody(z.object({ check_id: z.string().uuid() })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.authIdentity!.id;
      const { check_id } = req.body as { check_id: string };
      const [check] = await db.select().from(scamChecks).where(eq(scamChecks.id, check_id)).limit(1);
      if (!check || check.userId !== userId) {
        res.status(404).json({ error: 'check not found' });
        return;
      }
      if (!SAFE_VERDICTS.includes(check.verdict)) {
        res.status(400).json({ error: 'guarantee only for safe/low-risk verdicts', verdict: check.verdict });
        return;
      }
      // One active receipt per check.
      const [existing] = await db
        .select({ id: guaranteeReceipts.id })
        .from(guaranteeReceipts)
        .where(and(eq(guaranteeReceipts.checkId, check_id), eq(guaranteeReceipts.status, 'active')))
        .limit(1);
      if (existing) {
        const [receipt] = await db.select().from(guaranteeReceipts).where(eq(guaranteeReceipts.id, existing.id)).limit(1);
        res.json({ receipt, reused: true });
        return;
      }
      let receipt = null;
      for (let attempt = 0; attempt < 5 && !receipt; attempt++) {
        try {
          const [row] = await db
            .insert(guaranteeReceipts)
            .values({
              userId,
              checkId: check_id,
              code: makeCode(),
              verdictSnapshot: { verdict: check.verdict, inputType: check.inputType, checkedAt: check.createdAt },
              maxAmount: 10000,
              expiresAt: new Date(Date.now() + 30 * 86400000),
              status: 'active',
            })
            .returning();
          receipt = row;
        } catch {
          /* code collision — retry */
        }
      }
      if (!receipt) {
        res.status(500).json({ error: 'receipt issue failed, try again' });
        return;
      }
      res.json({ receipt });
    } catch (e) {
      next(e);
    }
  },
);

// GET /guarantee/my — my receipts + claims (auth)
guaranteeRouter.get('/my', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.authIdentity!.id;
    const receipts = await db
      .select()
      .from(guaranteeReceipts)
      .where(eq(guaranteeReceipts.userId, userId))
      .orderBy(desc(guaranteeReceipts.createdAt))
      .limit(50);
    const claims = await db
      .select()
      .from(guaranteeClaims)
      .where(eq(guaranteeClaims.userId, userId))
      .orderBy(desc(guaranteeClaims.createdAt))
      .limit(50);
    const byReceipt = new Map<string, typeof claims>();
    for (const c of claims) {
      if (!c.receiptId) continue;
      const arr = byReceipt.get(c.receiptId) ?? [];
      arr.push(c);
      byReceipt.set(c.receiptId, arr);
    }
    res.json({
      receipts: receipts.map((r) => ({ ...r, claims: byReceipt.get(r.id) ?? [] })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /guarantee/fund — PUBLIC transparency panel (live numbers, no fake data)
guaranteeRouter.get('/fund', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [agg] = await db
      .select({
        balance: sql<number>`coalesce(sum(case when ${guaranteeFund.kind} = 'credit' then ${guaranteeFund.amount} else -${guaranteeFund.amount} end), 0)`,
        paidOut: sql<number>`coalesce(sum(case when ${guaranteeFund.kind} = 'debit' then ${guaranteeFund.amount} else 0 end), 0)`,
        entries: sql<number>`count(*)`,
      })
      .from(guaranteeFund);
    const [prot] = await db
      .select({ count: sql<number>`count(*)` })
      .from(guaranteeReceipts)
      .where(eq(guaranteeReceipts.status, 'active'));
    const [paid] = await db
      .select({ count: sql<number>`count(*)` })
      .from(guaranteeClaims)
      .where(eq(guaranteeClaims.status, 'approved'));
    const ledger = await db
      .select()
      .from(guaranteeFund)
      .orderBy(desc(guaranteeFund.createdAt))
      .limit(20);
    res.json({
      fundBalance: Number(agg?.balance ?? 0),
      totalPaidOut: Number(agg?.paidOut ?? 0),
      protectedActive: Number(prot?.count ?? 0),
      claimsPaid: Number(paid?.count ?? 0),
      ledger: ledger.map((l) => ({ kind: l.kind, amount: l.amount, note: l.note, createdAt: l.createdAt })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /guarantee/claim — file a claim (auth)
guaranteeRouter.post(
  '/claim',
  requireAuth,
  validateBody(
    z.object({
      receipt_id: z.string().uuid(),
      amount: z.number().int().min(1).max(100000),
      proof_urls: z.array(z.string().url().max(500)).min(1).max(5),
      gd_number: z.string().min(1).max(100),
    }),
  ),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.authIdentity!.id;
      const { receipt_id, amount, proof_urls, gd_number } = req.body as {
        receipt_id: string;
        amount: number;
        proof_urls: string[];
        gd_number: string;
      };
      const [receipt] = await db.select().from(guaranteeReceipts).where(eq(guaranteeReceipts.id, receipt_id)).limit(1);
      if (!receipt || receipt.userId !== userId) {
        res.status(404).json({ error: 'receipt not found' });
        return;
      }
      if (receipt.status !== 'active') {
        res.status(400).json({ error: 'receipt is no longer active', status: receipt.status });
        return;
      }
      if (receipt.expiresAt && new Date(receipt.expiresAt) < new Date()) {
        res.status(400).json({ error: 'receipt expired' });
        return;
      }
      if (amount > (receipt.maxAmount ?? 10000)) {
        res.status(400).json({ error: `claim exceeds receipt limit of ৳${receipt.maxAmount}` });
        return;
      }
      // One pending claim per user at a time (anti-gaming).
      const [pending] = await db
        .select({ id: guaranteeClaims.id })
        .from(guaranteeClaims)
        .where(and(eq(guaranteeClaims.userId, userId), eq(guaranteeClaims.status, 'pending')))
        .limit(1);
      if (pending) {
        res.status(400).json({ error: 'you already have a pending claim' });
        return;
      }
      const [claim] = await db
        .insert(guaranteeClaims)
        .values({ receiptId: receipt_id, userId, amount, proofUrls: proof_urls, gdNumber: gd_number, status: 'pending' })
        .returning();
      res.json({ claim });
    } catch (e) {
      next(e);
    }
  },
);

// GET /guarantee/claims/pending — moderator queue
guaranteeRouter.get('/claims/pending', requireModerator, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        claim: guaranteeClaims,
        code: guaranteeReceipts.code,
        maxAmount: guaranteeReceipts.maxAmount,
      })
      .from(guaranteeClaims)
      .leftJoin(guaranteeReceipts, eq(guaranteeClaims.receiptId, guaranteeReceipts.id))
      .where(eq(guaranteeClaims.status, 'pending'))
      .orderBy(desc(guaranteeClaims.createdAt))
      .limit(50);
    res.json({ queue: rows });
  } catch (e) {
    next(e);
  }
});

// POST /guarantee/review/:id — approve (payout) or reject (moderator)
guaranteeRouter.post(
  '/review/:id',
  requireModerator,
  validateBody(z.object({ action: z.enum(['approve', 'reject']) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params as { id: string };
      const { action } = req.body as { action: 'approve' | 'reject' };
      const [claim] = await db.select().from(guaranteeClaims).where(eq(guaranteeClaims.id, id)).limit(1);
      if (!claim || claim.status !== 'pending') {
        res.status(404).json({ error: 'pending claim not found' });
        return;
      }
      const reviewer = req.authIdentity!.id;
      if (action === 'approve') {
        await db.update(guaranteeClaims).set({ status: 'approved', reviewedBy: reviewer, reviewedAt: new Date() }).where(eq(guaranteeClaims.id, id));
        if (claim.receiptId) {
          await db.update(guaranteeReceipts).set({ status: 'claimed' }).where(eq(guaranteeReceipts.id, claim.receiptId));
        }
        await db.insert(guaranteeFund).values({
          amount: claim.amount,
          kind: 'debit',
          note: `Payout claim ${id.slice(0, 8)} (approved by ${reviewer.slice(0, 8)})`,
        });
      } else {
        await db.update(guaranteeClaims).set({ status: 'rejected', reviewedBy: reviewer, reviewedAt: new Date() }).where(eq(guaranteeClaims.id, id));
      }
      res.json({ ok: true, action });
    } catch (e) {
      next(e);
    }
  },
);
