import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody } from '../validate.js';
import { touristSpots, fairPrices, scamExamples, touristScamReports } from 'db';

export const touristRouter = Router();

// GET /api/tourist/divisions — divisions with spot counts
touristRouter.get('/divisions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        division: touristSpots.division,
        spots: sql<number>`count(*)::int`,
      })
      .from(touristSpots)
      .groupBy(touristSpots.division)
      .orderBy(touristSpots.division);
    const scamRows = await db
      .select({
        destination: scamExamples.destination,
        count: sql<number>`count(*)::int`,
      })
      .from(scamExamples)
      .groupBy(scamExamples.destination);
    const scamByDest = new Map(scamRows.map((r) => [r.destination, r.count]));
    res.json({
      divisions: rows.map((r) => ({
        division: r.division,
        spots: r.spots,
        scams: scamByDest.get(r.division) ?? 0,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/tourist/spots?division=&search=&limit= — list spots
touristRouter.get('/spots', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { division, search } = req.query as { division?: string; search?: string };
    const limit = Math.min(parseInt(String(req.query.limit ?? '60'), 10) || 60, 200);
    const conds = [];
    if (division) conds.push(eq(touristSpots.division, division));
    if (search) {
      const q = `%${search}%`;
      conds.push(or(ilike(touristSpots.nameEn, q), ilike(touristSpots.nameBn, q), ilike(touristSpots.district, q)));
    }
    const rows = await db
      .select()
      .from(touristSpots)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(touristSpots.nameEn)
      .limit(limit);
    res.json({ spots: rows });
  } catch (e) {
    next(e);
  }
});

// GET /api/tourist/spots/:id — spot detail + fair prices + scam examples + user reports
touristRouter.get('/spots/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const [spot] = await db.select().from(touristSpots).where(eq(touristSpots.id, id)).limit(1);
    if (!spot) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // Fair prices whose destination mentions the spot name or district
    const prices = await db
      .select()
      .from(fairPrices)
      .where(
        or(
          ilike(fairPrices.destination, `%${spot.nameEn.split(' ')[0]}%`),
          eq(fairPrices.district, spot.district),
        ),
      )
      .limit(40);
    const scams = await db
      .select()
      .from(scamExamples)
      .where(
        or(
          ilike(scamExamples.destination, `%${spot.nameEn.split(' ')[0]}%`),
          ilike(scamExamples.title, `%${spot.district}%`),
        ),
      )
      .limit(20);
    const userReports = await db
      .select()
      .from(touristScamReports)
      .where(and(eq(touristScamReports.spotId, id), eq(touristScamReports.status, 'approved')))
      .orderBy(desc(touristScamReports.createdAt))
      .limit(20);
    res.json({ spot, prices, scams, userReports });
  } catch (e) {
    next(e);
  }
});

// GET /api/tourist/check?from=&to=&category= — fair price check before paying
touristRouter.get('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, category } = req.query as { from?: string; to?: string; category?: string };
    const terms = [from, to].filter((x): x is string => !!x && x.trim().length > 0);
    const conds = [];
    if (terms.length) {
      // Resolve each term through tourist_spots too (handles Bangla input like "লাবনী"
      // which matches spot nameBn but not the English price strings) -> collect districts.
      const districtSet = new Set<string>();
      for (const term of terms) {
        const q = `%${term.trim()}%`;
        const matched = await db
          .select({ district: touristSpots.district })
          .from(touristSpots)
          .where(
            or(
              ilike(touristSpots.nameEn, q),
              ilike(touristSpots.nameBn, q),
              ilike(touristSpots.district, q),
            ),
          )
          .limit(20);
        for (const m of matched) districtSet.add(m.district);
      }
      // Match ANY term against route, destination or district (forgiving: user types free text)
      const perTerm = terms.map((term) => {
        const q = `%${term.trim()}%`;
        return or(
          ilike(fairPrices.routeOrItem, q),
          ilike(fairPrices.destination, q),
          ilike(fairPrices.district, q),
        );
      });
      if (districtSet.size) {
        perTerm.push(or(...[...districtSet].map((d) => eq(fairPrices.district, d))));
      }
      conds.push(or(...perTerm));
    }
    if (category) conds.push(eq(fairPrices.category, category));
    const rows = await db
      .select()
      .from(fairPrices)
      .where(conds.length ? and(...conds) : undefined)
      .limit(20);
    // Related scam examples for the destination
    const dests = [...new Set(rows.map((r) => r.destination))];
    const scams = dests.length
      ? await db.select().from(scamExamples).where(or(...dests.map((d) => eq(scamExamples.destination, d)))).limit(10)
      : [];
    res.json({ prices: rows, scams });
  } catch (e) {
    next(e);
  }
});

const scamReportSchema = z.object({
  spot_id: z.number().int().optional(),
  place_name: z.string().min(2).max(120),
  district: z.string().min(2).max(60),
  scam_type: z.enum(['overcharge', 'fake_guide', 'hotel', 'restaurant', 'harassment', 'transport', 'other']),
  description: z.string().min(10).max(2000),
  asked_price_bdt: z.number().int().positive().optional(),
  fair_price_bdt: z.number().int().positive().optional(),
});

// POST /api/tourist/scam-reports — report a tourist scam (1-minute form)
touristRouter.post(
  '/scam-reports',
  requireAuth,
  requireProfile,
  validateBody(scamReportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof scamReportSchema>;
      const userId = req.appProfile!.id;
      const [row] = await db
        .insert(touristScamReports)
        .values({
          spotId: body.spot_id ?? null,
          placeName: body.place_name,
          district: body.district,
          scamType: body.scam_type,
          description: body.description,
          askedPriceBdt: body.asked_price_bdt ?? null,
          fairPriceBdt: body.fair_price_bdt ?? null,
          reporterId: userId,
          status: 'pending',
        })
        .returning();
      res.status(201).json({ id: row.id, status: row.status });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/tourist/scam-reports?district=&status=approved — list user reports
touristRouter.get('/scam-reports', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { district } = req.query as { district?: string };
    const conds = [eq(touristScamReports.status, 'approved')];
    if (district) conds.push(eq(touristScamReports.district, district));
    const rows = await db
      .select()
      .from(touristScamReports)
      .where(and(...conds))
      .orderBy(desc(touristScamReports.createdAt))
      .limit(40);
    res.json({ reports: rows });
  } catch (e) {
    next(e);
  }
});
