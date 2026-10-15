import { supabase, API_BASE } from './supabaseClient';

export interface AppProfile {
  id: string;
  name: string;
  phone: string;
  role: string;
}

export interface FeedReport {
  id: string;
  trackingId: string;
  category: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  addressText: string;
  occurredAt: string;
  isAnonymous: boolean;
  status: string;
  corroborationCount: number;
  actionTakenCount: number;
  noActionCount: number;
  createdAt: string;
  verificationTier: 'none' | 'community' | 'official';
  accusedName: string | null;
}

export interface MediaItem {
  url: string;
  sha256: string;
  capturedAt: string | null;
}

export interface HistoryItem {
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

export interface ReportDetail {
  report: FeedReport;
  media: MediaItem[];
  history: HistoryItem[];
}

export const TEAM_TYPES = [
  'general',
  'medical',
  'blood',
  'women_child',
  'disaster',
  'night_patrol',
  'road',
] as const;
export type TeamType = (typeof TEAM_TYPES)[number];

export const TEAM_TYPE_META: Record<TeamType, { emoji: string; bn: string }> = {
  general: { emoji: '🛡️', bn: 'সাধারণ' },
  medical: { emoji: '🏥', bn: 'মেডিকেল' },
  blood: { emoji: '🩸', bn: 'রক্তদান' },
  women_child: { emoji: '👩‍👧', bn: 'নারী ও শিশু' },
  disaster: { emoji: '🌊', bn: 'দুর্যোগ' },
  night_patrol: { emoji: '🌙', bn: 'নাইট প্যাট্রল' },
  road: { emoji: '🚗', bn: 'সড়ক দুর্ঘটনা' },
};

export interface Team {
  id: string;
  name: string;
  district_id: string | null;
  thana_id: string | null;
  area_text: string | null;
  elaka_text: string | null;
  goli_text: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  team_type: TeamType;
  is_active: boolean;
  member_count: number;
  distance_km: number | null;
  created_at: string;
  district_name?: string | null;
  thana_name?: string | null;
}

export interface TeamDetail {
  team: Team;
  roster: { user_id: string; name: string; role: string; joined_at: string }[];
}

export interface TeamMember {
  user_id: string;
  name: string;
  role: string;
  emergency_phone: string;
  joined_at: string;
}

export interface EmergencyContacts {
  team_id: string;
  team_name: string;
  nine_one_one: string;
  members: TeamMember[];
}

export interface SosResult {
  sos_id: string;
  status: string;
  notified_user_count: number;
  notified_teams: Array<{ id: string; name: string; member_count: number }>;
}

export interface Division {
  id: string;
  name_en: string;
  name_bn: string;
}

export interface District {
  id: string;
  division_id: string;
  name_en: string;
  name_bn: string;
  lat: number | null;
  lng: number | null;
}

export interface Thana {
  id: string;
  name: string;
  district: string;
  district_id: string | null;
  lat: number;
  lng: number;
}

export interface FraudCheck {
  is_fraud: boolean;
  report_count: number;
  verified: boolean;
}

export interface ModerationQueue {
  queue: FeedReport[];
  count: number;
  scope: 'pending' | 'all';
  nextOffset: number | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) {
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `API ${response.status}`);
  }
  return body as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export function fetchProfile() {
  return get<{ auth: { id: string; email: string | null }; profile: AppProfile | null }>('/api/auth/me');
}

export function saveProfile(name: string, phone: string) {
  return post<{ profile: AppProfile }>('/api/auth/profile', { name, phone });
}

export function fetchReports(category?: string): Promise<{ reports: FeedReport[]; count: number }> {
  const query = new URLSearchParams({ limit: '50' });
  if (category) query.set('category', category);
  return get(`/api/reports?${query.toString()}`);
}

export function fetchReportByTrackingId(trackingId: string): Promise<ReportDetail> {
  return get(`/api/reports/${encodeURIComponent(trackingId)}`);
}

export interface NewReport {
  category: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  address_text: string;
  occurred_at?: string;
  is_anonymous: boolean;
  district_id?: string | null;
  accused_name?: string | null;
}

export function createReport(report: NewReport) {
  return post<{ tracking_id: string; id: string; status: string }>('/api/reports', report);
}

export function corroborateReport(reportId: string) {
  return post<{ corroboration_count: number; status: string; community_verified: boolean; verification_tier?: string }>(`/api/reports/${encodeURIComponent(reportId)}/corroborate`, {});
}

export function submitActionClaim(reportId: string, claim: 'action_taken' | 'no_action', note?: string) {
  return post<{ report_id: string; action_taken_count: number; no_action_count: number }>(
    `/api/reports/${encodeURIComponent(reportId)}/action-claim`,
    { claim, note },
  );
}

export function fetchTeams(params?: { type?: string; search?: string; district_id?: string; thana_id?: string }): Promise<{ teams: Team[]; count: number }> {
  const q = new URLSearchParams({ limit: '50' });
  if (params?.type) q.set('type', params.type);
  if (params?.search) q.set('search', params.search);
  if (params?.district_id) q.set('district_id', params.district_id);
  if (params?.thana_id) q.set('thana_id', params.thana_id);
  return get(`/api/teams?${q.toString()}`);
}

export function fetchTeamsNearby(lat: number, lng: number, radiusKm = 8, type?: string): Promise<{ teams: Team[]; count: number }> {
  const q = new URLSearchParams({ lat: String(lat), lng: String(lng), radius_km: String(radiusKm) });
  if (type) q.set('type', type);
  return get(`/api/teams/nearby?${q.toString()}`);
}

export function fetchTeamDetail(teamId: string): Promise<TeamDetail> {
  return get(`/api/teams/${encodeURIComponent(teamId)}`);
}

export function fetchEmergencyContacts(teamId: string): Promise<EmergencyContacts> {
  return get(`/api/teams/${encodeURIComponent(teamId)}/emergency-contacts`);
}

export function createTeam(input: {
  name: string;
  district_id: string;
  thana_id: string;
  elaka_text: string;
  goli_text?: string;
  lat: number;
  lng: number;
  description?: string;
  team_type: TeamType;
  emergency_phone: string;
}) {
  return post<{ team: { id: string; name: string }; lead_user_id: string }>('/api/teams', input);
}

export function leaveTeam(teamId: string) {
  return del<{ left: boolean }>(`/api/teams/${encodeURIComponent(teamId)}/leave`);
}

export function removeTeamMember(teamId: string, userId: string) {
  return del<{ removed: boolean }>(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
}

export function joinTeam(teamId: string, emergencyPhone: string) {
  return post<{ team_id: string; user_id: string; role: string }>(
    `/api/teams/${encodeURIComponent(teamId)}/join`,
    { emergency_phone: emergencyPhone },
  );
}

export function sendSos(lat: number, lng: number, addressText: string, message?: string) {
  return post<SosResult>('/api/sos', {
    lat,
    lng,
    address_text: addressText,
    message: message || undefined,
  });
}

export function fetchActiveSos(lat: number, lng: number) {
  const query = new URLSearchParams({ lat: String(lat), lng: String(lng), radius_km: '10' });
  return get<{ sos: Array<{ id: string; message: string | null; reporter_name: string; created_at: string; distance_km: number }>; count: number }>(`/api/sos/active?${query.toString()}`);
}

export function fetchDivisions() {
  return get<{ divisions: Division[]; count: number }>('/api/geo/divisions');
}

export function fetchDistricts(divisionId?: string) {
  const query = divisionId ? `?division_id=${encodeURIComponent(divisionId)}` : '';
  return get<{ districts: District[]; count: number }>(`/api/geo/districts${query}`);
}

export function fetchThanas(districtId?: string) {
  const query = districtId ? `?district_id=${encodeURIComponent(districtId)}` : '';
  return get<{ thanas: Thana[]; count: number }>(`/api/geo/thanas${query}`);
}

export function checkFraudNumber(number: string) {
  return get<FraudCheck>(`/api/fraud-numbers/check?number=${encodeURIComponent(number)}`);
}

export function reportFraudNumber(phoneNumber: string) {
  return post<{ phone_number: string; report_count: number; verified: boolean }>('/api/fraud-numbers', {
    phone_number: phoneNumber,
  });
}

export function fetchModerationQueue(scope: 'pending' | 'all' = 'pending', offset = 0) {
  const query = new URLSearchParams({ scope, offset: String(offset), limit: '100' });
  return get<ModerationQueue>(`/api/admin/reports/queue?${query.toString()}`);
}

export function moderateReport(reportId: string, toStatus: string, note?: string) {
  return patch<{ id: string; tracking_id: string; status: string }>(
    `/api/admin/reports/${encodeURIComponent(reportId)}/status`,
    { to_status: toStatus, note },
  );
}

// ---- Thana scorecard (public) ----

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

export interface ScorecardDetail extends Scorecard {
  recent_reports: Array<{ tracking_id: string; title: string; status: string; created_at: string }>;
}

export function fetchScorecards(): Promise<{ scorecards: Scorecard[]; count: number }> {
  return get('/api/thanas/scorecard');
}

export function fetchThanaScorecard(id: string): Promise<ScorecardDetail> {
  return get(`/api/thanas/${encodeURIComponent(id)}/scorecard`);
}

// ---- FCM device registration (signed-in user only) ----

export function registerDeviceToken(token: string, platform: 'android' | 'ios' | 'web'): Promise<{ ok: boolean }> {
  return post('/api/devices/register', { token, platform });
}

// ---- Dabi petitions ----

export interface Petition {
  id: string;
  title: string;
  description: string;
  threshold: number;
  level: string;
  status: string;
  created_at: string;
  signature_count: number;
  progress_pct: number;
  report: { tracking_id: string; title: string } | null;
}

export function fetchPetitions(): Promise<{ petitions: Petition[]; count: number }> {
  return get('/api/petitions');
}

export function createPetition(input: {
  title: string;
  description: string;
  threshold?: number;
  report_id?: string;
}): Promise<Petition> {
  return post('/api/petitions', input);
}

// Signed-in user signs; no user id in the body — the server reads the token.
export function signPetition(id: string): Promise<{ petition_id: string; signature_count: number }> {
  return post(`/api/petitions/${encodeURIComponent(id)}/sign`, {});
}

export interface PetitionShare {
  petition_id: string;
  threshold_reached: boolean;
  signature_count: number;
  threshold: number;
  share_text: string;
  share_url: string;
}

export function fetchPetitionShare(id: string): Promise<PetitionShare> {
  return get(`/api/petitions/${encodeURIComponent(id)}/share`);
}

// ---- Nearby summary (public, verified-only 30d/1km) ----

export interface NearbySummary {
  lat: number;
  lng: number;
  radius_km: number;
  days: number;
  total: number;
  by_category: Record<string, number>;
}

export function fetchNearbySummary(lat: number, lng: number): Promise<NearbySummary> {
  return get(`/api/reports/nearby-summary?lat=${lat}&lng=${lng}`);
}

// ---- Missing persons ----

export interface MissingPerson {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  photo_url: string | null;
  last_seen_lat: number | null;
  last_seen_lng: number | null;
  last_seen_text: string | null;
  last_seen_date: string | null;
  contact_phone: string;
  status: string;
  found_at: string | null;
  created_at: string;
}

export function fetchMissingPersons(status = 'missing'): Promise<{
  persons: MissingPerson[];
  count: number;
  counts: { missing: number; found: number };
}> {
  return get(`/api/missing?status=${encodeURIComponent(status)}`);
}

export function createMissingPerson(input: {
  name: string;
  age?: number | null;
  gender?: string | null;
  photo_url?: string | null;
  last_seen_lat?: number | null;
  last_seen_lng?: number | null;
  last_seen_text?: string | null;
  last_seen_date?: string | null;
  contact_phone: string;
}): Promise<MissingPerson> {
  return post('/api/missing', input);
}

export function markMissingFound(id: string): Promise<MissingPerson> {
  return post(`/api/missing/${encodeURIComponent(id)}/found`, {});
}

// ---- Trends (public) ----

export interface TrendsWeek {
  week_start: string;
  total: number;
  counts: Record<string, number>;
}

export interface TrendsDistrict {
  district_id: string | null;
  district_name: string | null;
  count: number;
}

export interface Trends {
  weeks: number;
  by_week: TrendsWeek[];
  by_district: TrendsDistrict[];
  verification_rate_pct: number | null;
  resolution_rate_pct: number | null;
  pipeline_total: number;
}

export function fetchTrends(): Promise<Trends> {
  return get('/api/stats/trends');
}

// ---- Shareable case page ----

export function caseShareUrl(trackingId: string): string {
  return `${API_BASE}/share/case/${encodeURIComponent(trackingId)}`;
}

// ---- Moderation (signed-in moderators; server checks role) ----

export interface ModerationStats {
  pending: number;
  verified_today: number;
  rejected_today: number;
  avg_verify_hours: number | null;
}

export interface ReportHistory {
  report_id: string;
  tracking_id: string;
  status: string;
  verification_tier: 'none' | 'community' | 'official';
  accused_name: string | null;
  status_history: Array<{ fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
  moderation_actions: Array<{ action: string; reason: string | null; createdAt: string; moderatorName: string | null }>;
}

export function fetchModerationStats(): Promise<ModerationStats> {
  return get('/api/admin/reports/stats');
}

export function fetchReportHistory(id: string): Promise<ReportHistory> {
  return get(`/api/admin/reports/${encodeURIComponent(id)}/history`);
}

// ---- Admin: user role management ----

export interface AdminUser {
  id: string;
  name: string;
  phone: string;
  role: string;
  trustScore: number;
  createdAt: string;
}

export function fetchAdminUsers(): Promise<{ users: AdminUser[]; count: number }> {
  return get('/api/admin/users?limit=200');
}

export function setUserRole(id: string, role: 'citizen' | 'volunteer' | 'moderator'): Promise<AdminUser> {
  return patch(`/api/admin/users/${encodeURIComponent(id)}/role`, { role });
}
