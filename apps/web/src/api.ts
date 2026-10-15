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

export interface Team {
  id: string;
  name: string;
  district_id: string | null;
  thana_id: string | null;
  area_text: string | null;
  member_count: number;
  distance_km: number | null;
  created_at: string;
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
}

export function createReport(report: NewReport) {
  return post<{ tracking_id: string; id: string; status: string }>('/api/reports', report);
}

export function corroborateReport(reportId: string) {
  return post<{ corroboration_count: number; status: string }>(`/api/reports/${encodeURIComponent(reportId)}/corroborate`, {});
}

export function submitActionClaim(reportId: string, claim: 'action_taken' | 'no_action', note?: string) {
  return post<{ report_id: string; action_taken_count: number; no_action_count: number }>(
    `/api/reports/${encodeURIComponent(reportId)}/action-claim`,
    { claim, note },
  );
}

export function fetchTeams(): Promise<{ teams: Team[]; count: number }> {
  return get('/api/teams?limit=100');
}

export function fetchEmergencyContacts(teamId: string): Promise<EmergencyContacts> {
  return get(`/api/teams/${encodeURIComponent(teamId)}/emergency-contacts`);
}

export function createTeam(input: { name: string; district_id?: string; thana_id?: string; area_text?: string; emergency_phone?: string }) {
  return post<{ team: { id: string; name: string }; lead_user_id: string }>('/api/teams', input);
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
