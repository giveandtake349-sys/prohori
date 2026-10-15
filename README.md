# প্রহরী (Prohori)

বাংলাদেশের community safety ও crime-reporting MVP। Prohori-তে report submit হলেই public feed-এ প্রকাশিত হয়; moderator/admin পরে report verify, status বা note update করতে পারেন এবং reject করলে public feed থেকে সরাতে পারেন।

> **জরুরি বিপদে অ্যাপের বদলে ৯৯৯-এ কল করুন।** Prohori-র SOS বর্তমানে database record ও nearby recipient গণনা করে; SMS বা mobile push fan-out এখনো যুক্ত নয়।

## Live system

- Website: <https://prohori-teal.vercel.app>
- API: <https://prohori-api-m52n.onrender.com>
- Health: <https://prohori-api-m52n.onrender.com/api/health>
- GitHub: <https://github.com/giveandtake349-sys/prohori>
- Production database: Prohori-র আলাদা Supabase project; অন্য কোনো Supabase project-এর সঙ্গে মেশানো যাবে না।

## Monorepo

```text
prohori/
├── packages/db   # Drizzle schema, migrations ও Bangladesh geo seed
├── apps/api      # Express 5 + TypeScript REST API (port 4000)
└── apps/web      # Vite + React + TypeScript client (port 5173)
```

## Product behavior

1. Authenticated user category, title, details ও Bangladesh location দিয়ে report জমা দেন; anonymous mode reporter identity লুকায়, content/location নয়।
2. Submit হলেই report `submitted` status-এ public হয় এবং card-এ `প্রকাশিত · যাচাই বাকি` দেখায়। `submitted` বা `verifying` কখনো moderator-verified দাবি নয়।
3. Community corroboration-এর threshold পেরোলে status `verifying` হতে পারে, কিন্তু report public-ই থাকে।
4. Moderator/admin pending queue বা সব report-এর তালিকা থেকে status (`verified`, `forwarded`, `investigating`, `resolved`, `rejected` ইত্যাদি) বদলাতে ও note দিতে পারেন। `rejected` report public feed-এ থাকে না।
5. Reporter tracking ID দিয়ে Track page-এ বর্তমান status, status transition ও moderator note দেখতে পারেন; history প্রতি ৩০ সেকেন্ডে refresh হয়। এটি in-app update feed—email, push বা SMS notification নয়।

## Authentication ও permissions

- Supabase Auth email/password এবং Google OAuth flow ব্যবহৃত হয়।
- Protected API request-এ Supabase Bearer token লাগে; body-র `user_id`, `reporter_id` বা `actor_id` identity প্রমাণ হিসেবে গ্রহণ করা হয় না।
- নতুন account-এর role `citizen`; moderator/admin page-এর জন্য Prohori database-এ role পরিবর্তন দরকার। বিস্তারিত setup দেখুন [`AUTH_SETUP.md`](./AUTH_SETUP.md)।
- Browser-এ Supabase publishable key থাকা স্বাভাবিক; service-role key কখনো frontend বা GitHub-এ রাখবেন না।

## Setup

Node.js 22 এবং pnpm 10 ব্যবহার করুন:

```bash
pnpm install
cp .env.example .env
# .env-এ local বা Prohori-only values বসান; কোনো secret commit করবেন না
```

Database migration ও seed-এর জন্য সঠিক Prohori `DATABASE_URL` ব্যবহার করুন:

```bash
pnpm --filter db run generate
pnpm --filter db run migrate
pnpm --filter db run seed
```

চেক ও build:

```bash
pnpm --filter db run check
pnpm --filter api run check
pnpm --filter web run check
pnpm --filter db run generate
pnpm --filter web run build
```

Local run:

```bash
pnpm --filter api run dev    # http://localhost:4000
pnpm --filter web run dev    # http://localhost:5173
```

Typecheck-এর জন্য package script ব্যবহার করুন; bare `tsc --noEmit` ব্যবহার করবেন না। `db generate` schema comparison করে, নিজে SQL apply করে না।

## Environment variables

API/Render:

- `DATABASE_URL`
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Frontend/Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL`

Template: [`.env.example`](./.env.example)। Local `.env`, database credentials, Google Client Secret, service-role key বা access token commit করবেন না।

## API quick reference

API prefix `/api`; protected route-এ Supabase Bearer token লাগে।

| Method | Route | কাজ / access |
|---|---|---|
| `GET` | `/api/health` | Public health check |
| `GET` | `/api/auth/me` | Verified session ও Prohori profile |
| `POST` | `/api/auth/profile` | Authenticated profile create/update |
| `POST` | `/api/reports` | Authenticated report submit; সঙ্গে সঙ্গে public |
| `GET` | `/api/reports?category=&district_id=&lat=&lng=&radius_km=&limit=` | Public report feed |
| `GET` | `/api/reports/:trackingId` | Public tracking ID দিয়ে report ও history |
| `POST` | `/api/reports/:id/corroborate` | Authenticated community corroboration |
| `POST` | `/api/reports/:id/action-claim` | `action_taken` / `no_action` claim |
| `GET` | `/api/admin/reports/queue?scope=pending\|all&limit=100&offset=0` | Moderator/admin queue বা সব report |
| `PATCH` | `/api/admin/reports/:id/status` | Status change বা note-only update |
| `GET` | `/api/geo/divisions` | ৮ division |
| `GET` | `/api/geo/districts?division_id=` | District list/filter |
| `GET` | `/api/geo/thanas?district_id=` | Thana list/filter |
| `POST` | `/api/fraud-numbers` | Authenticated fraud-number report |
| `GET` | `/api/fraud-numbers/check?number=` | Public number lookup |
| `POST` | `/api/teams` | Authenticated team create |
| `POST` | `/api/teams/:id/join` | Authenticated team join |
| `GET` | `/api/teams` | Team search/list |
| `GET` | `/api/teams/:id/members` | Authenticated roster |
| `GET` | `/api/teams/:id/emergency-contacts` | Team members-এর জন্য contacts |
| `POST` | `/api/sos` | Authenticated SOS record ও recipient গণনা |
| `PATCH` | `/api/sos/:id` | Reporter-owned SOS status change |
| `GET` | `/api/sos/active?lat=&lng=&radius_km=` | Authenticated nearby active SOS |

Implementation locations:

- Public status set: `apps/api/src/lib/public.ts`
- Reports/feed/tracking/history: `apps/api/src/routes/reports.ts`
- Moderator queue/status/history: `apps/api/src/routes/admin.ts`
- Auth verification: `apps/api/src/auth.ts`
- Web pages: `apps/web/src/FeaturePages.tsx`
- Status labels: `apps/web/src/labels.ts`
- Drizzle schema: `packages/db/src/schema.ts`

## MVP limitations

- SOS recipient গণনা হয়, কিন্তু SMS/mobile push delivery নেই।
- Media metadata schema/API-তে থাকতে পারে; browser-এ পূর্ণ upload/storage integration নেই এবং voice report নেই।
- Geo coordinates district/thana approximate centroid; boundary-accurate PostGIS নয়।
- Tracking ID জানা থাকলে public tracking endpoint থেকে report/history পড়া যায়—tracking ID share করার সময় সতর্ক থাকুন।
- Production-এ test report submit করবেন না, কারণ প্রতিটি submission সঙ্গে সঙ্গে public হয়।

## Deployment

- Frontend Vercel-এ `apps/web` root থেকে deploy হয়।
- API Render-এর `prohori-api` service-এ deploy হয়। Render-এ auto-deploy বন্ধ; API code push-এর পর manual deploy দরকার।
- Production database Prohori-র dedicated Supabase project-এই থাকতে হবে।
