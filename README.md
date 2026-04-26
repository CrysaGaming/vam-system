# VAM System

> Self-hosted Virtual Airline Management Platform with real-time multi-network flight tracking, automated pilot progression, and Discord integration.

A production-grade VAM stack: pilot dashboard with live stats, real-time tracking on a 3D map (VATSIM + IVAO + Mapbox), full PIREP workflow with admin approval, automatic rank progression, METAR-aware cockpit weather, and a Discord bot that mirrors everything into your community server.

**Status**: Active development, near-production-ready. Running at <https://vam.kevindrack.de>.

## Features

### Live Map (`/live`)

- 3D terrain (Mapbox GL JS 3.x) with hillshade, fog, and dynamic lighting
- Worldwide live tracking: ~3500 VATSIM + IVAO pilots, member sessions highlighted
- Click any plane for full flight details, trail, distance, and ETA
- METAR overlay: airports color-coded by flight category (VFR/MVFR/IFR/LIFR)
- RainViewer global weather radar with auto-hide above zoom 10
- Cockpit weather effects (rain/snow) — manual or auto-coupled to nearest METAR
- Departure/arrival route lines for the selected flight
- Auto-center on first member session at page load
- Configurable clustering for low-zoom worldview
- Filter toolbar with 9 toggles (member-only, networks, airports, weather, etc.)

### Web app

- Discord OAuth login (NextAuth v5) + VATSIM and IVAO OAuth account linking
- Auto-onboarding: new pilots join the default airline as Trainees
- Routes catalog with departure/arrival airports, distances, aircraft assignment
- PIREP submission with transactional flight-stats updates
- Auto-rank-upgrade when flight hours threshold is crossed (only upgrades, never downgrades)
- PIREP detail pages with approval workflow for admins/instructors
- Pilot profiles with stats, top-3 most-flown routes, recent flights
- Admin stats dashboard: flights per month, top routes, status distribution
- Settings page for managing VATSIM/IVAO connections
- Server Actions for write operations, Server Components for reads

### Discord bot

- 5 slash commands: `/status`, `/pilot`, `/leaderboard`, `/fleet`, `/routes`
- VATSIM tracker (30s poll) — matches member CIDs, upserts live sessions, appends trail positions
- IVAO tracker (30s poll) — same as VATSIM, separate cache for the public worldwide map
- METAR tracker (10min poll) — relevant airports cached for the live map and cockpit weather
- HTTP server (Express, port 3001) — Bearer-token-authenticated event bridge from the web app
- On PIREP submit: posts an embed in `#pireps` with route, time, aircraft
- On PIREP approved/rejected: posts in `#pireps` with approver name and reason
- On rank upgrade: swaps Discord roles + posts a celebration embed in `#rank-promotions`

### Discord server (managed manually)

- 11 roles in clean hierarchy (Admin, Head Pilot, Instructor, Pilot ranks, Contributors, Pings)
- 7 channels with bot integration (bot-logs, pireps, rank-promotions, awards, announcements, livestreams, welcome)
- AutoMod, onboarding flow with 3 questions, welcome card

### Infrastructure

- PostgreSQL 16 in Docker
- Cloudflare Named Tunnel for public access (HTTPS, custom domain)
- Bearer-token-authenticated event bridge between web and bot

## Tech stack

| Layer                       | Tools                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| Frontend                    | Next.js 16 (Turbopack), React 19, Tailwind v4, TypeScript strict          |
| Maps                        | Mapbox GL JS 3.x (3D terrain, lights, fog, weather effects), react-map-gl |
| Auth                        | NextAuth v5 (Discord) + custom OAuth flows for VATSIM and IVAO            |
| Database                    | PostgreSQL 16 + Prisma 5.22 (18 models)                                   |
| Bot                         | discord.js 14 + Express HTTP bridge (port 3001)                           |
| External APIs               | VATSIM datafeed, IVAO whazzup, AVWX METAR, RainViewer                     |
| Tooling                     | pnpm 10, Turborepo, tsx watch                                             |
| Deploy                      | Docker Compose (DB) + Cloudflare Tunnel                                   |

## Architecture

```
                    ┌─────────────────┐
                    │ Discord users   │
                    └────────┬────────┘
                             │
              OAuth + Slash commands + Embeds
                             │
   ┌──────────────────────┐  │  ┌────────────────────────┐
   │     apps/web         │  │  │      apps/bot          │
   │ Next.js, port 3000   │◄─┼─►│ discord.js + Express   │
   │                      │  │  │ port 3001              │
   │ Server Components    │  │  │                        │
   │ Server Actions       │  │  │ Slash commands         │
   │ Live Map (Mapbox)    │  │  │ HTTP event bridge      │
   │ PIREPs + Approval    │  │  │ VATSIM tracker (30s)   │
   │ Admin stats          │  │  │ IVAO tracker (30s)     │
   └──────────┬───────────┘  │  │ METAR tracker (10min)  │
              │              │  └────────────┬───────────┘
              │ HTTP POST    │               │
              │ /events/*    │               │
              │ Bearer auth  │               │
              └─────────────►┘               │
                                             │
              ┌──────────────────────────────┘
              │
   ┌──────────▼───────────────────────────────────────┐
   │    packages/db (Prisma client, single source)    │
   └──────────┬───────────────────────────────────────┘
              │
   ┌──────────▼───────────┐  ┌──────────────────────────────┐
   │   PostgreSQL 16      │  │   Cloudflare Tunnel          │
   │   Docker, port 5432  │  │   vam.kevindrack.de → :3000  │
   └──────────────────────┘  └──────────────────────────────┘
```

The bot owns the data plane: it polls the external networks and writes `LiveSession` and `LiveSessionPosition` rows to the database. The web app reads from those tables to render the live map. Web→Bot communication for one-shot events (PIREP submitted, rank upgraded, etc.) goes through the Bearer-authenticated HTTP bridge.

## Project layout

```
apps/
  web/      Next.js — pages, server actions, live map, dashboards
  bot/      Discord bot — commands, event bridge, network trackers
  api/      NestJS — placeholder for future REST/RPC endpoints
  worker/   BullMQ skeleton — placeholder for queued jobs
packages/
  db/       Prisma schema + generated client (single source of truth)
  shared/   DTOs and shared types
  ui/       Reusable React components
  config/   Shared TypeScript / lint / format configs
docker/
  docker-compose.yml (Postgres)
```

## Database

18 Prisma models in 5 logical groups:

- **Aviation** — `Airline`, `Aircraft`, `Airport`, `Route`, `Pirep`
- **Live tracking** — `LiveSession`, `LiveSessionPosition`
- **Auth** — `User`, `Account`, `Session`, `VerificationToken`
- **Pilot system** — `Rank`, `Role`
- **Engagement & admin** — `Award`, `UserAward`, `Scenery`, `FeatureFlag`, `DiscordRoleMapping`

Users link to up to three networks via `discordId`, `vatsimCid`, and `ivaoVid`. PIREPs track an `approvedById` for full audit trail of approvals and rejections.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 10+
- Docker Desktop
- Discord developer application with bot user
- Mapbox access token (free tier is fine)
- VATSIM developer credentials (optional, for OAuth)
- IVAO developer credentials (optional, for OAuth)

### Setup

```bash
# Clone and install
git clone https://github.com/CrysaGaming/vam-system.git
cd vam-system
pnpm install

# Copy env template and fill in values
cp .env.example .env
# Edit .env — see comments for where each value comes from

# Start Postgres
cd docker && docker compose up -d && cd ..

# Run database migrations + seed
cd packages/db
pnpm prisma migrate deploy
pnpm prisma db seed
cd ../..
```

### Run in dev (3 terminals)

```bash
# Terminal 1 — web app
pnpm --filter @vam/web dev

# Terminal 2 — discord bot
pnpm --filter @vam/bot dev

# Terminal 3 — cloudflare tunnel (optional, for public URL)
cloudflared tunnel run vam-dev
```

### One-time bot setup

```bash
# Register slash commands with Discord (only after schema changes)
pnpm --filter @vam/bot run register
```

## Environment variables

See [.env.example](./.env.example) for the full list with inline comments.

Key sections:

- **Database** — Postgres connection
- **NextAuth** — `AUTH_SECRET` (generate with `openssl rand -base64 32`), `AUTH_URL` (your public URL)
- **Discord OAuth** — `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` from the Developer Portal
- **Discord Bot** — `DISCORD_BOT_TOKEN` from the Bot tab in the Developer Portal
- **Discord IDs** — guild, 7 channels, 11 roles (right-click in Discord with Developer Mode on)
- **VATSIM OAuth** — `VATSIM_CLIENT_ID`, `VATSIM_CLIENT_SECRET`, redirect URI; from <https://auth-dev.vatsim.net>
- **IVAO OAuth** — `IVAO_CLIENT_ID`, `IVAO_CLIENT_SECRET`, `IVAO_API_KEY`; from the IVAO developer portal
- **Mapbox** — `NEXT_PUBLIC_MAPBOX_TOKEN` (used by the live map)
- **Bot HTTP bridge** — `BOT_HTTP_PORT` (default 3001) + `BOT_EVENTS_SECRET` (generate with PowerShell `[Convert]::ToBase64String((1..32 | %{ Get-Random -Maximum 256 }))`)

## Scripts

```bash
pnpm dev             # Run everything in dev mode (via Turborepo)
pnpm build           # Build all apps
pnpm test            # Run all tests

# Per-app
pnpm --filter @vam/web dev
pnpm --filter @vam/bot dev
pnpm --filter @vam/bot run register   # Register Discord slash commands

# Prisma
pnpm --filter @vam/db prisma migrate dev
pnpm --filter @vam/db prisma db seed
pnpm --filter @vam/db prisma studio   # GUI for DB
```

## Roadmap

### Done

- [x] Discord OAuth + VATSIM OAuth + IVAO OAuth
- [x] Auto-onboarding for new pilots
- [x] Routes catalog, PIREP submission with auto rank-upgrade
- [x] PIREP detail page with approval workflow for admins/instructors
- [x] Dashboard with profile, airline stats, rank progression, recent flights, top pilots
- [x] Admin stats dashboard with KPIs and 3 charts
- [x] Pilot profile pages with most-flown routes
- [x] Settings with VATSIM/IVAO connection management
- [x] Discord bot: `/status`, `/pilot`, `/leaderboard`, `/fleet`, `/routes`
- [x] Web→Bot event bridge with Discord embeds (PIREP submit/approve/reject, rank upgrade)
- [x] Auto-role-update on rank upgrade
- [x] Cloudflare Tunnel for public access
- [x] **Live Map** — 3D terrain, member tracking, worldwide VATSIM/IVAO, METAR airports
- [x] Cockpit weather effects (rain/snow) with smart auto-coupling to nearest METAR
- [x] Worldwide weather radar (RainViewer) with auto-hide above zoom 10
- [x] Departure/arrival route lines, auto-center, distance + ETA, configurable clustering

### Next

- [ ] Search bar for callsigns on the live map
- [ ] Click public pilots for a reduced-detail sidebar
- [ ] Awards system UI (DB model exists)
- [ ] Sceneries catalog UI (DB model exists)
- [ ] Implement `apps/api` (NestJS) for third-party integrations
- [ ] OBS overlay endpoints (planned content-creator feature)
- [ ] PIREP heatmap (worldwide route density)
- [ ] Replay mode for completed flights
- [ ] Events / flight tours

## License

Proprietary — all rights reserved. Open-sourcing decisions deferred.
