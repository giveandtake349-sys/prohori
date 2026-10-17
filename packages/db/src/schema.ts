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
  index,
  AnyPgColumn,
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
  // v16 growth: invite code, referral, onboarding, ambassador level.
  inviteCode: text('invite_code').unique(),
  invitedBy: uuid('invited_by').references((): AnyPgColumn => users.id),
  onboardingDone: boolean('onboarding_done').notNull().default(false),
  ambassadorLevel: text('ambassador_level'), // university | college | school | null
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
export const reports = pgTable(
  'reports',
  {
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
    // Nearest thana at submit time (within 25 km) — powers the thana scorecard.
    // Reports created before this column existed keep thana_id NULL; the
    // scorecard attributes those on read via nearest-thana matching.
    thanaId: uuid('thana_id').references(() => thanas.id),
    corroborationCount: integer('corroboration_count').notNull().default(0),
    // 2-tier verification (commit 7):
    //  - Tier 1 "জনতা যাচাইকৃত": 10 distinct corroborations auto-sets
    //    communityVerified (no status change — moderator seal is separate).
    //  - Tier 2 "প্রহরী যাচাইকৃত": moderator/admin sets status 'verified'.
    communityVerified: boolean('community_verified').notNull().default(false),
    communityVerifiedAt: timestamp('community_verified_at', { withTimezone: true }),
    // Accused/suspect name for sensitive cases (e.g. ধর্ষণ). Public API
    // redacts this until the OFFICIAL (tier 2) seal is applied.
    accusedName: text('accused_name'),
    // Public accountability: does the community say authorities acted?
    actionTakenCount: integer('action_taken_count').notNull().default(0),
    noActionCount: integer('no_action_count').notNull().default(0),
    // v12 report-system upgrade:
    followerCount: integer('follower_count').notNull().default(0),
    shareCount: integer('share_count').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    // 7-day police-action deadline (set when জনতা যাচাইকৃত is reached).
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    overdue: boolean('overdue').notNull().default(false),
    // Escalation ladder for overdue cases: thana | sp | dig.
    escalationLevel: text('escalation_level').notNull().default('thana'),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    // Community disputes the police-action claims (votes: disputes >= 5 and > confirms).
    disputedClaim: boolean('disputed_claim').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Geo index for the nearby crime-history lookup (GET /api/reports/nearby-summary).
  (t) => [index('reports_lat_lng_idx').on(t.lat, t.lng)],
);

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
  // Exact team location (map pin at creation). Used for nearby queries.
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  elakaText: text('elaka_text'),
  goliText: text('goli_text'),
  description: text('description'),
  // Team type: general | medical | blood | women_child | disaster | night_patrol | road
  teamType: text('team_type').notNull().default('general'),
  isActive: boolean('is_active').notNull().default(true),
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
 * SOS responses: volunteers who tapped "আমি যাচ্ছি" on an active SOS alert.
 * One response per user per SOS.
 */
export const sosResponses = pgTable(
  'sos_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sosId: uuid('sos_id')
      .notNull()
      .references(() => sosAlerts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sos_responses_sos_user_uniq').on(t.sosId, t.userId)],
);

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

/**
 * v12: votes on police-action claims ("confirm"/"dispute").
 * One vote per user per claim; if disputes >= 5 and > confirms, the report's
 * disputed_claim flag is set (penalizes the thana scorecard).
 */
export const actionClaimVotes = pgTable(
  'action_claim_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => actionClaims.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vote: text('vote').notNull(), // 'confirm' | 'dispute'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('action_claim_votes_claim_user_uniq').on(t.claimId, t.userId)],
);

/**
 * v12: "Follow case" subscriptions — followers get FCM on stage changes,
 * overdue/escalation and moderator status updates.
 */
export const reportFollowers = pgTable(
  'report_followers',
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
  (t) => [uniqueIndex('report_followers_report_user_uniq').on(t.reportId, t.userId)],
);

/** v12: follow subscriptions for missing-person entries. */
export const missingFollowers = pgTable(
  'missing_followers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missingId: uuid('missing_id')
      .notNull()
      .references(() => missingPersons.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('missing_followers_missing_user_uniq').on(t.missingId, t.userId)],
);

/**
 * Push-notification device tokens (FCM). One row per device; token is the
 * unique key so re-registering the same device just re-links the user.
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    platform: text('platform').notNull().default('android'), // android | ios | web
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/**
 * "Dabi" petitions — community pressure when a case sees no action.
 * level: thana | sp | dig (escalation ladder). status: active | escalated | closed.
 * A petition may link a report, or stand alone (e.g. a demand about an area).
 */
export const petitions = pgTable('petitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  threshold: integer('threshold').notNull().default(100),
  level: text('level').notNull().default('thana'),
  status: text('status').notNull().default('active'),
  // v12: share engagement (same smart-feed signals as reports).
  shareCount: integer('share_count').notNull().default(0),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One signature per user per petition (signing twice is a no-op). */
export const petitionSignatures = pgTable(
  'petition_signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    petitionId: uuid('petition_id')
      .notNull()
      .references(() => petitions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('petition_signatures_petition_user_uniq').on(t.petitionId, t.userId)],
);

/**
 * Moderation audit log — who did what to which report, and when.
 * action: verify | reject | request_evidence | escalate
 */
export const moderationActions = pgTable('moderation_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  moderatorId: uuid('moderator_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Missing persons board — community board for missing people.
 * contact_phone is intentionally PUBLIC: that's how a finder reaches the family.
 * status: missing | found.
 */
export const missingPersons = pgTable('missing_persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  age: integer('age'),
  gender: text('gender'), // male | female | other
  photoUrl: text('photo_url'),
  lastSeenLat: doublePrecision('last_seen_lat'),
  lastSeenLng: doublePrecision('last_seen_lng'),
  lastSeenText: text('last_seen_text'),
  lastSeenDate: timestamp('last_seen_date', { withTimezone: true }),
  contactPhone: text('contact_phone').notNull(),
  status: text('status').notNull().default('missing'),
  reporterId: uuid('reporter_id').references(() => users.id),
  foundAt: timestamp('found_at', { withTimezone: true }),
  // v12: follow/share engagement (same smart-feed signals as reports).
  followerCount: integer('follower_count').notNull().default(0),
  shareCount: integer('share_count').notNull().default(0),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Audit log for petitions (created, escalated, closed). */
export const petitionEvents = pgTable('petition_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  petitionId: uuid('petition_id')
    .notNull()
    .references(() => petitions.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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

/**
 * v16 growth tables.
 */

/** Educational institutions for campus ambassador signup (seeded). */
export const institutions = pgTable(
  'institutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    level: text('level').notNull(), // university | college | school
    district: text('district'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('institutions_name_level_uniq').on(t.name, t.level)],
);

/** Campus ambassador applications. status: pending | approved | rejected. */
export const ambassadorApplications = pgTable('ambassador_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  institutionId: uuid('institution_id').references(() => institutions.id),
  institutionName: text('institution_name').notNull(),
  level: text('level').notNull(), // university | college | school
  idPhotoUrl: text('id_photo_url'),
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Feature ideas ("ফিচার চাও?"). status: open | planned | done | rejected. */
export const featureIdeas = pgTable('feature_ideas', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  voteCount: integer('vote_count').notNull().default(0),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ideaVotes = pgTable(
  'idea_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ideaId: uuid('idea_id')
      .notNull()
      .references(() => featureIdeas.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idea_votes_idea_user_uniq').on(t.ideaId, t.userId)],
);

/** Teams that joined a case (report). min 3 members enforced at API. */
export const caseTeams = pgTable(
  'case_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => volunteerTeams.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('case_teams_report_team_uniq').on(t.reportId, t.teamId)],
);

/** Team requests for a report's exact location. status: pending | approved | rejected. */
export const locationRequests = pgTable(
  'location_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => volunteerTeams.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('location_requests_report_team_uniq').on(t.reportId, t.teamId)],
);

/** Auto-generated stories for solved cases (viral loop). */
export const caseStories = pgTable('case_stories', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => reports.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  teamCount: integer('team_count').notNull().default(0),
  memberCount: integer('member_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Referral tracking for the invite system. */
export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  inviterId: uuid('inviter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  invitedId: uuid('invited_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
export type SosResponse = typeof sosResponses.$inferSelect;
export type DeviceToken = typeof deviceTokens.$inferSelect;
export type Petition = typeof petitions.$inferSelect;
export type PetitionSignature = typeof petitionSignatures.$inferSelect;
export type PetitionEvent = typeof petitionEvents.$inferSelect;
export type ReportFollower = typeof reportFollowers.$inferSelect;
export type MissingFollower = typeof missingFollowers.$inferSelect;
export type ActionClaimVote = typeof actionClaimVotes.$inferSelect;
