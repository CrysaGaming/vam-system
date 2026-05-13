# VAM-System — Wellen-Roadmap

> **Dokument-Typ**: Operative Wellen-Roadmap (Was-jetzt-vs-Was-als-nächstes)
> **Stand**: 2026-05-13 (status-update für ACARS — see Welle 9 + neue [`acars-client-roadmap.md`](./acars-client-roadmap.md))
> **Original**: 2026-05-03 (Tag 6, Sonntag)
> **Status**: 187+ commits gepusht. ACARS-client (extern repo) hat ~30 commits seit 0.1.0 mit M1-M6 alle done. vam-system Track 5 (30 PIREP/social/PWA/roster features) komplett abgeschlossen auf cc-experiment branch.
> **Live**: vam.kevindrack.de
>
> **Zweck**:
> 1. Klar zeigen **was bereits erledigt ist** (mit commit-references zur verifikation)
> 2. Welt-aufteilung in **Wellen** statt linearer Phasen (jede welle ist ein zusammenhängender themenblock)
> 3. **Reihenfolge-empfehlung** basierend auf strategischem wert + dependencies
> 4. Für jede zukünftige welle: scope, aufwand, abhängigkeiten, definition-of-done
>
> **Verwandte Docs**:
> - `vam-master-roadmap.md` — Strategische 5-Track-Ebene (Tag 5, teilweise outdated bei status — hier ist der aktualisierte stand)
> - `2026-05-01-airline-ops-roadmap.md` — Detaillierte airline-ops 11-Phasen-Roadmap (in Wellen-Mapping unten referenziert)
> - `Economy-Karriere.md` — Maximal-Vision für economy + career (Wellen 12-19 entsprechen dort)
> - `twitch-to-sim-integration.md` — Twitch-deep-integration (Welle 11 + spätere)
> - `acars-architecture.md` — ACARS-system-design (mit 13. Mai status-update header)
> - **`acars-client-roadmap.md` — NEU: post-MVP ACARS-client roadmap (Wellen A-E)**

---

## Inhaltsverzeichnis

### TEIL A — STATUS-BILANZ
1. [Was bereits erledigt ist](#1-was-bereits-erledigt-ist)
2. [Plan-vs-Realität-Check (Master-Roadmap-Update)](#2-plan-vs-realität-check)
3. [Was vorbereitet aber nicht aktiv ist](#3-was-vorbereitet-aber-nicht-aktiv-ist)

### TEIL B — DIE WELLEN (Operative Roadmap)
4. [Wellen-Konzept & Lese-Anleitung](#4-wellen-konzept--lese-anleitung)
5. [Welle 0: Foundation ✅ DONE](#welle-0-foundation--done)
6. [Welle 1: Pilot Booking Loop ✅ DONE](#welle-1-pilot-booking-loop--done)
7. [Welle 2: Layout & Theme System ✅ DONE](#welle-2-layout--theme-system--done)
8. [Welle 3: Airline-Catalogs & Routes-Management ✅ DONE](#welle-3-airline-catalogs--routes-management--done)
9. [Welle 4: Hub-System & Free-Flight ⏳ NEXT](#welle-4-hub-system--free-flight--next)
10. [Welle 5: Fleet & Aircraft Management ⏳ NEXT](#welle-5-fleet--aircraft-management--next)
11. [Welle 6: Personnel Management 🔵 SOON](#welle-6-personnel-management--soon)
12. [Welle 7: Schedule Generator 🔵 SOON](#welle-7-schedule-generator--soon)
13. [Welle 8: Branding & Public Pages 🔵 SOON](#welle-8-branding--public-pages--soon)
14. [Welle 9: ACARS Phase 2-5 🔵 LATER](#welle-9-acars-phase-2-5--later)
15. [Welle 10: OBS-Overlay Phase 4-9 🔵 LATER](#welle-10-obs-overlay-phase-4-9--later)
16. [Welle 11: Twitch-OAuth Foundation 🔵 LATER](#welle-11-twitch-oauth-foundation--later)
17. [Welle 12: Economy MVP 💭 VISION](#welle-12-economy-mvp--vision)
18. [Welle 13: Career-System Basics 💭 VISION](#welle-13-career-system-basics--vision)
19. [Welle 14: Twitch Channel-Points → Tickets 💭 VISION](#welle-14-twitch-channel-points--tickets--vision)
20. [Welle 15: Aircraft-Economy & Maintenance 💭 VISION](#welle-15-aircraft-economy--maintenance--vision)
21. [Welle 16: Stock-Market (VAMSE) 💭 VISION](#welle-16-stock-market-vamse--vision)
22. [Welle 17: Multi-Airline (Alliances + M&A) 💭 VISION](#welle-17-multi-airline-alliances--ma--vision)
23. [Welle 18: Events + Seasonal-Content 💭 VISION](#welle-18-events--seasonal-content--vision)
24. [Welle 19: Mobile + VR + Voice-ATC 💭 LONG-TERM](#welle-19-mobile--vr--voice-atc--long-term)

### TEIL C — STRATEGIE
25. [Wellen-Selection-Strategie (was wann angehen)](#25-wellen-selection-strategie)
26. [Parallele Tracks vs. Sequenzielle Wellen](#26-parallele-tracks-vs-sequenzielle-wellen)
27. [Visualisierung: Welle-Dependencies](#27-visualisierung-welle-dependencies)

---

# TEIL A — STATUS-BILANZ

## 1. Was bereits erledigt ist

### 1.1 Statistik

```
Total commits gepusht:        187
Commits letzte 4 tage:        90
Live unter:                   vam.kevindrack.de (Cloudflare Tunnel)
DB-models:                    34 (von 18 zu Tag 5 → +16 in einer woche!)
App-routes (page.tsx):        30
Laufzeit seit Tag 1:          11 tage (23. April → 03. Mai 2026)
```

### 1.2 Vollständig erledigte features

#### Pilot-Experience-Foundation (✅ Welle 0)
- Discord OAuth + NextAuth v5 Login
- VATSIM OAuth (Account-Linking, Token-Storage)
- IVAO OAuth (Account-Linking, Token-Storage)
- Auto-Onboarding für neue Pilots → Default-Airline als Trainee
- PIREP-Submission mit Auto-Stats-Update + Transactional
- Auto-Rank-Upgrade-Logik (only-up, never-down)
- PIREP-Detail-Pages mit Approval-Workflow
- Pilot-Profile mit Top-3-Most-Flown-Routes
- Settings-Page für Network-Connections
- Pilot-Dashboard mit Stats, Recent-Flights, Top-Pilots

#### Live-Map (✅ Welle 0)
- Mapbox GL JS 3.x mit 3D-Terrain
- Hillshade, Fog, Dynamic-Lighting
- Worldwide-Live-Tracking (~3500 VATSIM + IVAO Piloten parallel)
- Member-Sessions highlighted
- Click-Plane → Full-Detail-Sidebar
- Trail-Visualization
- Distance + ETA-Calculation
- METAR-Overlay (VFR/MVFR/IFR/LIFR-Color-Coding)
- RainViewer Weather-Radar (Auto-hide above zoom 10)
- Cockpit-Weather (rain/snow, manual + auto-coupled)
- Departure/Arrival-Route-Lines
- 9-Toggle Filter-Toolbar

#### Discord-Bot (✅ Welle 0)
- 5 Slash-Commands: `/status`, `/pilot`, `/leaderboard`, `/fleet`, `/routes`
- VATSIM Tracker (30s Poll)
- IVAO Tracker (30s Poll)
- METAR Tracker (10min Poll)
- HTTP Server (Express, Bearer-Auth, Port 3001)
- Discord-Embeds für PIREP-Submit/Approve/Reject
- Discord-Embeds für Rank-Upgrades
- Auto-Role-Update bei Rank-Upgrade

#### Booking-Loop (✅ Welle 1)
**Day 3-4 marathon, vollständig shipped:**
- Booking-Schema + Helpers + Server-Actions (Pattern α baseline)
- SimBrief Pattern α: Tab-redirect via dispatch.simbrief.com + xml.fetcher
- SimBrief Pattern Z: Popup-based via Partner-API-Key
- Pattern Y geparkt (Navigraph OAuth — email an dev@navigraph.com gesendet 30.04, 14d-window läuft)
- Booking-Detail-Page mit OfpSummary-Component (live + muted variants)
- Bookings-Listing-Page mit Aktiv/Abgeschlossen-Split
- Settings-Page Pattern α + Z indicators
- `Booking.scheduledDeparture` mit SimBrief-Prefill (date/deph/depm)
- `FlightPlanCache → Pirep` lifecycle-transfer (atomic transaction)
- PIREP-Detail OFP-Display (muted OfpSummary)
- SimBrief username Suggestion aus OAuth-name
- Override-Hierarchie: Aircraft/Fleet/Airline/Route SimBrief-overlays
- Plan vs Actual comparison auf PIREP-detail
- Clone-from-finished booking flow
- Symmetric Plan-again Pattern-Z + Pattern-α-fallback hint

#### Layout & Theme (✅ Welle 2)
- Persistent desktop sidebar nav
- Header-bar redesign mit Select Airline placeholder, avatar, rank
- Light/dark mode toggle (#A5)
- Phase 2 light/dark mode für 7 pages + 16 sub-components
- Light-mode für /admin/stats, /pireps/pending, /pireps/new, /pireps/[id]
- Responsive page-container widening + side-by-side admin sections
- HTML5-semantik mit `<header>`/`<nav>`/`<main>`
- Scroll-container in main, sidebar + header bleiben fix
- Tailwind v4 quirks gelöst (@source inline, picture-ternary-fix)

#### Catalogs & Multi-Tenancy (✅ Welle 3)
- Phase 1 schema — system-curated catalogs (Airport + AircraftType)
- Request-flow für beide (PIREP-style approve/reject)
- OurAirports.com bulk import — **85.266 Airports** mit multi-faceted filter UI
- Runways/Frequencies/Navaids bulk import (3 separate tables)
- Airport detail page mit voll-info anzeige
- AirportDB.io fallback-enrichment für non-OurAirports approvals
- Live-search im airport-browser
- Aircraft-type browse + request flow
- Airline-page mit member-table (voll-feature-set + joinedAirlineAt-tracking)
- Airline-admin role + neue sidebar Airline-Admin sektor
- ICAO-code editierbar mit guard-checkbox
- /admin/pilots cross-airline (search, filter, sort, pagination, bulk-actions)
- Role-management UI (#20)
- Airline-admin-panel (#21)
- User-invite-flow (#22)
- Routes-Management manual CRUD (heute Day-6!)
- Routes CSV-bulk-import mit template + anleitung (heute Day-6!)
- Airport-autocomplete-component (debounced search 85k airports)

### 1.3 Strategische impact-aussagen

**Tag-5-master-roadmap sagte:** "PRIO 1: Booking-System inkl. SimBrief-Dual-Path (1-2 Wochen)"  
→ **Realität:** Day 3-4 fertig (~2 tage). Plus override-hierarchie, plan-vs-actual, lifecycle-transfer.

**Tag-5-master-roadmap sagte:** "ACARS Phase 1 fertig"  
→ **Realität:** Stimmt, aber Phase 2-5 noch offen.

**Tag-5-master-roadmap sagte:** "Awards UI bauen (DB-Models existieren)"  
→ **Realität:** Award + UserAward models existieren immer noch ohne UI.

**Tag-5-master-roadmap sagte:** "OBS-Overlay Phase 1-3 done, 4-9 offen"  
→ **Realität:** Stimmt, OBS-Overlay-page existiert (`/overlay/[token]`), aber phase 4+ nicht angefangen.

---

## 2. Plan-vs-Realität-Check

### 2.1 Master-Roadmap-Status-Update (was sich seit Tag 5 verändert hat)

| Track aus Master-Roadmap | Tag-5-Status | Tag-6-Status (heute) |
|---|---|---|
| **Track 1: Pilot-Experience** | "In Arbeit, kurz vor Fertigstellung" | ✅ Massiv weiter: Booking-Loop komplett, Catalogs komplett, Routes-CRUD komplett. Awards/Sceneries UI weiter offen. |
| **Track 2: Content-Creator-First** | "OBS-Overlay in Arbeit, Twitch-Foundation offen" | 🟡 Unverändert. OBS bei Phase 3, Twitch noch nicht angefangen. |
| **Track 3: Platform-Foundation (Refactor)** | "Vorbereitet, nicht gestartet" | 🟡 Teilweise: Layout-Redesign massiv vorgeschritten (sidebar persistent, theme-system, admin-sektoren). shadcn/ui-Migration weiter offen. |
| **Track 4: Sim-Integration-Depth** | "ACARS Phase 1 fertig" | 🟡 Unverändert. ACARS Phase 2-5 nicht angegangen. |
| **Track 5: Business-Layer** | "Vision-Doc-Ideen, Year-2+" | ✅ Vision deepened: `Economy-Karriere.md` als deep-dive heute geschrieben (~93KB, 61 sections). Schema noch nicht angefasst. |

### 2.2 Was die master-roadmap NICHT antizipiert hat

Diese themen sind seit Tag 5 entstanden und waren in der master-roadmap nicht als prio-1:

1. **Catalog-System für system-curated airports + aircraft-types** mit request-flow
   - Strategischer wert: Multi-tenancy-foundation für N-airlines auf gleicher airport-db
   - 85k airports geseed, fallback-enrichment, request-approval-pattern

2. **Airline-admin-role + sidebar-sektoren** für proper RBAC
   - Strategischer wert: Multi-tenant-fähige rolle (jede airline hat ihre eigenen admins)

3. **Theme-system (light/dark) mit progressive-rollout** über alle pages
   - Strategischer wert: User-präferenz-respekt, accessibility-grundlage

4. **Routes-management mit manual CRUD + CSV-import** (heute!)
   - Strategischer wert: Airline-admin kann jetzt eigene routes-katalog pflegen

5. **Override-Hierarchie für SimBrief-defaults** (Aircraft/Fleet/Airline/Route)
   - Strategischer wert: Pilots müssen weniger settings selbst machen

### 2.3 Was die master-roadmap UNDERESTIMATED hat

- **Multi-tenancy-tiefe**: Mehr work als geplant, aber gut investiert (catalog-request-flow ist solid foundation)
- **Layout-foundation-rework**: Sidebar persistent + responsive container war kein "polish" sondern grosse umstellung
- **Theme-system**: Light/dark mode hat 3 separate commit-rollouts gebraucht (initial + phase2 + bugfixes)

### 2.4 Was die master-roadmap RICHTIG eingeschätzt hat

- **Faktor 0.3** für standard-patterns hält (calibration in TOMORROW.md zeigt sogar 0.27 für additive features, 0.49 für refactor+additive)
- **Awards/Sceneries UI** ist weiter offen wie erwartet (DB-models bleiben ungenutzt)
- **OBS-Phase 4+** ist tatsächlich gestoppt nach Phase 3

---

## 3. Was vorbereitet aber nicht aktiv ist

### 3.1 Schemas existieren, UI fehlt

| Model | Im schema seit | UI-status |
|---|---|---|
| `Award` | Tag 1 | ❌ kein UI |
| `UserAward` | Tag 1 | ❌ kein UI |
| `Scenery` | Tag 1 | ❌ kein UI (community submitted scenery list) |
| `FeatureFlag` | Tag 1 | ❌ kein UI (toggle-system für users) |
| `LiveSession` + `LiveSessionPosition` | Tag 3 | ✅ UI über live-map, aber kein admin-view |
| `DiscordRoleMapping` | Tag 3 | 🟡 partial (auto-role-update funktioniert, aber kein UI für mapping-config) |

### 3.2 Apps-skeleton ohne content

| App | Status |
|---|---|
| `apps/web` | ✅ live, voll funktional |
| `apps/bot` | ✅ live, 5 commands + 3 trackers |
| `apps/api` (NestJS) | ❌ Skeleton — keine endpoints implementiert |
| `apps/worker` (BullMQ) | ❌ Skeleton — keine queues |

### 3.3 Phasen aus existing roadmaps die noch offen sind

| Roadmap | Phase | Status |
|---|---|---|
| `airline-ops-roadmap.md` | Phase 1 (Catalogs) | ✅ DONE |
| | Phase 2 (Fleet + Aircraft) | ❌ OFFEN — wird Welle 5 |
| | Phase 3 (Hubs CRUD) | ❌ OFFEN — wird Welle 4 (kombiniert mit free-flight) |
| | Phase 4 (Routes Management) | ✅ DONE (heute) |
| | Phase 5 (Personnel) | ❌ OFFEN — wird Welle 6 |
| | Phase 6 (Schedule Generator) | ❌ OFFEN — wird Welle 7 |
| | Phase 7 (Branding) | ❌ OFFEN — wird Welle 8 |
| | Phase 8 (Ops Comms) | ❌ OFFEN — später |
| | Phase 9 (Analytics) | ❌ OFFEN — später |
| `acars-architecture.md` | Phase 1 (DataSource-Enum) | ✅ DONE |
| | Phase 2-5 (Pairing, Heartbeat, Client) | ❌ OFFEN — wird Welle 9 |
| `todo-obs-overlay-system.md` | Phase 1-3 | ✅ DONE |
| | Phase 4-9 | ❌ OFFEN — wird Welle 10 |
| `Economy-Karriere.md` | Phase 0 (Foundation) | ❌ OFFEN — wird Welle 4 (kombiniert mit hub-system) |
| | Phase 1+ (Economy) | ❌ OFFEN — wird Welle 12+ |

---

# TEIL B — DIE WELLEN (Operative Roadmap)

## 4. Wellen-Konzept & Lese-Anleitung

### 4.1 Was ist eine "Welle"?

Eine **Welle** ist ein zusammenhängender themenblock der einen messbaren strategischen wert ausspielt. Eine welle ist:

- **Sequenziell** (eine welle nach der anderen, mit klarer reihenfolge)
- **In sich abgeschlossen** (am ende ist die welle "fertig" mit clear definition-of-done)
- **Modular** (eine welle kann reordered oder skipped werden, mit dependency-warnung)
- **Realistisch sized** (nicht ein riesen-monolith — typisch 1-3 wochen scope)

### 4.2 Status-Symbole

| Symbol | Bedeutung |
|---|---|
| ✅ DONE | Vollständig abgeschlossen, gepusht, live |
| ⏳ NEXT | Direkter nachfolger, sollte als nächstes kommen |
| 🔵 SOON | In nächsten 2-4 wochen, wenn die ⏳-wellen fertig sind |
| 💭 VISION | Long-term, einige wochen+ entfernt, requires preparation |

### 4.3 Pro Welle dokumentiert

| Sektion | Inhalt |
|---|---|
| **Scope** | Was umfasst diese welle |
| **Features** | Konkrete deliverables (file-level wenn möglich) |
| **Dependencies** | Was muss VOR dieser welle fertig sein |
| **Definition of Done** | Wann ist die welle abgeschlossen |
| **Effort-Band** | Realistisch ehrliches zeit-fenster (kalibriert) |
| **Schema-Impact** | Welche neuen prisma-models / migrations |
| **Risk-Tags** | 🟢 niedrig / 🟡 mittel / 🟠 hoch / 🔴 sehr hoch |

---

## Welle 0: Foundation — ✅ DONE

**Scope:** Tag 1-5 work — Auth, PIREP, Live-Map, Discord-Bot, OBS-Phase-1-3, ACARS-Phase-1

**Status:** Vollständig abgeschlossen Tag 5 (28. April 2026, 62 commits)

**Dokumentiert in:** `vam-master-roadmap.md` Section 3.3

**Was rauskam:**
- Multi-tenant-fähige foundation
- Live unter vam.kevindrack.de
- 18 Prisma-Models
- Komplette pilot-experience MVP

---

## Welle 1: Pilot Booking Loop — ✅ DONE

**Scope:** SimBrief-integration in 2 patterns + complete booking-lifecycle

**Status:** Day 3-4 marathon (Day-3 evening + Day-4 morning), 14+ commits

**Dokumentiert in:** `TOMORROW.md` Day-4 detailed log

**Was rauskam:**
- **Pattern α** (xml.fetcher fallback, no auth): tab-redirect, refresh-via-static_id
- **Pattern Z** (popup-based, Partner-API-Key): popup auto-close, callback-handler
- **Pattern Y** (Navigraph OAuth): geparkt, email an dev@navigraph.com gesendet 30.04, 14d-window
- **FlightPlanCache lifecycle**: cache transfers automatically Booking → PIREP on submit
- **OfpSummary component**: shared zwischen Booking-detail (live + muted) und PIREP-detail (muted)
- **Override-Hierarchie**: Aircraft / Fleet / Airline / Route SimBrief-defaults
- **Plan vs Actual** comparison auf PIREP-detail
- **Settings-tab-navigation** (#15)
- **Clone-from-finished** booking flow (#18)
- **scheduledDeparture** mit SimBrief-Prefill (date/deph/depm prefill)

**Calibration-data:**
- Additive features: factor ~0.27 vs original-EST
- Additive + refactor: factor ~0.49

---

## Welle 2: Layout & Theme System — ✅ DONE

**Scope:** Persistent sidebar + Light/Dark Mode + Header-Redesign + Responsive Container

**Status:** Day 5-6, ~15 commits

**Was rauskam:**
- `feat(layout): persistent desktop sidebar nav (#A4)` — sidebar permanent, nicht overlay
- `feat(theme): dark/light mode toggle (#A5)` — initial system
- **Phase 2 Theme-Rollout**: 7 pages + 16 sub-components light/dark
- **Phase 2 Theme-Bugfixes**: /admin/stats, /pireps/pending, /pireps/new, /pireps/[id]
- **Header-Bar Redesign**: Avatar, rank-display under username, Select-Airline-placeholder
- **HTML5-semantik**: `<header>`/`<nav>`/`<main>` semantic structure
- **Scroll-container** in `<main>`, sidebar + header bleiben fix
- **Responsive page-container** widening für large-screens
- **Side-by-side admin sections** für besseren screen-real-estate-use
- **Tailwind v4 fixes**: `@source inline()` für content-detection-bug, picture-ternary fix für Turbopack

**Lessons learned in CLAUDE.md persisted:**
- HMR / cache / Tailwind v4 quirks section
- Hydration-bug-debugging-flow

---

## Welle 3: Airline-Catalogs & Routes-Management — ✅ DONE

**Scope:** System-curated catalogs (airports + aircraft-types) mit request-flow + Routes-CRUD + airline-admin-role

**Status:** Day 5-6, ~30 commits — biggest single-wave-shipping

**Was rauskam:**

### Catalogs & Request-Flow
- Phase 1 schema (system-curated, request-flow tier: verified/unverified)
- 4 server actions für request-flow (submit, approve, reject, list)
- Airport browse + request flow + admin queue (`/airports`, `/airports/[icao]`, `/airports/request`, `/admin/requests`)
- Aircraft-type browse + request flow (`/aircraft-types`, `/aircraft-types/request`)
- **OurAirports.com bulk import**: 85.266 Airports mit multi-faceted filter UI
- **Runways/Frequencies/Navaids** bulk import (3 separate tables für airport-detail-tables)
- **AirportDB.io fallback-enrichment** für non-OurAirports approvals
- **Airport-autocomplete-component** mit debounced search über 85k airports
- Live-search im airport-browser
- Row-clickable airports + runway-operations hinweis

### Airline-Admin-Foundation
- `feat(roles): add airline-admin role + new sidebar Airline-Admin sektor`
- `refactor(roles): extract APPROVER_ROLES to @/lib/roles + add airline-admin`
- `feat(admin): /admin/pilots zeigt alle user von VAM-System (cross-airline)`
- `feat(admin/pilots): add search, filter, sort, pagination`
- `feat(admin/pilots): bulk-actions for role-assign + airline-remove`
- `feat(airline): member-table mit voll-feature-set + joinedAirlineAt-tracking`
- `feat(airline): ICAO-code editierbar mit guard-checkbox`
- `ui(airline): disable admin-rolle im member-dropdown für non-admins`
- Role-management UI (#20)
- Airline-admin-panel (#21)
- User-invite-flow (#22, `/invite/[token]`)

### Routes-Management (heute Tag 6)
- `feat(airline-routes): manual CRUD foundation für routen-verwaltung` — server-actions ~474 zeilen, list/new/edit pages, route-form, delete-button
- `feat(airline-routes): CSV-bulk-import mit template + anleitung` — 7-stufige validation-pipeline, 4-state UI, 7 example-rows
- Sidebar nav: "Routen-Verwaltung"
- Airport-autocomplete in route-form

---

## Welle 4: Hub-System & Free-Flight — ⏳ NEXT

**Scope:** Hub-management (multi-hub) + Free-Flight-Mode + Position-Tracking + Jumpseat + Flight-Type-Enum + Economy-Foundation-Flags

**Why this welle is next:** Hub-system blockt alles spätere (economy, free-flight, position). Free-flight ist user-explicit-wunsch. Economy-foundation-flags kosten nichts und ersparen massive zukunfts-migration.

**Risk:** 🟡 mittel — schema-changes touch many existing tables, aber alle additive

### Features

#### Schema-Extension (commit 1)
```prisma
// Hub-System
model Airline {
  // ... existing
  primaryHubIcao    String?
  hubs              AirlineHub[]
  economyEnabled    Boolean @default(false)  // Foundation für economy
}

model AirlineHub {
  id        String   @id @default(cuid())
  airlineId String
  airportId String
  isPrimary Boolean  @default(false)
  @@unique([airlineId, airportId])
}

// Free-Flight + Flight-Types
enum FlightType {
  SCHEDULED
  CHARTER
  POSITIONING
  TRAINING
  FREE
}

model Pirep {
  // ... existing
  flightType    FlightType @default(SCHEDULED)
  passengerCount Int?  // Nullable, für economy-vorbereitung
  cargoKg       Int?
}

model Booking {
  // ... existing
  flightType    FlightType @default(SCHEDULED)
}

// Position-Tracking
enum LocationSource {
  MANUAL
  PIREP
  ACARS
  VATSIM
  IVAO
  JUMPSEAT
}

model User {
  // ... existing
  baseIcao              String?
  currentLocationIcao   String?
  currentLocationSource LocationSource @default(MANUAL)
  currentLocationAt     DateTime?
  economyEnabled        Boolean @default(false)
}

// Jumpseat
model JumpseatTransfer {
  id        String   @id @default(cuid())
  userId    String
  fromIcao  String
  toIcao    String
  reason    JumpseatReason
  createdAt DateTime @default(now())
}

enum JumpseatReason {
  RETURN_TO_HUB
  HUB_TO_HUB
  POSITIONING
  ADMIN_TRANSFER
}
```

#### Hub-Admin-UI (commit 2)
- Page `/airline/hubs` mit hub-liste + add/remove
- Set-primary-hub action
- Sidebar-display der primary-hub im header
- Position-display in sidebar (current location als ICAO)

#### Free-Flight & Position (commit 3)
- Tab in `/bookings/new`: "Geplant" vs. "Free-Flight"
- Free-flight-form ohne route-restriction (just airport-pair)
- Auto-position-update nach PIREP-approval
- Jumpseat-page `/jumpseat` (return-to-hub button + manual-jumpseat)
- Position-display auf pilot-profile

### Dependencies
- ✅ Welle 3 (catalogs müssen da sein für airport-references)

### Definition of Done
- Airline-admin kann hubs managen, primary-hub setzen
- Pilot kann free-flight buchen und filen
- Position wird automatisch updated nach PIREP-approval
- Jumpseat funktioniert mit audit-trail
- FlightType-enum ist überall durch (existing PIREPs default-migrated zu SCHEDULED)
- Economy-flags existieren auf User + Airline (alle false default)

### Effort-Band: ~6h coding (3 commits) — **1-2 wochen kalender-zeit**

### Cross-References
- `Economy-Karriere.md` Section 54 (Schema-Vorbereitungs-Strategie)
- `airline-ops-roadmap.md` Phase 3 (Hubs CRUD)

---

## Welle 5: Fleet & Aircraft Management — ⏳ NEXT

**Scope:** Fleet-CRUD (aircraft-groupings) + Aircraft (Airframe) CRUD + Operational depth

**Why this welle:** Routes-CRUD ist da, fleet ist die natürliche fortsetzung. Pilot kann routes nicht sinnvoll fliegen ohne aircraft die dazu passen.

**Risk:** 🟡 mittel — substantial UI-work, aber pattern bekannt aus routes-CRUD

### Features

#### Fleet-CRUD
- Page `/airline/fleet` mit fleet-liste
- Per-fleet aircraft-zuordnung (subfleet-pattern aus phpVMS)
- Per-fleet SimBrief-defaults (existing override-hierarchie)
- Per-fleet operational-rules (max-range, runway-requirements)

#### Aircraft (Airframe) CRUD
- Page `/airline/fleet/[id]/aircraft` mit aircraft-liste
- Add/edit/remove individual airframes (D-AISL etc.)
- Registration, hours-flown, current-location-airport
- Aircraft.homeIcao endlich genutzt
- Status: active / maintenance / retired

#### Operational Depth
- Aircraft-availability-check (booked vs. free vs. AOG)
- Aircraft-current-position-tracking (basierend auf last-PIREP)
- Auto-positioning nach PIREP-arrival

### Dependencies
- ✅ Welle 3 (Aircraft-Type-catalog must exist — done)
- ⚠️ Welle 4 (hub-system für home-base) — kann auch parallel

### Definition of Done
- Airline-admin kann fleets managen
- Aircraft können hinzugefügt werden mit homeIcao
- Booking-flow zeigt nur verfügbare aircraft basierend auf location + availability
- Aircraft-status (active/maintenance/retired) workflow funktioniert

### Effort-Band: 8-12 tage coding (siehe airline-ops-roadmap Phase 2)

### Cross-References
- `airline-ops-roadmap.md` Phase 2

---

## Welle 6: Personnel Management — 🔵 SOON

**Scope:** Pilot-Roster + Rank-Management UI für airline-admin + Promotion/Demotion-workflow

**Why this welle:** Member-table existiert (Welle 3) aber nur basic. Vollständiges personnel-management braucht promotion-workflow, rank-history, performance-stats.

**Risk:** 🟢 niedrig

### Features
- Pilot-roster mit advanced-filters (rank, hours, last-flight-date, status)
- Promotion-workflow (manual oder auto-on-criteria)
- Rank-history-tracking
- Performance-overview per pilot (last 30 days)
- Inactive-pilot-detection + reminder
- Termination-workflow (entry-date, exit-date, reason)

### Dependencies
- ✅ Welle 3 (member-table foundation)

### Effort-Band: 5-7 tage coding (siehe airline-ops-roadmap Phase 5)

---

## Welle 7: Schedule Generator — 🔵 SOON

**Scope:** Recurring schedules (every-monday-08:00 LH918) + Cron für availability + Pilot-bidding

**Why this welle:** Routes existieren, aber sind aktuell "always available". Real airlines haben schedules. Pilot-bidding-system erlaubt fairness im picking.

**Risk:** 🟡 mittel

### Features
- Schedule-CRUD (per route: which days/times)
- Cron-job: täglich next-7-days bookings auto-create as "open"
- Pilot-bidding: pilot kann auf schedule-slot bidden
- Auto-assign nach bidding-window (seniority-based oder lottery)
- Schedule-conflict-detection (same-pilot-same-time)

### Dependencies
- ✅ Welle 3 (routes)
- ⚠️ Welle 5 (fleet — schedule braucht aircraft-zuordnung)
- ⚠️ Welle 6 (personnel — bidding braucht pilot-management)

### Effort-Band: 5-7 tage coding (airline-ops-roadmap Phase 6)

---

## Welle 8: Branding & Public Pages — 🔵 SOON

**Scope:** Custom airline-pages (logo, colors, banner, public-faceing landing) + multi-tenant-routing

**Why this welle:** Multi-tenant-foundation ist da, aber jede airline sieht gleich aus. Public-pages sind marketing für VAs.

**Risk:** 🟢 niedrig — pure UI/branding work

### Features
- Airline-logo upload + display
- Airline-color-palette (primary, accent)
- Airline-banner-image
- Public landing-page `/[airline-slug]` (z.B. `/lufthansa-virtual`)
- Public roster, fleet, routes, recent-PIREPs
- Custom-domain-support (long-term, post-MVP)

### Dependencies
- Alles vorherige

### Effort-Band: 3-5 tage coding (airline-ops-roadmap Phase 7)

---

## Welle 9: ACARS Phase 2-5 — ✅ KERN DONE (post-MVP siehe acars-client-roadmap.md)

**Scope:** Pairing-Code-System + Heartbeat-API + Eigener ACARS-Client + Premium-Features

**Status update (13. Mai 2026):** Kern-funktionalität ist abgeschlossen. Alle ursprünglichen Phase 2-3 (Pairing-System + ACARS-Client + Auto-PIREP) sind live. Tech-stack-entscheidung: WPF + .NET 10 statt Electron + node-simconnect (siehe [`acars-architecture.md`](../acars-architecture.md) Status-Update-Block).

**Was done ist:**
- Phase 2: Pairing-code-system mit DPAPI-token-storage (M1, commit `715e409`)
- Phase 3: Heartbeat-API + replay-queue (M2-M3, commits `86ab693`, `f23701c`, plus M3.5-M3.8)
- Phase 4: Eigener ACARS-client als WPF tray-app (M4, commits `0406014`, `ee96422`, `81c8163`, `fa2dafa`) + CLI-companion + Velopack auto-update (M5, commits `4afbf2c`, `31e2d74`, `2f246a3`)
- Auto-PIREP (BLOCK_ON → Draft-PIREP): `apps/web/lib/acars/auto-pirep.ts` + `generate-pirep.ts`, plus client-side BLOCK_ON event emission (commit `3da5cca`)
- Plus options #3-#14: Re-pair button, live phase-time, audio cue, pre-flight checklist, aircraft auto-detect, OFP-import, crash-recovery, multi-sim-detection
- Latest: in-app pairing dialog (caee3ee)
- Released versions 0.1.0 + 0.1.1 via Velopack-packages
- GitHub auto-release CI on tag push (commit `c448bfb`)

**Was OFFEN ist (post-MVP):** Diese sind jetzt eigenständige roadmap in [`acars-client-roadmap.md`](./acars-client-roadmap.md):

- **Welle A — Polish & Hardening** (🟢, 1-2 wochen): Telemetry-tab, network-loss UX, token-rotate, changelog-viewer, error-reporting → 0.2.0 release
- **Welle B — PIREP-Enrichment** (🟡, 3-5 wochen): Wettervergleich (sim vs real METAR), ATC-frequenz-tracking, replay-export, aircraft-substitution-flow, route-suggestions
- **Welle C — Anti-Cheat & Reliability** (🟡, 2-3 wochen): Time-acceleration-detection, position-jump-detection, admin-review-queue, pairing-smoketest-CI
- **Welle D — Plattform-Expansion** (🟠, 2-3 monate): X-Plane support, multi-device, white-label, code-signing-cert, demo-mode
- **Welle E — Advanced Features** (🔴, 2-4 monate): Live-streaming sidecar, voice-commands, mobile-companion, multi-pilot-cockpit, heatmap

**Originale Phase-5-vision (Premium-features mit ATC + Wetter) ist also nicht "weg" sondern in die neue ACARS-client-roadmap migriert wo sie als Welle B/E granular spezifiziert sind.**

### Dependencies
- ✅ Welle 0 (DataSource-enum) — done

### Cross-References
- [`acars-architecture.md`](../acars-architecture.md) — System-design (with status-update header for current state)
- [`acars-client-roadmap.md`](./acars-client-roadmap.md) — **Single source of truth für ACARS-client post-MVP-roadmap**
- [`simconnect-data-catalog.md`](../simconnect-data-catalog.md)

---

## Welle 10: OBS-Overlay Phase 4-9 — 🔵 LATER

**Scope:** OBS-overlay polish + erweiterte daten + push-updates + trail-visualization + streamer-erweiterungen

**Why this welle:** OBS-Phase-1-3 ist done, aber phase 4+ fehlt. Streamer-features warten darauf.

**Risk:** 🟡 mittel

### Features
- Phase 4: Polish + Multi-Layout-Testing
- Phase 5: Erweiterte daten (passenger-count, cargo-weight)
- Phase 6: Push-updates (websocket statt polling)
- Phase 7: Trail-visualization on overlay
- Phase 8: Streamer-erweiterungen (chat-integration teaser)
- Phase 9: Multi-Layout-Editor

### Dependencies
- ✅ Welle 0 (overlay foundation)

### Effort-Band: 2-4 wochen (siehe `todo-obs-overlay-system.md`)

---

## Welle 11: Twitch-OAuth Foundation — 🔵 LATER

**Scope:** Twitch-OAuth-Account-Linking + EventSub-WebSocket-bridge + Settings-page

**Why this welle:** Foundation für alle twitch-features (sim-write UND economy-revenue). Müssen wir bauen bevor channel-points/subs funktionieren.

**Risk:** 🟡 mittel — twitch-API ist gut dokumentiert

### Features
- Twitch-OAuth-flow (same pattern as VATSIM/IVAO)
- `/api/auth/twitch/callback`
- User.twitchUserId, twitchAccessToken, twitchRefreshToken, twitchUsername
- Settings-page section "Streaming"
- EventSub-WebSocket-bridge (im bot)
- Subscribe-types: redemption, subscribe, gift, cheer, hype-train, stream-online/offline
- Test-event-handler (logs only, kein game-impact)

### Dependencies
- ✅ Welle 0 (auth-foundation)

### Effort-Band: 1-2 wochen

### Cross-References
- `twitch-to-sim-integration.md` (sim-write side)
- `Economy-Karriere.md` Section 25 (revenue side)

---

## Welle 12: Economy MVP — 💭 VISION

**Scope:** Wallet + Transactions + Simple revenue/expense per flight + Pilot-salary

**Why this welle:** Erste echte economy-erfahrung. Foundation für alle späteren economy-features (career, stocks, twitch-tickets).

**Risk:** 🟠 hoch — invasive change, viele tables, decimal-arithmetic

### Features
- Wallet-model (USER/AIRLINE/AIRLINE_PAYROLL/SYSTEM)
- Transaction-model (immutable audit-log)
- Inter-wallet-transfer-helper (atomic)
- Per-flight revenue-calc (passenger-count × ticket-fare × load-factor)
- Per-flight expense-calc (fuel + landing-fees + ground-handling + catering)
- Simple pilot-salary (per-block-hour × rank-rate)
- Wallet-display in pilot-dashboard
- Transaction-history page
- Per-user opt-in toggle (`User.economyEnabled` aus Welle 4)

### Dependencies
- ✅ Welle 4 (economyEnabled flag, FlightType, passengerCount, cargoKg)
- ⚠️ Welle 5 (aircraft für fuel-calc)

### Effort-Band: 2-3 wochen coding (siehe `Economy-Karriere.md` Section 6+7)

---

## Welle 13: Career-System Basics — 💭 VISION

**Scope:** Lizenzen-system + Type-Ratings + Karriere-rank-progression mit license-requirements

**Why this welle:** Macht ranks sinnvoll. Pilot muss licenses earnen, nicht nur stunden sammeln.

**Risk:** 🟠 hoch — substantial UI + game-design work

### Features
- License-model (SPL → PPL → IR → ME → CPL → MCC → ATPL + TRI/TRE)
- TypeRating-model (per aircraft-class)
- License-aircraft-mapping (kann pilot dieses aircraft fliegen?)
- Flight-school-NPCs an specific airports
- Theory-/Practical-/Sim-stunden tracking
- Exam-flights mit pass/fail criteria
- License-purchase via wallet
- Auto-block booking wenn pilot keine license (in CAREER mode)
- Per-user opt-in toggle (`User.careerEnabled`)

### Dependencies
- ✅ Welle 12 (wallet existiert für payments)

### Effort-Band: 3-4 wochen coding (siehe `Economy-Karriere.md` Sections 13-19)

---

## Welle 14: Twitch Channel-Points → Tickets — 💭 VISION

**Scope:** Channel-point-redemption → ticket → revenue + Stream-overlay-integration + Sub-VIPs + Bits-Cargo

**Why this welle:** Streamer-USP. Erste echte content-creator-monetization.

**Risk:** 🟠 hoch — needs Welle 11 + 12 stable

### Features
- Custom-rewards-creation via twitch-API (pilot creates "Buy ticket" reward)
- Redemption-handler (viewer redeem → ticket added to active-flight)
- Sub-tier-mapping (T1=economy, T2=business, T3=first)
- Bits-cargo-mapping (1 bit = 1 kg)
- Hype-train-revenue-multiplier (+10/20/35/50/75%)
- Stream-overlay browser-source `/overlay/stream/[pilot]`
- Real-time event-display in overlay
- Per-pilot revenue-share (wallet split airline/pilot)
- Charity-flight-mode (alle revenue → real-world charity)
- Non-streamer-fairness checks (capped +30% bonus)

### Dependencies
- ✅ Welle 11 (twitch-OAuth + EventSub)
- ✅ Welle 12 (wallet + revenue-calc)

### Effort-Band: 3-4 wochen coding (siehe `Economy-Karriere.md` Sections 25-34)

---

## Welle 15: Aircraft-Economy & Maintenance — 💭 VISION

**Scope:** Aircraft-ownership-types + Maintenance-checks (A/B/C/D) + Fuel-economy + Insurance

**Why this welle:** Macht aircraft zu real economy-asset.

**Risk:** 🟡 mittel — additive wenn fundament steht

### Features
- AircraftOwnerType enum (AIRLINE/USER/LEASE_OPERATING/LEASE_FINANCE/WET_LEASE)
- Aircraft-marketplace (buy/sell, used-pricing)
- Maintenance-schedule (A-Check 500h, B-Check 6mo, C-Check 18mo, D-Check 6-10y)
- Maintenance-cost auto-deducted, downtime-tracking
- Fuel-economy mit dynamic-prices per airport
- FBO-system (player-owned fuel-storage, bulk-buy/sell)
- Insurance-premium calc + claims-system

### Dependencies
- ✅ Welle 12 (economy core)
- ✅ Welle 5 (aircraft-management)

### Effort-Band: 3-4 wochen coding (siehe `Economy-Karriere.md` Sections 9-12)

---

## Welle 16: Stock-Market (VAMSE) — 💭 VISION

**Scope:** VAM Stock Exchange + IPO-mechanik + Trading-engine + Funds + Bonds + Insider-rules

**Why this welle:** Differentiator. Niemand anders hat das. Aber: very-high effort.

**Risk:** 🔴 sehr-hoch — order-matching-engine ist substantial

### Features
- AirlineListing-model (ticker, IPO-price, total-shares)
- ShareHolding-model (per wallet)
- StockOrder-model (market/limit/stop-loss/iceberg)
- Order-matching-engine (atomic fills)
- Daily-stock-price-recalc job
- Trading-hours enforcement
- Broker-fees als sinks (3% wie EVE)
- Bonds + bond-rating-system (S&P-style)
- Commodities (fuel-futures)
- Insider-trading-window-enforcement

### Dependencies
- ✅ Welle 12 (economy core)
- ✅ Welle 15 (aircraft-economy für reale assets)

### Effort-Band: 4-6 wochen coding (siehe `Economy-Karriere.md` Sections 20-24)

---

## Welle 17: Multi-Airline (Alliances + M&A) — 💭 VISION

**Scope:** Alliance-system + M&A-mechanics + Subsidiaries + Codeshare

**Why this welle:** Macht VAM zu real-world-mirror. Major airlines werden, kleine joinen alliances.

**Risk:** 🔴 sehr-hoch — governance-mechanics komplex

### Features
- Alliance-model + AllianceMembership
- Airline-acquisition-flow (friendly + hostile takeover)
- Shareholder-vote-system
- Subsidiary-model (parent-airline relation)
- Codeshare-agreements
- Anti-trust-rules (system-admin enforced)
- Pilot-rights in M&A (severance, retention)

### Dependencies
- ✅ Welle 16 (stock-market für hostile takeover)

### Effort-Band: 4-6 wochen coding (siehe `Economy-Karriere.md` Sections 40-43)

---

## Welle 18: Events + Seasonal-Content — 💭 VISION

**Scope:** Real-world-event-mirror + Disaster-events + Live multi-pilot events + Seasonal-pässe

**Why this welle:** Engagement-driver. Macht VAM lebendig.

**Risk:** 🟡 mittel — content-heavy, code moderate

### Features
- Real-world-event-API (christmas, olympics, world-cup, hajj)
- Disaster-events (volcanic, fuel-crisis, weather, ATC-strike)
- Live multi-pilot events (round-the-world, Berlin-airlift-recreation)
- Seasonal-pass mit free + premium tier
- Daily-quests + streaks
- Founder's-day, inaugural-flights, retirement-tours

### Dependencies
- ✅ Welle 12 (revenue-multiplier-foundation)

### Effort-Band: 2-3 wochen + ongoing content (siehe `Economy-Karriere.md` Sections 44-50)

---

## Welle 19: Mobile + VR + Voice-ATC — 💭 LONG-TERM

**Scope:** Mobile-companion-app + VR-airport-tours + Voice-ATC-bot + Smart-watch-integration

**Why this welle:** Premium-features. Long-term-vision.

**Risk:** 🔴 sehr-hoch — substantial new platforms

### Features
- Mobile-companion-app (push-notifications, basic-stats, stock-monitoring)
- VR-airport-tours (browser-WebVR vor flight)
- Voice-ATC-bot (AI-generated für non-VATSIM-pilots)
- Smart-watch-app (Apple Watch widget)
- Spotify-integration für boarding-music

### Dependencies
- Alles davor stable

### Effort-Band: Quartale (siehe `Economy-Karriere.md` Section 53.29-53.31)

---

# TEIL C — STRATEGIE

## 25. Wellen-Selection-Strategie

### 25.1 Kurzfristig (nächste 2-4 wochen)

**Empfehlung: Wellen 4 + 5 sequenziell**

```
Welle 4 (Hub + Free-Flight + Economy-Foundation-Flags)
   ↓
Welle 5 (Fleet + Aircraft Management)
```

**Begründung:**
- Welle 4 ist enabler für viele zukunfts-wellen (economy, free-flight)
- Welle 5 ist natural-next-step nach routes (Welle 3 done)
- Beide sind 🟡-risk, kalibriert in 1-2 wochen je
- Beide haben klare value-props für pilots heute

### 25.2 Mittelfristig (nächste 4-12 wochen)

**Empfehlung: Wellen 6 + 7 + 8 mixed mit Welle 10 oder 11**

Wenn streamer-fokus: Welle 11 (Twitch-OAuth) parallel zu 6+7  
Wenn airline-features-fokus: Wellen 6 + 7 + 8 sequenziell  
Wenn ACARS prio: Welle 9 frühzeitig anfangen (langer flow)

### 25.3 Langfristig (3-12 monate)

**Empfehlung: Welle 12 + 13 als economy-block, dann 14**

```
Welle 11 (Twitch-OAuth) ────────┐
                                ↓
Welle 12 (Economy MVP)  ───────→ Welle 14 (Twitch-Tickets)
                                
Welle 13 (Career-Basics) parallel zu 12 (related but independent)
```

### 25.4 Wellen die jederzeit dazwischen passen

Diese können **als pause-fillers** zwischen großen wellen gemacht werden:
- **Awards-UI** (model existiert seit tag 1, ~2-3 tage UI)
- **Sceneries-UI** (model existiert seit tag 1, ~2-3 tage UI)
- **FeatureFlag-toggle-system** (model existiert, ~1-2 tage UI)
- **Discord-role-mapping-UI** (~1-2 tage UI)

Diese sind kleine, abgeschlossene tasks die motivation high halten zwischen großen wellen.

---

## 26. Parallele Tracks vs. Sequenzielle Wellen

### 26.1 Wann parallel arbeiten

Manche wellen sind **echte dependencies** (Welle 14 braucht Welle 11+12). Andere sind **independent** und können parallel:

**Independent groups:**
- Welle 9 (ACARS) ist independent von 5/6/7/8/11/12
- Welle 10 (OBS) ist independent von 5/6/7/8
- Welle 13 (Career-basics) braucht 12 aber nicht 14/15/16

**Strategie:** Wenn dual-context (z.B. abends ACARS-research, tagsüber feature-shipping) — parallele tracks erlaubt. Wenn solo-fokus, sequenziell empfohlen.

### 26.2 Cognitive-Load-Empfehlung

Aus calibration-data: factor-shifts wenn context-switch zu groß:
- 1 welle aktiv: factor 0.27 (additive features)
- 2 wellen parallel: factor ~0.4 (mehr context-switching)
- 3+ wellen parallel: factor 0.6+ (zu fragmentiert)

**Solo-Empfehlung: 1 welle haupt + 1 welle nebenbei.**

---

## 27. Visualisierung: Welle-Dependencies

```
✅ Welle 0 (Foundation)
   ↓
✅ Welle 1 (Booking-Loop)
   ↓
✅ Welle 2 (Layout & Theme)        ✅ Welle 3 (Catalogs + Routes-CRUD)
                                       ↓
                                   ⏳ Welle 4 (Hub + Free-Flight + Foundation-Flags)
                                       ↓
                                   ⏳ Welle 5 (Fleet + Aircraft Management)
                                       ↓
                            ┌──────────┼──────────┐
                            ↓          ↓          ↓
                    🔵 Welle 6   🔵 Welle 7   🔵 Welle 8
                    (Personnel)  (Schedule)   (Branding)
                                                       
                    🔵 Welle 9 (ACARS Phase 2-5) — independent track
                    🔵 Welle 10 (OBS Phase 4-9) — independent track
                    🔵 Welle 11 (Twitch-OAuth) — required für Welle 14
                                       ↓
                                   💭 Welle 12 (Economy MVP)
                                       ↓
                            ┌──────────┼──────────┐
                            ↓          ↓          ↓
                    💭 Welle 13   💭 Welle 14   💭 Welle 15
                    (Career)     (Twitch-Tickets) (Aircraft-Economy)
                                                       ↓
                                                   💭 Welle 16 (Stock-Market)
                                                       ↓
                                                   💭 Welle 17 (Multi-Airline M&A)

💭 Welle 18 (Events) — passt zu jedem zeitpunkt nach Welle 12
💭 Welle 19 (Mobile/VR/Voice-ATC) — long-term, alles davor stable
```

---

## Schluss-Bemerkung

**Wo wir heute stehen (03. Mai 2026, Tag 6):**
- Wellen 0, 1, 2, 3 sind ✅ DONE
- Welle 4 ist als nächstes empfohlen (hub + free-flight + economy-foundation)
- Welle 5 als direkter nachfolger
- Wellen 6-19 als roadmap für die nächsten 6-24 monate

**Operative empfehlung für nächste session:**
1. **Welle 4 starten** — schema-extension commit (hub-tables, FlightType-enum, economy-flags, position-tracking)
2. **Welle 4 commit 2** — Hub-admin-UI
3. **Welle 4 commit 3** — Free-flight tab + jumpseat-page + position-display
4. **Pause** und entscheiden: Welle 5 als nächstes oder zwischendurch ein "filler" (Awards-UI z.B.)

**Tracker-Hinweis:**  
Wenn eine welle abgeschlossen ist, status auf ✅ ändern + commit-references hinzufügen + datum eintragen. So ist diese roadmap immer current und gibt klaren überblick "was haben wir erreicht".

---

*Dokument-version: 1.0 — initial wellen-roadmap.*  
*Cross-referenced gegen: vam-master-roadmap.md, 2026-05-01-airline-ops-roadmap.md, Economy-Karriere.md, twitch-to-sim-integration.md, acars-architecture.md, todo-obs-overlay-system.md, TOMORROW.md*  
*Authored by Claude Opus 4.7 (1M context) basierend auf vollständiger .md-recherche + git-log-analyse von 187 commits.*
