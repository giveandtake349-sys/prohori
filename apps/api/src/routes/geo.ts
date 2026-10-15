import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { divisions, districts, thanas } from 'db';

export const geoRouter = Router();

// GET /api/geo/divisions — all 8 divisions
geoRouter.get('/divisions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({ id: divisions.id, name_en: divisions.nameEn, name_bn: divisions.nameBn })
      .from(divisions);
    res.json({ divisions: rows, count: rows.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/geo/districts?division_id= — districts, optionally filtered by division
geoRouter.get('/districts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const divisionId = typeof req.query.division_id === 'string' ? req.query.division_id : undefined;
    if (divisionId && !/^[0-9a-f-]{36}$/i.test(divisionId)) {
      res.status(400).json({ error: 'invalid division_id' });
      return;
    }
    const rows = await db
      .select({
        id: districts.id,
        division_id: districts.divisionId,
        name_en: districts.nameEn,
        name_bn: districts.nameBn,
        lat: districts.lat,
        lng: districts.lng,
      })
      .from(districts)
      .where(divisionId ? eq(districts.divisionId, divisionId) : undefined);
    res.json({ districts: rows, count: rows.length });
  } catch (e) {
    next(e);
  }
});

// GET /api/geo/thanas?district_id= — thanas, optionally filtered by district
geoRouter.get('/thanas', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const districtId = typeof req.query.district_id === 'string' ? req.query.district_id : undefined;
    if (districtId && !/^[0-9a-f-]{36}$/i.test(districtId)) {
      res.status(400).json({ error: 'invalid district_id' });
      return;
    }
    const rows = await db
      .select({
        id: thanas.id,
        name: thanas.name,
        district: thanas.district,
        district_id: thanas.districtId,
        lat: thanas.lat,
        lng: thanas.lng,
      })
      .from(thanas)
      .where(districtId ? eq(thanas.districtId, districtId) : undefined);
    res.json({ thanas: rows, count: rows.length });
  } catch (e) {
    next(e);
  }
});
