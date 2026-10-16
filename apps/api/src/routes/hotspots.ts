import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { and, gte, eq, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { reports, users, volunteerTeams, teamMembers } from 'db';
import { requireAuth, requireProfile } from '../auth.js';
import { validateBody } from '../validate.js';
import { haversineKm } from '../lib/geo.js';
import { sendToUserIds } from '../lib/notify.js';
import { STAGE1_THRESHOLD } from '../lib/public.js';

export const hotspotsRouter = Router();

// ---------------------------------------------------------------------------
// Crime hotspot map (v13).
//
// Aggregates VERIFIED reports (stage >= 1, i.e. corroborationCount >=
// STAGE1_THRESHOLD) from the last 30 days into ~500m grid cells.
// SAFETY: only aggregate counts are exposed — never reporter identity,
// never exact report pins.
// ---------------------------------------------------------------------------

/** ~500m in degrees of latitude (longitude scaled by cos(lat) at query time). */
const CELL_DEG = 0.0045;

const RISK_HIGH = 6; // >= 6 incidents in 30d
const RISK_MEDIUM = 3; // 3-5 incidents

const CATEGORY_LABELS: Record<string, string> = {
  khun: 'খুন',
  ghum: 'গুম',
  churi: 'চুরি',
  dakati: 'ডাকাতি',
  dhorshon: 'ধর্ষণ',
  eveteasing: 'ইভটিজিং',
  madok: 'মাদক',
  durniti: 'দুর্নীতি',
  other: 'অন্যান্য',
};

export interface HotspotCell {
  lat: number;
  lng: number;
  count: number;
  risk: 'low' | 'medium' | 'high';
  riskScore: number; // 0-100
  topCategories: string[];
  topCategoryKeys: string[];
  peakHours: string; // e.g. "রাত ৯টা–১২টা"
}

function riskOf(count: number): 'low' | 'medium' | 'high' {
  if (count >= RISK_HIGH) return 'high';
  if (count >= RISK_MEDIUM) return 'medium';
  return 'low';
}

function hourLabel(h: number): string {
  // h: 0-23 → Bengali-friendly label
  const period = h >= 18 || h < 4 ? 'রাত' : h >= 4 && h < 11 ? 'সকাল' : h >= 11 && h < 16 ? 'দুপুর' : 'বিকাল';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}টা`;
}

function peakHoursLabel(hours: number[]): string {
  if (hours.length === 0) return '—';
  // 3-hour buckets; pick the most common.
  const buckets = new Map<number, number>();
  for (const h of hours) {
    const b = Math.floor(h / 3) * 3;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [b, c] of buckets) {
    if (c > bestCount) {
      bestCount = c;
      best = b;
    }
  }
  return `${hourLabel(best)}–${hourLabel((best + 3) % 24)}`;
}

interface HotspotRow {
  lat: number;
  lng: number;
  category: string;
  occurredAt: Date;
}

export async function aggregateHotspots(opts: {
  lat: number;
  lng: number;
  radiusKm: number;
  category?: string;
  time?: 'night' | 'day';
}): Promise<HotspotCell[]> {
  const { lat, lng, radiusKm, category, time } = opts;
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  // Bounding-box pre-filter (cheap), precise haversine filter in JS (MVP pattern).
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const rows = (await db
    .select({
      lat: reports.lat,
      lng: reports.lng,
      category: reports.category,
      occurredAt: reports.occurredAt,
    })
    .from(reports)
    .where(
      and(
        gte(reports.createdAt, since),
        gte(reports.corroborationCount, STAGE1_THRESHOLD),
        sql`${reports.lat} BETWEEN ${lat - latDelta} AND ${lat + latDelta}`,
        sql`${reports.lng} BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}`,
        category ? eq(reports.category, category) : undefined,
      ),
    )) as HotspotRow[];

  const inRadius = rows.filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= radiusKm);
  const timeFiltered =
    time === 'night'
      ? inRadius.filter((r) => {
          const h = r.occurredAt.getHours();
          return h >= 18 || h < 6;
        })
      : time === 'day'
        ? inRadius.filter((r) => {
            const h = r.occurredAt.getHours();
            return h >= 6 && h < 18;
          })
        : inRadius;

  // Grid into ~500m cells.
  const cells = new Map<string, { lat: number; lng: number; rows: HotspotRow[] }>();
  for (const r of timeFiltered) {
    const key = `${Math.floor(r.lat / CELL_DEG)}:${Math.floor(r.lng / CELL_DEG)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { lat: 0, lng: 0, rows: [] };
      cells.set(key, cell);
    }
    cell.rows.push(r);
  }

  const out: HotspotCell[] = [];
  for (const cell of cells.values()) {
    const n = cell.rows.length;
    const clat = cell.rows.reduce((s, r) => s + r.lat, 0) / n;
    const clng = cell.rows.reduce((s, r) => s + r.lng, 0) / n;
    const catCount = new Map<string, number>();
    const hours: number[] = [];
    for (const r of cell.rows) {
      catCount.set(r.category, (catCount.get(r.category) ?? 0) + 1);
      hours.push(r.occurredAt.getHours());
    }
    const topSorted = [...catCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const topCategories = topSorted.map(([c]) => CATEGORY_LABELS[c] ?? c);
    out.push({
      lat: clat,
      lng: clng,
      count: n,
      risk: riskOf(n),
      riskScore: Math.min(100, Math.round((n / 8) * 100)),
      topCategories,
      topCategoryKeys: topSorted.map(([c]) => c),
      peakHours: peakHoursLabel(hours),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

const hotspotsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().min(0.5).max(50).default(10),
  category: z.string().max(30).optional(),
  time: z.enum(['night', 'day']).optional(),
});

// GET /api/hotspots — aggregate crime hotspots near a point.
hotspotsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = hotspotsQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: 'invalid query', details: q.error.flatten() });
      return;
    }
    const cells = await aggregateHotspots({
      lat: q.data.lat,
      lng: q.data.lng,
      radiusKm: q.data.radius_km,
      category: q.data.category,
      time: q.data.time,
    });
    res.json({ hotspots: cells });
  } catch (e) {
    next(e);
  }
});

const notifyTeamsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_km: z.number().min(0.5).max(25).default(5),
  message: z.string().max(300).optional(),
});

// POST /api/hotspots/notify-teams — alert nearby volunteer teams about a hotspot.
hotspotsRouter.post(
  '/notify-teams',
  requireAuth,
  requireProfile,
  validateBody(notifyTeamsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as z.infer<typeof notifyTeamsSchema>;
      const teams = await db
        .select({ id: volunteerTeams.id, name: volunteerTeams.name, lat: volunteerTeams.lat, lng: volunteerTeams.lng })
        .from(volunteerTeams)
        .where(eq(volunteerTeams.isActive, true));
      const nearby = teams.filter(
        (t) => t.lat != null && t.lng != null && haversineKm(b.lat, b.lng, t.lat, t.lng) <= b.radius_km,
      );
      if (nearby.length === 0) {
        res.json({ notified: 0, teams: [] });
        return;
      }
      const memberRows = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(
          sql`${teamMembers.teamId} IN (${sql.join(
            nearby.map((t) => sql`${t.id}`),
            sql`, `,
          )})`,
        );
      const userIds = [...new Set(memberRows.map((r) => r.userId))].filter(
        (uid) => uid !== req.appProfile!.id,
      );
      const message = b.message ?? 'তোমাদের এলাকায় নতুন crime hotspot — টহলের পরিকল্পনা করো।';
      if (userIds.length > 0) {
        void sendToUserIds(userIds, {
          title: '🔴 Hotspot alert',
          body: message,
          data: { kind: 'hotspot', lat: String(b.lat), lng: String(b.lng) },
        });
      }
      res.json({ notified: userIds.length, teams: nearby.map((t) => t.name) });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Prevention alert: called when a report reaches stage 1 (verified).
// If this report just formed a NEW hotspot (cell count hit the medium
// threshold), notify users whose last known location is within 2 km.
// No dedup table — the "count === threshold" check fires exactly once per
// formation (count only grows from there until old reports age out).
// ---------------------------------------------------------------------------
export async function checkHotspotAlert(report: {
  id: string;
  lat: number;
  lng: number;
  title: string;
}): Promise<void> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const latDelta = 1 / 111; // ~1km box is plenty for a single cell check
    const lngDelta = 1 / (111 * Math.cos((report.lat * Math.PI) / 180));
    const rows = (await db
      .select({ lat: reports.lat, lng: reports.lng })
      .from(reports)
      .where(
        and(
          gte(reports.createdAt, since),
          gte(reports.corroborationCount, STAGE1_THRESHOLD),
          sql`${reports.lat} BETWEEN ${report.lat - latDelta} AND ${report.lat + latDelta}`,
          sql`${reports.lng} BETWEEN ${report.lng - lngDelta} AND ${report.lng + lngDelta}`,
        ),
      )) as { lat: number; lng: number }[];

    const key = `${Math.floor(report.lat / CELL_DEG)}:${Math.floor(report.lng / CELL_DEG)}`;
    const cellCount = rows.filter(
      (r) => `${Math.floor(r.lat / CELL_DEG)}:${Math.floor(r.lng / CELL_DEG)}` === key,
    ).length;

    // Fire only at the moment a medium hotspot forms.
    if (cellCount !== RISK_MEDIUM) return;

    const userRows = await db
      .select({ id: users.id, lastLat: users.lastLat, lastLng: users.lastLng })
      .from(users);
    const nearbyIds = userRows
      .filter(
        (u) =>
          u.lastLat != null &&
          u.lastLng != null &&
          haversineKm(report.lat, report.lng, u.lastLat, u.lastLng) <= 2,
      )
      .map((u) => u.id);
    if (nearbyIds.length === 0) return;
    void sendToUserIds(nearbyIds, {
      title: '⚠️ তোমার এলাকায় নতুন hotspot',
      body: `গত ৩০ দিনে এই এলাকায় ${cellCount}টা যাচাইকৃত ঘটনা — সতর্ক থাকো।`,
      data: { kind: 'hotspot_new', lat: String(report.lat), lng: String(report.lng) },
    });
  } catch (e) {
    console.warn('[hotspots] checkHotspotAlert failed:', (e as Error).message);
  }
}
