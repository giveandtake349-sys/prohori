// Minimal API client. API base comes from VITE_API_URL in production
// (e.g. the Render URL), falling back to the local Express server.
export const API_BASE =
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `API ${res.status}: ${path}`);
  return data;
}

export function fetchReports(category?: string): Promise<{ reports: FeedReport[]; count: number }> {
  const q = category ? `?category=${encodeURIComponent(category)}&limit=50` : '?limit=50';
  return get(`/api/reports${q}`);
}

export function fetchReportByTrackingId(trackingId: string): Promise<ReportDetail> {
  return get(`/api/reports/${encodeURIComponent(trackingId)}`);
}

// ---- Pashe Achi teams + SOS ----

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

export function fetchTeams(): Promise<{ teams: Team[]; count: number }> {
  return get('/api/teams?limit=100');
}

export function fetchEmergencyContacts(teamId: string): Promise<EmergencyContacts> {
  return get(`/api/teams/${encodeURIComponent(teamId)}/emergency-contacts`);
}

export function sendSos(
  userId: string,
  lat: number,
  lng: number,
  message?: string,
): Promise<SosResult> {
  return post('/api/sos', {
    user_id: userId,
    lat,
    lng,
    address_text: 'ঢাকা (ডেমো অবস্থান)',
    message: message || undefined,
  });
}
