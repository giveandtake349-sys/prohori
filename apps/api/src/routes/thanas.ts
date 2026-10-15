import { Router, type Request, type Response, type NextFunction } from 'express';
import { db } from '../db.js';
import { thanas } from 'db';

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
