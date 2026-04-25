# VAM System

> Self-hosted Virtual Airline Management Platform — modular, modern, content-creator-friendly.

A complete VA management system: pilot dashboard, flight tracking, automatic rank progression, and a Discord bot that mirrors everything live into your community server.

**Status**: Active development. MVP feature-complete. Running in production at <https://vam.kevindrack.de>.

## Features

### Web app

- Discord OAuth login (NextAuth v5)
- Auto-onboarding: new pilots join the default airline as Trainees
- Routes catalog with departure/arrival airports
- PIREP submission with transactional flight-stats updates
- Auto-rank-upgrade when flight hours threshold is crossed
- Server Actions for write operations, server components for reads

### Discord bot

- Slash commands: `/status` (airline overview), `/pilot [@user]` (pilot profile)
- Posts in `#bot-logs` on startup
- HTTP server for receiving events from the web app
- On PIREP submit: posts an embed in `#pireps` with route, time, aircraft, and an applause reaction
- On rank upgrade: swaps Discord roles + posts a celebration embed in `#rank-promotions`

### Discord server (managed manually)

- 11 roles in clean hierarchy (Admin, Head Pilot, Instructor, Pilot ranks, Contributors, Pings)
- 23 channels in 6 categories
- AutoMod, onboarding flow with 3 questions, welcome card

### Infrastructure

- Postgres 16 + Redis 7 in Docker
- Cloudflare Named Tunnel for public access (HTTPS, custom domain)
- Bearer-token-authenticated event bridge between web and bot

## Tech stack

| Layer                       | Tools                                                            |
| --------------------------- | ---------------------------------------------------------------- |
| Frontend                    | Next.js 16 (Turbopack), React 19, Tailwind v4, TypeScript strict |
| Auth                        | NextAuth v5 with Discord OAuth + Prisma adapter                  |
| Backend (planned)           | NestJS 10 (skeleton, port 4000)                                  |
| Database                    | PostgreSQL 16 + Prisma 5.22                                      |
| Realtime / queues (planned) | Redis 7, BullMQ, Socket.IO                                       |
| Bot                         | discord.js 14 + Express (event bridge on port 3001)              |
| Tooling                     | pnpm 10, Turborepo, tsx watch                                    |
| Deploy                      | Docker Compose (DB only) + Cloudflare Tunnel                     |

## Architecture

                          ┌─────────────────┐
                          │  Discord users  │
                          └────────┬────────┘
                                   │
                     OAuth + Slash commands + Embeds
                                   │

┌──────────────────────┐ ┌──────▼─────────┐ ┌────────────────────┐
│ apps/web │ │ Discord servers │ │ apps/bot │
│ Next.js, Port 3000 │◄──►│ + Gateway API │◄──►│ Node.js + Express │
│ │ └─────────────────┘ │ Port 3001 │
│ Server Actions │ │ │
│ PIREPs, Auth │ │ Slash commands │
└──────────┬───────────┘ │ Event handlers │
│ └──────────┬─────────┘
│ │
│ HTTP POST /events/\* (Bearer auth) │
└─────────────────────────►────────────────────────┘
│
│
┌──────────▼───────────────────────────────────────────────────┐
│ packages/db (Prisma client, shared) │
└──────────┬───────────────────────────────────────────────────┘
│
┌──────────▼───────────┐ ┌─────────────────────────────────┐
│ PostgreSQL 16 │ │ Cloudflare Tunnel │
│ Docker, Port 5432 │ │ vam.kevindrack.de → :3000 │
└──────────────────────┘ └─────────────────────────────────┘

## Project layout

apps/
web/ Next.js — auth, dashboard, PIREP form
bot/ Discord bot — slash commands, event handlers
api/ NestJS — placeholder for future REST/RPC
worker/ BullMQ skeleton
packages/
db/ Prisma schema + client (single source of truth)
shared/ DTOs and shared types
ui/ Reusable React components
config/ Shared TypeScript / lint / format configs
docker/ docker-compose.yml (Postgres + Redis)

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 10+
- Docker Desktop
- Discord developer application (with bot user)

### Setup

```bash
# Clone and install
git clone <repo>
cd vam-system
pnpm install

# Copy env template and fill in values
cp .env.example .env
# Edit .env — see comments for where each value comes from

# Start Postgres + Redis
cd docker && docker compose up -d && cd ..

# Run database migrations + seed
cd packages/db
pnpm prisma migrate deploy
pnpm prisma db seed
cd ../..
```

### Run in dev (4 terminals)

```bash
# Terminal 1 — web app
pnpm --filter @vam/web dev

# Terminal 2 — discord bot
pnpm --filter @vam/bot dev

# Terminal 3 — cloudflare tunnel (optional, for public URL)
cloudflared tunnel run vam-dev

# Terminal 4 — control line for git, prisma, etc.
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

- [x] Discord OAuth + auto-onboarding
- [x] Routes catalog, PIREP submission
- [x] Auto-rank-upgrade based on flight hours
- [x] Discord bot: `/status`, `/pilot`
- [x] Web→Bot event bridge with Discord embeds
- [x] Auto-role-update on rank upgrade
- [x] Cloudflare Tunnel for public access
- [ ] `/leaderboard`, `/fleet`, `/routes` slash commands
- [ ] PIREP detail page (`/pireps/[id]`)
- [ ] PIREP approval workflow for instructors
- [ ] Dashboard expansion: recent flights, top pilots, charts
- [ ] Awards system
- [ ] Events / flight tours
- [ ] OBS overlay endpoints (planned content-creator feature)
- [ ] VATSIM/IVAO live data integration

## License

Proprietary — all rights reserved. Open-sourcing decisions deferred.
