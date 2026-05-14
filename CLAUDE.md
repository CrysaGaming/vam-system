# VAM-System — Claude Code Operating Context

> Single-Source-of-Truth für Claude-Code-Sessions. Bewusst schlank. Tiefe steckt in `docs/`.

## What this project is

VAM-System is a self-hosted Virtual-Airline-Management platform for flight-sim communities. Live: `vam.kevindrack.de`. TypeScript monorepo (Next.js 16 + NestJS skeleton + Discord-Bot + Postgres). Owner: Kevin Drack (CrysaGaming, IVAO 770283 — pilot himself).

**Strategic identity**: Modern, multi-tenant-capable, Multi-Network-First (VATSIM + IVAO both live), Content-Creator-First (OBS native, Twitch foundation in roadmap), 3D-Live-Map prominent. Filling the gap between phpVMS 7 (old) and vAMSYS (closed SaaS).

## Read these before non-trivial work

The roadmap and architecture docs are authoritative. Don't drift from them; if a task seems to contradict them, stop and ask.

- **`docs/vision/letter-wellen-roadmap.md` — PRIMARY operative roadmap** (cross-repo letter-Wellen A-S + 50-option brainstorm-bank + reihenfolge-empfehlung). Read first für "was kommt als nächstes" + cross-repo coordination.
- `docs/vision/Wellen-Roadmap.md` — numeric Wellen 0-19 (strategische langzeit-roadmap, vam-system-fokus).
- `docs/vision/acars-client-roadmap.md` — VamAcarsClient repo-spezifisch.
- `docs/vision/vam-master-roadmap.md` — strategic concept, 5-track-modell, Tag 5 (teilweise outdated bei status).
- `docs/acars-architecture.md` — ACARS-Client design (.NET 10, SimConnect, pairing-codes).
- `docs/weather-provider-strategy.md` — multi-provider weather strategy.
- `docs/simconnect-data-catalog.md` — SimConnect variable catalog.
- `docs/pirep-analysis-page.md` — PIREP detail page vision (12 sections).
- `docs/todo-obs-overlay-system.md` — OBS-Overlay roadmap (Phase 1-3 done, 4-9 open).
- `docs/vision/admin-dashboards-vision.md`, `twitch-to-sim-integration.md`, `platform-layout-redesign.md` — long-term track visions.

## Tech stack (Tag 5 reality)

- **Frontend**: Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind CSS v4, Mapbox GL JS 3.x, Tremor Raw (legacy — migrating to shadcn/ui).
- **Backend**: NestJS 10 (skeleton, no endpoints yet). Server Components + Server Actions cover ~95% of backend needs.
- **Bot**: discord.js 14, Express HTTP bridge on port 3001, Bearer-Token auth.
- **DB**: PostgreSQL 16 (Docker), Prisma 5.22, 18 models.
- **Auth**: NextAuth v5 (Discord). Custom OAuth flows for VATSIM and IVAO.
- **Tooling**: pnpm 10, Turborepo, tsx watch.
- **Deployment**: Docker Compose (DB) + Cloudflare Named Tunnel.

## Architectural principles (non-negotiable)

1. **Multi-Tenancy-First** — every entity is airline-scoped. No hard-coded `"lufthansa-virtual"` strings.
2. **Read RSC, Write Server-Actions** — no internal REST/GraphQL. NestJS only for future 3rd-party integrations.
3. **Bot owns the data plane** — VATSIM/IVAO/METAR polling lives in the bot. Web app reads from DB.
4. **Multi-Network-Native** — VATSIM and IVAO are both first-class. Twitch/Sim features must be network-aware (anti-cheat: hard-disable triggers when user is online on a network).
5. **Content-Creator-First** — OBS, Twitch, YouTube are native, not plugins.
6. **Settings cascade**: System → Airline → User. Encrypted-at-rest (AES-256-GCM, planned).
7. **Aviation-First UX** — 3D-Live-Map stays prominent. ICAO codes, feet/knots, dark indigo theme.
8. **Honest effort bands** — no point estimates. Use complexity tags 🟢🟡🟠🔴. Pioneer topics get months, not weeks.

## Current priorities (active tracks)

**Track 1 — Pilot-Experience** (active, 4-8 weeks band):

- Booking system with SimBrief dual-path (schema + UI). Closes the booking loop.
- OBS-Overlay Phase 4-7 (polish, push-updates, trail-vis).
- Awards UI (backend ready, no UI yet).
- Sceneries UI (backend ready, no UI yet).

**Track 3 — Platform-Foundation** (active, parallel-OK):

- Enable React Compiler + Turbopack FS-cache.
- shadcn/ui migration (page-by-page, no big-bang).
- TanStack Query + Zustand + React Hook Form + Zod.
- Sidebar layout migration (Header-only → Sidebar pattern).

Tracks 2 (Content-Creator), 4 (Sim-Integration), 5 (Business-Layer) are **sequenced behind these**. Don't start work on them without explicit confirmation.

## Conventions

- TypeScript strict — no `any` without justification in a comment.
- Server Components by default. Add `"use client"` only when needed (events, browser APIs, client state).
- Prisma migrations: descriptive names (`add_booking_with_simbrief_cache`, not `update_schema`).
- Commits: imperative, scoped where applicable (`feat(booking): add dual-path SimBrief logic`).
- Branch `cc-experiment` is the Claude-Code-evaluation experimental branch. Don't merge to `main` without explicit approval.
- Non-trivial architectural decisions get a `.md` in `docs/architecture/` or `docs/vision/`. Link from here when stable.

## Anti-patterns (don't do)

- Don't add a custom poller in the web app — the bot owns polling.
- Don't introduce REST/GraphQL for internal mutations — use Server Actions.
- Don't hardcode airline IDs or assume single-tenant.
- Don't add new Tremor Raw components — we're migrating away.
- Don't build features that aren't in the roadmap. Ask first.
- Don't suggest week-scale timelines for pioneer work (MSFS mod = 3-5 months honestly).
- Don't grow this CLAUDE.md past ~150 lines. Open a separate doc and link it instead.

## Commands

```powershell
pnpm install                    # Install all workspace deps

pnpm dev                        # Run all apps via Turborepo
pnpm --filter web dev           # Web app only
pnpm --filter bot dev           # Discord bot only

docker compose up -d            # Start Postgres
pnpm prisma migrate dev         # Apply migrations
pnpm prisma studio              # DB GUI

pnpm lint                       # Lint
pnpm typecheck                  # TS check
```

## Local dev environment

- **Hosts-mapping**: `vam.kevindrack.de` is mapped to `127.0.0.1` in the Windows hosts file. Dev server `pnpm --filter @vam/web dev` listens on port 3000. **Always use `http://vam.kevindrack.de:3000` (not `localhost:3000`)** for any flow that goes through Discord/VATSIM/IVAO OAuth — callback URLs are registered for the FQDN. NextAuth's `NEXTAUTH_URL` is set to the FQDN; mixing hosts breaks sessions and cookies.
- For headless tests (curl, db queries, etc.) `localhost:3000` is fine since no auth state needed.

## HMR / cache / Tailwind v4 quirks

Lessons hart gelernt 2026-05-01/02. Apply these when CSS/HMR look broken:

- **Tailwind v4 + Turbopack detection-bug**: certain class patterns are not picked from content files even though they're definitely there. Confirmed flaky: `max-w-[Xrem]` arbitrary values, `h-14`/`w-14` (while `h-16` works), `sm:`/`lg:`-prefixed classes after HMR cycles. **Workaround**: explicit `@source inline("...")` in `apps/web/app/globals.css`. Two such blocks already exist there, comment-tagged with the rationale — append, don't replace.
- **Verifying CSS compile**: a class is in the bundle when its **compiled form** appears, not the Tailwind name. `max-w-[100rem]` shows up as `max-width: 100rem`, not as `.max-w-\[100rem\]`. Search for the compiled property.
- **Cloudflare cache after CSS/JS changes**: cf-cache is `max-age=14400` (4h). After bundle-affecting commits the user must hard-reload (Ctrl+Shift+R) — soft-reload serves the stale bundle.
- **Dev-server hard restart**: when HMR drifts (server compiled state ≠ client state, hydration mismatches that don't go away), kill orphan node processes (`taskkill //F //IM node.exe`), `rm -rf apps/web/.next`, then restart. Don't trust hot-reload to recover from this.
- **Spawn pattern that works**: `pnpm --filter @vam/web dev` via `run_in_background: true` works in-shell. PowerShell `Start-Process` resets PATH and breaks the `next` binary lookup.

## Working-style context

- Solo developer. Tooling stack: Roo Code + Qwen3-Coder-30B (local LM Studio) + Claude sessions for strategy and code review. Claude Code is currently being evaluated on this branch.
- Real velocity is ~5-7% of standard engineering estimates for known patterns. Apply that as default.
- For pioneer topics (custom MSFS mod, plugin systems, aircraft Lvar reverse-engineering): factor doesn't apply. Months, not weeks.
- Coding sessions can run 6-12h productive when in flow.
- **User decides when to stop.** Do not proactively suggest stopping based on clock time, session duration, or speculation about user state. Time-of-day, "it's late", "long day", "to be safe" — not valid reasons. Lessons learned the hard way 2026-04-29.
- Only suggest a pause if the user EXPLICITLY signals fatigue ("müde", "kann nicht mehr klar denken", "Augen brennen", repeated typos, asks for break themselves). Then once, briefly, then drop it.
- "Volldampf weiter" / "weiter coden" / "machen wir weiter" / "Nein kein Stop" = go-signal, full respect, no second-guessing.

## When in doubt

Ask. The roadmap explicitly values "kein Druck-Scheinplan" — verzettelt arbeiten is the bigger risk than slowness. If a task is growing beyond what was discussed: pause, summarize, get confirmation.
