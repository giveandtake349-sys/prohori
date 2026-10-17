import { reports } from 'db';

/**
 * Columns safe for public responses. reporterId is NEVER exposed —
 * anonymous or not, the public API reveals no reporter identity.
 */
export const publicReportColumns = {
  id: reports.id,
  trackingId: reports.trackingId,
  category: reports.category,
  title: reports.title,
  description: reports.description,
  lat: reports.lat,
  lng: reports.lng,
  addressText: reports.addressText,
  occurredAt: reports.occurredAt,
  isAnonymous: reports.isAnonymous,
  status: reports.status,
  districtId: reports.districtId,
  corroborationCount: reports.corroborationCount,
  actionTakenCount: reports.actionTakenCount,
  noActionCount: reports.noActionCount,
  createdAt: reports.createdAt,
  communityVerified: reports.communityVerified,
  communityVerifiedAt: reports.communityVerifiedAt,
  accusedName: reports.accusedName,
  followerCount: reports.followerCount,
  viewCount: reports.viewCount,
  shareCount: reports.shareCount,
  lastActivityAt: reports.lastActivityAt,
  deadlineAt: reports.deadlineAt,
  overdue: reports.overdue,
  escalationLevel: reports.escalationLevel,
  escalatedAt: reports.escalatedAt,
  disputedClaim: reports.disputedClaim,
} as const;

/** Official seal statuses are only set by an authenticated moderator/admin. */
export const OFFICIAL_STATUSES = ['verified', 'forwarded', 'investigating', 'resolved'] as const;

/** Reports are public immediately; rejected reports are removed from the feed. */
export const PUBLIC_STATUSES = ['submitted', 'verifying', ...OFFICIAL_STATUSES] as const;

export type VerificationTier = 'none' | 'community' | 'official';
export const COMMUNITY_VERIFY_THRESHOLD = 10; // legacy flat threshold (kept for compat)

/**
 * v12 STAGED VERIFICATION — how far a case has travelled through the
 * public pipeline. Stage 0 = fresh submission, Stage 1 = প্রাথমিক যাচাই
 * (2 corroborations — first real signal), Stage 2 = জনতা যাচাইকৃত
 * (category-wise community threshold), Stage 3 = প্রহরী যাচাইকৃত
 * (official moderator/admin seal). Reaching Stage 2 starts the 7-day
 * police-action deadline (deadlineAt) — Stage 3 (official seal) stands
 * separately, as before.
 */
export const STAGE1_THRESHOLD = 2;

export const COMMUNITY_THRESHOLDS: Record<string, number> = {
  khun: 7,
  dhorshon: 7,
  ghum: 7,
  dakati: 5,
  churi: 3,
  eveteasing: 3,
  madok: 3,
  durniti: 3,
  other: 3,
};

export function stageThresholdFor(category: string): number {
  return COMMUNITY_THRESHOLDS[category] ?? COMMUNITY_THRESHOLDS['other']!;
}

export function verificationStageOf(row: {
  status: string;
  communityVerified: boolean;
  corroborationCount: number;
  category: string;
}): 0 | 1 | 2 | 3 {
  if ((OFFICIAL_STATUSES as readonly string[]).includes(row.status)) return 3;
  if (row.communityVerified) return 2;
  if (row.corroborationCount >= STAGE1_THRESHOLD) return 1;
  return 0;
}

export function verificationTierOf(row: { status: string; communityVerified: boolean }): VerificationTier {
  if ((OFFICIAL_STATUSES as readonly string[]).includes(row.status)) return 'official';
  if (row.communityVerified) return 'community';
  return 'none';
}

/** Redact sensitive accused names until the official seal is applied. */
export function toPublicReport<
  T extends {
    status: string;
    communityVerified: boolean;
    corroborationCount: number;
    category: string;
    accusedName: string | null;
  },
>(row: T) {
  const tier = verificationTierOf(row);
  return {
    ...row,
    accusedName: tier === 'official' ? row.accusedName : null,
    verificationTier: tier,
    verificationStage: verificationStageOf(row),
    stageThreshold: stageThresholdFor(row.category),
  };
}

export const ALL_STATUSES = [
  'submitted',
  'verifying',
  'verified',
  'forwarded',
  'investigating',
  'resolved',
  'rejected',
] as const;

export const CATEGORIES = [
  'khun',
  'ghum',
  'churi',
  'dakati',
  'dhorshon',
  'eveteasing',
  'madok',
  'durniti',
  'other',
] as const;
