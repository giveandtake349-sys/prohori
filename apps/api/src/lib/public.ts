import { reports } from 'db';

/**
 * Columns safe for public responses. reporterId is NEVER exposed —
 * anonymous or not, the public API reveals no reporter identity.
 * Includes the police-action accountability counters.
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
} as const;

/** Reports are public immediately; the status clearly distinguishes unverified submissions. */
export const PUBLIC_STATUSES = ['submitted', 'verifying', 'verified', 'forwarded', 'investigating', 'resolved'] as const;

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
