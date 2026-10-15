import { eq, isNull, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { reports, statusHistory, thanas } from 'db';
import { haversineKm } from './geo.js';

// ---------------------------------------------------------------------------
// Thana scorecard — public accountability per police station.
//
// SCORE FORMULA (kept deliberately simple and transparent):
//   resolution    (40%): resolved_count / eligible_reports * 100
//                         eligible = status IN (verified, forwarded, investigating, resolved)
//   actionShare   (30%): action_taken_sum / (action_taken_sum + no_action_sum) * 100
//                         (community claims: "byabostha neya hoyeche / hoyni")
//   responsiveness(30%): max(0, 100 - avg_verify_to_resolve_hours)
//                         (avg hours from first 'verified' to first 'resolved'
//                          in status_history; faster resolution → higher score)
//
// Each component is null when its data is missing. The final score is the
// weighted average over AVAILABLE components only (weights renormalized).
// If NO component has data, score is null → the UI shows "তথ্য নেই".
//
// Report attribution: reports carry thana_id (nearest thana ≤25 km, set at
// submit time). Reports created before that column existed have NULL
// thana_id — those are attributed on read via nearest-thana matching so old
// live data still counts.
// ---------------------------------------------------------------------------

export const ELIGIBLE_STATUSES = ['verified', 'forwarded', 'investigating', 'resolved'] as const;
const NEAREST_THANA_KM = 25;

export interface Scorecard {
  thana_id: string;
  thana_name: string;
  district_name: string;
  total_reports: number;
  verified_reports: number;
  action_taken_sum: number;
  no_action_sum: number;
  resolved_count: number;
  resolution_rate_pct: number | null;
  avg_verify_to_resolve_hours: number | null;
  score: number | null;
}

interface ReportLite {
  id: string;
  status: string;
  actionTakenCount: number;
  noActionCount: number;
  lat: number;
  lng: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Attribute reports to a thana: direct thana_id, plus legacy NULL rows via nearest match. */
async function reportsForThana(thanaId: string, lat: number, lng: number): Promise<ReportLite[]> {
  const direct = await db
    .select({
      id: reports.id,
      status: reports.status,
      actionTakenCount: reports.actionTakenCount,
      noActionCount: reports.noActionCount,
      lat: reports.lat,
      lng: reports.lng,
    })
    .from(reports)
    .where(eq(reports.thanaId, thanaId));

  // Legacy rows (NULL thana_id): attribute on read if this thana is nearest ≤25 km.
  const legacy = await db
    .select({
      id: reports.id,
      status: reports.status,
      actionTakenCount: reports.actionTakenCount,
      noActionCount: reports.noActionCount,
      lat: reports.lat,
      lng: reports.lng,
    })
    .from(reports)
    .where(isNull(reports.thanaId));

  if (legacy.length === 0) return direct;

  const allThanas = await db.select({ id: thanas.id, lat: thanas.lat, lng: thanas.lng }).from(thanas);
  const attributed = legacy.filter((r) => {
    let best = { id: '', d: Infinity };
    for (const t of allThanas) {
      const d = haversineKm(r.lat, r.lng, t.lat, t.lng);
      if (d < best.d) best = { id: t.id, d };
    }
    return best.id === thanaId && best.d <= NEAREST_THANA_KM;
  });
  return [...direct, ...attributed];
}

/** Avg hours from first 'verified' to first 'resolved' (per report, then averaged). */
async function avgVerifyToResolveHours(reportIds: string[]): Promise<number | null> {
  const resolvedIds = reportIds; // caller passes resolved report ids
  if (resolvedIds.length === 0) return null;
  const hist = await db
    .select({
      reportId: statusHistory.reportId,
      toStatus: statusHistory.toStatus,
      createdAt: statusHistory.createdAt,
    })
    .from(statusHistory)
    .where(inArray(statusHistory.reportId, resolvedIds));

  const byReport = new Map<string, { verifiedAt: number | null; resolvedAt: number | null }>();
  for (const h of hist) {
    let e = byReport.get(h.reportId);
    if (!e) {
      e = { verifiedAt: null, resolvedAt: null };
      byReport.set(h.reportId, e);
    }
    const t = new Date(h.createdAt).getTime();
    if (h.toStatus === 'verified' && (e.verifiedAt === null || t < e.verifiedAt)) e.verifiedAt = t;
    if (h.toStatus === 'resolved' && (e.resolvedAt === null || t < e.resolvedAt)) e.resolvedAt = t;
  }
  const hours: number[] = [];
  for (const e of byReport.values()) {
    if (e.verifiedAt !== null && e.resolvedAt !== null && e.resolvedAt >= e.verifiedAt) {
      hours.push((e.resolvedAt - e.verifiedAt) / 3600000);
    }
  }
  if (hours.length === 0) return null;
  return hours.reduce((a, b) => a + b, 0) / hours.length;
}

export function computeScore(parts: {
  eligible: number;
  resolved: number;
  actionTaken: number;
  noAction: number;
  avgHours: number | null;
}): { resolution_rate_pct: number | null; avg_verify_to_resolve_hours: number | null; score: number | null } {
  const resolution = parts.eligible > 0 ? (parts.resolved / parts.eligible) * 100 : null;
  const actionDen = parts.actionTaken + parts.noAction;
  const actionShare = actionDen > 0 ? (parts.actionTaken / actionDen) * 100 : null;
  const responsiveness = parts.avgHours !== null ? Math.max(0, 100 - parts.avgHours) : null;

  const components: Array<[number, number | null]> = [
    [0.4, resolution],
    [0.3, actionShare],
    [0.3, responsiveness],
  ];
  let wSum = 0;
  let weighted = 0;
  for (const [w, v] of components) {
    if (v !== null) {
      wSum += w;
      weighted += w * v;
    }
  }
  const score = wSum > 0 ? round1(weighted / wSum) : null;
  return {
    resolution_rate_pct: resolution !== null ? round1(resolution) : null,
    avg_verify_to_resolve_hours: parts.avgHours !== null ? round1(parts.avgHours) : null,
    score,
  };
}

export async function scorecardForThana(
  thanaId: string,
  thanaName: string,
  districtName: string,
  lat: number,
  lng: number,
): Promise<Scorecard> {
  const reps = await reportsForThana(thanaId, lat, lng);
  const eligible = reps.filter((r) => (ELIGIBLE_STATUSES as readonly string[]).includes(r.status));
  const resolved = eligible.filter((r) => r.status === 'resolved');
  const actionTaken = eligible.reduce((a, r) => a + r.actionTakenCount, 0);
  const noAction = eligible.reduce((a, r) => a + r.noActionCount, 0);
  const avgHours = await avgVerifyToResolveHours(resolved.map((r) => r.id));
  const { resolution_rate_pct, avg_verify_to_resolve_hours, score } = computeScore({
    eligible: eligible.length,
    resolved: resolved.length,
    actionTaken,
    noAction,
    avgHours,
  });
  return {
    thana_id: thanaId,
    thana_name: thanaName,
    district_name: districtName,
    total_reports: reps.length,
    verified_reports: eligible.length,
    action_taken_sum: actionTaken,
    no_action_sum: noAction,
    resolved_count: resolved.length,
    resolution_rate_pct,
    avg_verify_to_resolve_hours,
    score,
  };
}
