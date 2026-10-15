import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  numeric,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Prohori — Phase 1 (core loop) schema.
// Convention: NO RLS on any table. The backend connects directly to Postgres
// and all authorization is enforced at the API (tRPC/Express) layer.
// ---------------------------------------------------------------------------

/** App users. role: citizen | volunteer | moderator | admin */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  name: text('name').notNull(),
  trustScore: integer('trust_score').notNull().default(50),
  role: text('role').notNull().default('citizen'),
  // Home location hierarchy (set when the user picks division/district/thana).
  districtId: uuid('district_id').references(() => districts.id),
  thanaId: uuid('thana_id').references(() => thanas.id),
  // Last known position (updated whenever the app reports location).
  // Used for SOS broadcast targeting — never exposed publicly.
  lastLat: doublePrecision('last_lat'),
  lastLng: doublePrecision('last_lng'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Bangladesh administrative hierarchy: 8 divisions, 64 districts.
 * District lat/lng are APPROXIMATE centroids (good enough for MVP
 * proximity; Phase 2 can use PostGIS boundaries).
 */
export const divisions = pgTable('divisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameEn: text('name_en').notNull().unique(),
  nameBn: text('name_bn').notNull(),
});

export const districts = pgTable('districts', {
  id: uuid('id').primaryKey().defaultRandom(),
  divisionId: uuid('division_id')
    .notNull()
    .references(() => divisions.id),
  nameEn: text('name_en').notNull().unique(),
  nameBn: text('name_bn').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
});

/**
 * Crime reports.
 * category: khun | ghum | churi | dakati | dhorshon | eveteasing | madok | durniti | other
 * status: submitted | verifying | verified | forwarded | investigating | resolved | rejected
 * reporterId is NULL for anonymous reports — the public API never exposes it.
 */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  trackingId: text('tracking_id').notNull().unique(),
  reporterId: uuid('reporter_id').references(() => users.id),
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  addressText: text('address_text').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  status: text('status').notNull().default('submitted'),
  // Denormalized for cheap filtering (set from the incident location at submit).
  districtId: uuid('district_id').references(() => districts.id),
  corroborationCount: integer('corroboration_count').notNull().default(0),
  // Public accountability: does the community say authorities acted?
  actionTakenCount: integer('action_taken_count').notNull().default(0),
  noActionCount: integer('no_action_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Evidence attached to a report. sha256 is recorded at upload time so the
 * file can later be proven untampered (tamper-proof evidence chain).
 */
export const reportMedia = pgTable('report_media', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  sha256: text('sha256').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
});

/** Community corroboration ("I saw this too"). One per user per report. */
export const corroborations = pgTable(
  'corroborations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('corroborations_report_user_uniq').on(t.reportId, t.userId)],
);

/** Reported scam/fraud phone numbers (bKash/Nagad OTP fraud etc.). */
export const fraudNumbers = pgTable('fraud_numbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumber: text('phone_number').notNull().unique(),
  reportCount: integer('report_count').notNull().default(1),
  verified: boolean('verified').notNull().default(false),
  lastReportedAt: timestamp('last_reported_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Police stations (thanas) for the directory + case forwarding. */
export const thanas = pgTable('thanas', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  district: text('district').notNull(),
  districtId: uuid('district_id').references(() => districts.id),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
});

/**
 * "Pashe Achi" volunteer teams — citizens form a team for their
 * moholla/area; all members stay connected through the app.
 * role: lead | member
 */
export const volunteerTeams = pgTable('volunteer_teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  districtId: uuid('district_id').references(() => districts.id),
  thanaId: uuid('thana_id').references(() => thanas.id),
  areaText: text('area_text'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => volunteerTeams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    // Emergency contact number for THIS member (shown on the team's
    // emergency-contacts screen; may differ from their account phone).
    emergencyPhone: text('emergency_phone').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('team_members_team_user_uniq').on(t.teamId, t.userId)],
);

/**
 * Emergency SOS broadcasts. status: active | resolved | cancelled.
 * Recipients are computed at creation (nearby users + nearby volunteer
 * teams); actual push/SMS fan-out is Phase 2.
 */
export const sosAlerts = pgTable('sos_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  addressText: text('address_text'),
  message: text('message'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Police-action claims by citizens: "byabostha neya hoyeche / hoyni".
 * claim: 'action_taken' | 'no_action'. One claim per user per report
 * (users can change their claim; counts are recomputed on every write).
 */
export const actionClaims = pgTable(
  'action_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    claim: text('claim').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('action_claims_report_user_uniq').on(t.reportId, t.userId)],
);

/** A broadcast alert created for a verified report (default 5 km radius). */
export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  radiusKm: numeric('radius_km').notNull().default('5'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Audit trail of every status change — powers the public tracking timeline. */
export const statusHistory = pgTable('status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Inferred row types ----
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type ReportMedia = typeof reportMedia.$inferSelect;
export type Corroboration = typeof corroborations.$inferSelect;
export type FraudNumber = typeof fraudNumbers.$inferSelect;
export type Thana = typeof thanas.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type StatusHistory = typeof statusHistory.$inferSelect;
export type Division = typeof divisions.$inferSelect;
export type District = typeof districts.$inferSelect;
export type VolunteerTeam = typeof volunteerTeams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type SosAlert = typeof sosAlerts.$inferSelect;
