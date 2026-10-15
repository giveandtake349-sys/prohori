import { Router, type Request, type Response, type NextFunction } from 'express';
import { ne } from 'drizzle-orm';
import { db } from '../db.js';
import { reports, districts } from 'db';
import { OFFICIAL_STATUSES } from '../lib/public.js';

export const statsRouter = Router();

const WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/stats/trends — public crime-trend dashboard data.
 * - by_week: last 12 full 7-day buckets (verified pipeline only), per-category counts
 * - by_district: top 10 districts by verified-pipeline volume (12 weeks)
 * - verification_rate_pct: % of non-rejected reports that reached the verified pipeline
 * - resolution_rate_pct: % of verified-pipeline reports that are resolved
 */
statsRouter.get('/trends', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        status: reports.status,
        category: reports.category,
        occurredAt: reports.occurredAt,
        districtId: reports.districtId,
      })
      .from(reports)
      .where(ne(reports.status, 'rejected'))
      .limit(10000);

    const now = Date.now();
    const windowStart = now - WEEKS * 7 * DAY_MS;

    // District names for the top-10 list.
    const distRows = await db.select({ id: districts.id, name: districts.nameBn }).from(districts);
    const distName = new Map(distRows.map((d) => [d.id, d.name]));

    const byWeek: Array<{ week_start: string; total: number; counts: Record<string, number> }> = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const start = windowStart + (WEEKS - 1 - w) * 7 * DAY_MS;
      const end = start + 7 * DAY_MS;
      const counts: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        if (!(OFFICIAL_STATUSES as readonly string[]).includes(r.status)) continue;
        const t = new Date(r.occurredAt).getTime();
        if (t < start || t >= end) continue;
        counts[r.category] = (counts[r.category] ?? 0) + 1;
        total++;
      }
      byWeek.push({ week_start: new Date(start).toISOString().slice(0, 10), total, counts });
    }

    const distCounts = new Map<string | null, number>();
    for (const r of rows) {
      if (!(OFFICIAL_STATUSES as readonly string[]).includes(r.status)) continue;
      if (new Date(r.occurredAt).getTime() < windowStart) continue;
      distCounts.set(r.districtId, (distCounts.get(r.districtId) ?? 0) + 1);
    }
    const byDistrict = [...distCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([districtId, count]) => ({
        district_id: districtId,
        district_name: districtId ? (distName.get(districtId) ?? null) : null,
        count,
      }));

    const pipeline = rows.filter((r) => (OFFICIAL_STATUSES as readonly string[]).includes(r.status));
    const resolved = pipeline.filter((r) => r.status === 'resolved');
    const verificationRate = rows.length === 0 ? null : Math.round((pipeline.length / rows.length) * 100);
    const resolutionRate = pipeline.length === 0 ? null : Math.round((resolved.length / pipeline.length) * 100);

    res.json({
      weeks: WEEKS,
      by_week: byWeek,
      by_district: byDistrict,
      verification_rate_pct: verificationRate,
      resolution_rate_pct: resolutionRate,
      pipeline_total: pipeline.length,
    });
  } catch (e) {
    next(e);
  }
});
