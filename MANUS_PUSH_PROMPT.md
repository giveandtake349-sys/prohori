# Manus push prompt — Prohori: geo + Pashe Achi + SOS (commit 2)

Copy everything below the line into Manus AI. One patch/commit per push.

---

Apply the Prohori extension (BD geo hierarchy + "Pashe Achi" volunteer teams +
emergency SOS broadcast) to the `prohori` repo (user: giveandtake349-sys).
Steps, in order:

1. `pnpm install` (install dependencies first — required before typecheck)
2. Typecheck every package — ALL must pass with 0 errors:
   - `pnpm --filter db run check`
   - `pnpm --filter api run check`
   - `pnpm --filter web run check`
3. `pnpm --filter db run generate` (must succeed; new migration 0001 already
   committed — regenerate only to confirm it is clean)
4. If any step fails, STOP and report the error — do not commit broken code.
5. `git add -A && git commit -m "feat: BD geo hierarchy, Pashe Achi teams, SOS broadcast" && git push origin main`

Do NOT use `tsc --noEmit` directly — the typecheck command is
`pnpm --filter <package> run check` (each package has a "check" script).

After push: apply BOTH migration files in the Supabase SQL editor, in order —
`packages/db/drizzle/0000_fuzzy_microbe.sql` then
`packages/db/drizzle/0001_daily_lady_deathstrike.sql` —
then run `pnpm --filter db run seed` with DATABASE_URL set
(seeds 8 divisions + 64 districts, links the 5 Dhaka thanas to Dhaka district).
