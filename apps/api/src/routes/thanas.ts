import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db.js';
import { uuidParam } from '../validate.js';
import { scorecardForThana } from '../lib/scorecard.js';
import { thanas, reports } from 'db';

export const thanasRouter = Router();

// GET /api/thanas — police station directory
thanasRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db.select().from(thanas);
    res.json({ thanas: rows, count: rows.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/thanas/scorecard — public accountability ranking for every thana.
// Sorted by score (null scores last). See lib/scorecard.ts for the formula.
thanasRouter.get('/scorecard', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const all = await db.select().from(thanas);
    const cards = await Promise.all(
      all.map((t) => scorecardForThana(t.id, t.name, t.district, t.lat, t.lng)),
    );
    cards.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    res.json({ scorecards: cards, count: cards.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/thanas/:id/scorecard — detail: aggregates + 20 most recent public reports.
thanasRouter.get('/:id/scorecard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = uuidParam(req, res, 'id');
    if (!id) return;
    const [t] = await db.select().from(thanas).where(eq(thanas.id, id));
    if (!t) {
      res.status(404).json({ error: 'thana not found' });
      return;
    }
    const card = await scorecardForThana(t.id, t.name, t.district, t.lat, t.lng);
    const recent = await db
      .select({
        trackingId: reports.trackingId,
        title: reports.title,
        status: reports.status,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.thanaId, id))
      .orderBy(desc(reports.createdAt))
      .limit(20);
    res.json({ ...card, recent_reports: recent });
  } catch (e) {
    next(e);
  }
});
