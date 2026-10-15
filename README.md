# প্রহরী (Prohori) — MVP scaffold

Community crime-reporting app for Bangladesh. Phase 1 (core loop):
report (photo/voice-ready, anonymous) → community corroboration →
**moderator review queue** → verification → public feed + 5 km alerts,
fraud-number reporting, thana directory, police-action accountability.

## Verification workflow (user-defined)

1. Citizens submit reports (anonymous allowed).
2. Citizens corroborate ("I saw this too"). **≥3 corroborations move a report
   from `submitted` → `verifying` (the review queue) — NEVER to `verified`.**
3. The Prohori team (moderator/admin) does the REAL verification via
   `PATCH /api/admin/reports/:id/status`. Only moderator/admin roles may set
   `verified` or `rejected` (enforced in code; TODO: Supabase auth session).
4. Citizens also report police action per incident (`action_taken` /
   `no_action`) — public counters show "15 jon bolche byabostha neya hoyni".

## Monorepo

```
prohori/
├── packages/db   # Drizzle ORM schema + seed (NO RLS — auth at API layer)
├── apps/api      # Express 5 API (port 4000)
└── apps/web      # Vite + React client (port 5173)
```

## Setup

```bash
pnpm install
cp .env.example .env   # set DATABASE_URL
```

Create the database (Supabase SQL editor or psql), then:

```bash
pnpm --filter db run generate   # emit SQL migration into packages/db/drizzle
pnpm --filter db run migrate     # apply it (needs DATABASE_URL)
pnpm --filter db run seed        # seed 8 divisions + 64 districts + 5 Dhaka thanas
```

Run:

```bash
pnpm --filter api run dev    # http://localhost:4000
pnpm --filter web run dev    # http://localhost:5173
```

## Scripts per package

| package | check (typecheck) | other |
|---|---|---|
| `db` | `pnpm --filter db run check` | `generate`, `migrate`, `seed` |
| `api` | `pnpm --filter api run check` | `dev`, `start` |
| `web` | `pnpm --filter web run check` | `dev`, `build` |

## API quick reference

| Method | Route | Notes |
|---|---|---|
| POST | `/api/reports` | create report; `reporter_id: null` + `is_anonymous: true` for anonymous |
| GET | `/api/reports?lat=&lng=&radius_km=&category=&limit=` | public feed: `verified/forwarded/investigating/resolved` only |
| GET | `/api/reports/:trackingId` | report + media + status timeline (reporter hidden if anonymous) |
| POST | `/api/reports/:id/corroborate` | `{user_id}`; ≥3 → `submitted`→`verifying` (never auto-verifies) |
| POST | `/api/reports/:id/action-claim` | `{user_id, claim: 'action_taken'\|'no_action', note?}`; upsert, counters recomputed |
| POST | `/api/fraud-numbers` | `{phone_number, reporter_id?}`; verified at ≥5 reports |
| GET | `/api/fraud-numbers/check?number=` | `{is_fraud, report_count, verified}` |
| GET | `/api/thanas` | directory (seeded: Mirpur, Dhanmondi, Jatrabari, Gulshan, Tejgaon) |
| GET | `/api/geo/divisions` | all 8 divisions (EN + BN names) |
| GET | `/api/geo/districts?division_id=` | all 64 districts, filterable by division (approx. centroids) |
| GET | `/api/geo/thanas?district_id=` | thanas filtered by district |
| GET | `/api/reports?...&district_id=` | feed now also filterable by district |
| POST | `/api/teams` | `{name, district_id?, thana_id?, area_text?, created_by, emergency_phone?}` — creator becomes lead |
| POST | `/api/teams/:id/join` | `{user_id, emergency_phone}` — join as member |
| GET | `/api/teams?district_id=&thana_id=&lat=&lng=&radius_km=` | list/search teams; nearby via thana→district proxy (documented approx.) |
| GET | `/api/teams/:id/members` | roster: name + role + emergency_phone only, leads first |
| GET | `/api/teams/:id/emergency-contacts` | `{nine_one_one: "999", members: [...]}` — the red call screen |
| POST | `/api/sos` | `{user_id, lat, lng, address_text?, message?}` — broadcasts to users within 5 km + nearest-thana & nearby (10 km) teams; returns recipient counts |
| PATCH | `/api/sos/:id` | `{status: 'resolved'\\|'cancelled', user_id}` — reporter only |
| GET | `/api/sos/active?lat=&lng=&radius_km=5` | active SOS in area (reporter name, no phone numbers) |
| GET | `/api/admin/reports/queue` | moderator review queue (`verifying`, corroboration DESC) |
| PATCH | `/api/admin/reports/:id/status` | `{to_status, actor_id, note?}`; `verified`/`rejected` require moderator/admin role; `verified` creates the 5 km alert |
| GET | `/api/health` | liveness |

## Deliberately Phase 2

- Supabase auth (endpoints take `user_id`/`actor_id` in body with a TODO marker)
- PostGIS radius queries (JS haversine filter for now)
- Push/SMS delivery (SOS recipients are computed and returned; FCM/SMS fan-out not wired — see TODO in `routes/sos.ts`)
- Evidence file upload (media rows reference URLs; hashing contract `sha256` is in schema)
- Voice reports, safe-route, thana scorecard, discreet mode
- Exact team lat/lng (currently approximated from thana → district)
