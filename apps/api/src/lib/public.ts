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
} as const;

/** Official seal statuses are only set by an authenticated moderator/admin. */
export const OFFICIAL_STATUSES = ['verified', 'forwarded', 'investigating', 'resolved'] as const;

/** Reports are public immediately; rejected reports are removed from the feed. */
export const PUBLIC_STATUSES = ['submitted', 'verifying', ...OFFICIAL_STATUSES] as const;

export type VerificationTier = 'none' | 'community' | 'official';
export const COMMUNITY_VERIFY_THRESHOLD = 10;

export function verificationTierOf(row: { status: string; communityVerified: boolean }): VerificationTier {
  if ((OFFICIAL_STATUSES as readonly string[]).includes(row.status)) return 'official';
  if (row.communityVerified) return 'community';
  return 'none';
}

/** Redact sensitive accused names until the official seal is applied. */
export function toPublicReport<T extends { status: string; communityVerified: boolean; accusedName: string | null }>(row: T) {
  const tier = verificationTierOf(row);
  return {
    ...row,
    accusedName: tier === 'official' ? row.accusedName : null,
    verificationTier: tier,
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
