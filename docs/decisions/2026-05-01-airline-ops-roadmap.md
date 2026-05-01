# Airline Ops — Complete Roadmap

Stand: 2026-05-01. Roadmap für das Theme **"Airline rundum verwalten und
anzeigen"** auf Basis des aktuellen `cc-experiment` branch state.

Aufgeteilt in 9 Phasen, ungefähr nach Dependencies sortiert. Jede Phase ist
einzeln shippable — du kannst jederzeit pausieren oder umsortieren. Total
veranschlagter Aufwand: **38-58 Tage Coding-time**, mit Realistik-Faktor
1.5x = **~12-18 Wochen** part-time.

---

## Vision

Eine virtual airline läuft nicht nur, sie *fühlt sich nach airline an*.
Das heißt:

- **Verwalten**: Flotte, Personal, Routen, Schedule, Branding, Communications
  alles als first-class managed assets, nicht nur Listen
- **Anzeigen**: Pilots sehen "wo ist meine 747 gerade", admins sehen "wie
  performed unsere Hub EDDF", besucher sehen eine richtige public-page
- **Operations**: Tagesgeschäft hat einen UI-flow — announcements, NOTAMs,
  schedule-changes, HR-actions
- **Analytics**: KPIs, reports, on-time-performance, pilot-rankings —
  airline-leadership kann entscheiden statt raten
- **Identität**: Jede airline hat brand-farben, livery, hubs, eigene rank-
  hierarchie, eigene awards — nicht alle sehen identisch aus

Die Roadmap deckt die ersten 4 Aspekte komplett ab. Identität (Branding) ist
Phase E, dort kürzer als oben angedeutet weil Schema-erweiterung minimal ist.

---

## Current state baseline (was schon existiert)

**Schema-side (relevante models)**:
- `Airline` — icao, iata, name, callsign, logoUrl, simBriefOverlay
- `Aircraft` — registration, type (string), homeIcao, active, simBriefOverlay
- `Fleet` — airline×type kombination mit type-level overlay
- `Airport` — full lat/lon/elevation/country/city
- `Route` — flightNumber, departure/arrival, aircraft assignment, distanceNm
- `Rank` — airline-spezifisch, minFlightHours, order
- `Award` + `UserAward` — schema fertig, granting-logic fehlt
- `Pirep` — voller state-machine flow
- `Booking` — voller state-machine mit scheduledDeparture
- `LiveSession` + `LiveSessionPosition` — live tracking foundation
- `DiscordRoleMapping` — discord integration scaffold
- `Invite` — invite flow funktioniert
- `User` — basic fields, role, airline assignment

**UI-side (relevante pages)**:
- `/airline` — basic admin panel mit member-list (Phase 6 ge-shipped)
- `/airline/pilots` — member-list view
- `/airline/routes` — route-list view
- `/admin/roles` — role/permission management
- `/invite/[token]` — invite consume flow
- `/dashboard` — pilot-zentrisch, airline-info als card
- Sidebar mit AIRLINE + ADMIN sections (Phase 6 ge-shipped)

**Was funktioniert end-to-end**:
- Auth + role gates (`requireAdmin`, `requireAirlineAdmin`)
- PIREP submit → review → approve flow
- Booking → SimBrief dispatch → PIREP-completion 1:1 link
- Rank progression (computed from flightHours)
- Override-hierarchy für SimBrief (Airline → Fleet → Aircraft → Route)

Die Roadmap baut darauf auf — keine Schema-revolution, nur targeted additions.

---

## Roadmap Übersicht

| Phase | Theme | Days | Calibrated | Unlocks |
|---|---|---|---|---|
| **A** | Aircraft & Fleet Depth | 4-6 | 6-9 | Real fleet view, type-rating gates (C) |
| **B** | Hubs & Stations | 2-4 | 3-6 | Multi-hub airlines, hub-dashboards |
| **C** | Personnel Depth | 4-6 | 6-9 | HR actions, type-rated booking gates |
| **D** | Schedule Generator | 5-7 | 7-10 | Auto-bookings, route-frequency |
| **E** | Branding & Public Identity | 3-5 | 4-7 | Public airline pages, recruiting CTA |
| **F** | Ops Communications | 4-6 | 6-9 | Announcements, SOPs, bulletins |
| **G** | Analytics & Reporting | 6-9 | 9-13 | KPI dashboards, performance reports |
| **H** | Award/Achievement Activation | 3-5 | 4-7 | Existing schema → live unlock-system |
| **I** | Multi-Airline & Alliance | 7-10 | 10-15 | Inter-airline transfers, alliances |
| | **Total** | **38-58** | **55-85** | |

Calibrated faktor 1.5x basiert auf Phase 6 actuals: reine coding-time matched
estimates, aber learning + edge-cases + bugs frassen ~50% extra. Bei Schema-
heavy phases (A, C, D) ist der faktor eher 1.3, bei UI-heavy (E, G) eher
1.7-2.0.

---

## Phase A — Aircraft & Fleet Depth (4-6 Tage)

**Ziel**: "Wo ist welches Flugzeug? Wann ist Maintenance fällig? Wer darf's
fliegen?" wird beantwortbar.

### Schema-Erweiterungen

```prisma
// NEU: Aircraft type catalog (separate from Fleet which is airline×type)
model AircraftType {
  id            String     @id @default(cuid())
  icaoType      String     @unique  // "B738", "A320", "A20N"
  name          String                // "Boeing 737-800"
  manufacturer  String                // "Boeing"
  category      String                // "narrow_body" | "wide_body" | "regional" | "cargo"
  rangeNm       Int                   // typische range
  capacityPax   Int                   // typische pax-config
  cruiseSpeedKt Int                   // typical cruise
  fuelBurnKgH   Int                   // average kg/h
  imageUrl      String?
  aircraft      Aircraft[]
  ratings       AircraftTypeRating[]
}

// EXTEND Aircraft: jetzt mit ops-relevanten daten
model Aircraft {
  // existing: id, registration, airlineId, type, homeIcao, active, simBriefOverlay
  // ADD:
  aircraftTypeId      String?       // FK zu AircraftType
  aircraftType        AircraftType? @relation(fields: [aircraftTypeId], references: [id])
  status              String        @default("active")  // active | maintenance | stored | retired
  currentLocationIcao String?       // wo steht's gerade (last PIREP arrival)
  totalHours          Float         @default(0)
  totalCycles         Int           @default(0)
  acquiredAt          DateTime      @default(now())
  retiredAt           DateTime?
  livery              String?       // image URL or "default"
  maintenance         Maintenance[]
}

// NEU: Maintenance tracking
model Maintenance {
  id          String    @id @default(cuid())
  aircraftId  String
  aircraft    Aircraft  @relation(fields: [aircraftId], references: [id])
  type        String    // "A_check" | "B_check" | "C_check" | "D_check" | "AD" | "SB"
  dueAtHours  Float?    // bei welchen total hours fällig
  dueAtDate   DateTime?
  completedAt DateTime?
  notes       String?
  createdAt   DateTime  @default(now())

  @@index([aircraftId, completedAt])
}
```

### Server actions / business logic

- `app/airline/fleet/actions.ts`:
  - `addAircraftType()` (admin)
  - `assignAircraftType(aircraftId, typeId)` (für legacy aircraft die nur
    `type` String haben — backfill helper)
  - `markMaintenanceCompleted(maintenanceId, completedAt)`
  - `scheduleMaintenance(aircraftId, type, dueAtHours, dueAtDate)`
- PIREP-completion-hook: bei `approvePirep` → aircraft.totalHours +=
  flightTime, totalCycles += 1, currentLocationIcao = arrival.icao

### UI

- `/airline/fleet` — list page mit filter (type, status, hub), columns:
  Reg | Type | Status | Location | Total Hours | Next Maint
- `/airline/fleet/[reg]` — detail page mit:
  - Header: registration + type + livery thumbnail
  - Stats: total hours/cycles, acquired date, age
  - Recent flights (last 10 from PIREPs)
  - Maintenance schedule (upcoming + history)
  - Edit-button (admin only)
- `/airline/fleet/types` — aircraft type catalog (admin can add/edit types)

### Dependencies

- None außer existing Aircraft + PIREP flow

### Risiken

- Backfill für existing Aircraft (ohne aircraftTypeId) — script statt manual
- Maintenance-rules sind initial simple ("next C-check at 6000h"), echte
  type-spezifische rules kommen später
- Total-hours computation aus historic PIREPs muss einmal als migration
  nachgezogen werden

---

## Phase B — Hubs & Stations (2-4 Tage)

**Ziel**: Airlines können mehrere Hubs haben, Hub-spezifische ops-views.

### Schema

```prisma
model Hub {
  id          String   @id @default(cuid())
  airlineId   String
  airline     Airline  @relation(fields: [airlineId], references: [id])
  airportId   String
  airport     Airport  @relation(fields: [airportId], references: [id])
  isPrimary   Boolean  @default(false)  // main hub
  description String?
  createdAt   DateTime @default(now())

  @@unique([airlineId, airportId])
  @@index([airlineId, isPrimary])
}

// EXTEND Aircraft
model Aircraft {
  // ADD:
  homeHubId String?   // welcher hub ist heimat — sauberer als String homeIcao
  homeHub   Hub?      @relation(fields: [homeHubId], references: [id])
}

// EXTEND User
model User {
  // ADD:
  baseHubId String?   // welcher hub ist deine base
  baseHub   Hub?      @relation(fields: [baseHubId], references: [id])
}
```

### UI

- `/airline/hubs` — list page mit allen hubs der airline
- `/airline/hubs/[icao]` — hub dashboard:
  - Heute geplante departures/arrivals (aus Bookings)
  - Aktive aircraft an diesem hub
  - Pilots based hier
  - Recent activity (PIREPs from/to)
- Admin actions: addHub, removeHub, setPrimary

### Dependencies

- Phase A für aircraft.homeHubId migration

### Risiken

- Airport-FK braucht backfill (DLH hat homeIcao="EDDF" → Hub mit
  airportId=EDDF). Auto-migration script.

---

## Phase C — Personnel Depth (4-6 Tage)

**Ziel**: Pilot-management ist nicht nur "list of users", sondern HR.

### Schema

```prisma
// EXTEND User: employment fields
model User {
  // ADD:
  hireDate       DateTime  @default(now())
  status         String    @default("active")  // active | leave | inactive | terminated
  statusUntil    DateTime? // wenn leave, bis wann
  leftAt         DateTime?
  employeeId     String?   @unique  // "DLH-001"
  lastActiveAt   DateTime? // updated on every server action
  rankAcquiredAt DateTime?
  ratings        AircraftTypeRating[]
  hrEvents       HrEvent[]
}

// NEU: Type-rating tracking — welcher pilot darf welche typen fliegen
model AircraftTypeRating {
  id             String       @id @default(cuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id])
  aircraftTypeId String
  aircraftType   AircraftType @relation(fields: [aircraftTypeId], references: [id])
  acquiredAt     DateTime     @default(now())
  acquiredById   String?      // admin who granted
  acquirer       User?        @relation("RatingGrantor", fields: [acquiredById], references: [id])
  notes          String?

  @@unique([userId, aircraftTypeId])
}

// NEU: HR event log (audit trail)
model HrEvent {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  type        String   // "hired" | "promoted" | "demoted" | "leave_started" | "leave_ended" | "terminated" | "transferred" | "rating_granted"
  fromValue   String?  // alter rank/status
  toValue     String?  // neuer rank/status
  reason      String?
  performedById String?
  createdAt   DateTime @default(now())

  @@index([userId, createdAt])
}
```

### Server actions

`app/airline/hr/actions.ts`:
- `promoteUser(userId, newRankId, reason)` — creates HrEvent
- `changeUserStatus(userId, status, until?, reason)`
- `grantTypeRating(userId, aircraftTypeId, notes)`
- `terminateUser(userId, reason)` — soft-delete via leftAt
- `transferToHub(userId, hubId)` — for multi-hub airlines

### UI

- `/airline/pilots` — upgraded with sort/filter (rank, hours, status, hub)
- `/airline/pilots/[id]` — pilot detail:
  - Header: avatar, name, rank, hire-date, employee-id
  - Stats: total hours, flights, on-time %
  - Type-ratings list
  - Recent flights
  - HR-event timeline (admin only)
  - Action panel (admin only): Promote, Status change, Grant rating, Terminate
- `/airline/hr` — admin-only HR dashboard:
  - Active count, leave count, recent hires, recent terminations
  - Pending promotions (pilots near rank threshold)
  - Inactivity warnings (lastActiveAt > 30d)

### Booking gate addition

Bei booking creation: check `pilot.ratings.includes(aircraft.aircraftType)`.
Wenn nicht: error "Du hast kein Type Rating für B738. Frage einen Admin."

### Dependencies

- Phase A für aircraftType + ratings
- Phase B optional für hub-basierte transfers

---

## Phase D — Schedule Generator (5-7 Tage)

**Ziel**: Routes haben einen wiederkehrenden Schedule, Bookings werden
automatisch erzeugt.

### Schema

```prisma
model RouteSchedule {
  id              String   @id @default(cuid())
  routeId         String
  route           Route    @relation(fields: [routeId], references: [id])
  daysOfWeek      String   // "1,2,3,4,5" für Mo-Fr (ISO 1=Monday)
  departureTimeUtc String  // "12:30"
  validFrom       DateTime @default(now())
  validUntil      DateTime?
  active          Boolean  @default(true)
  // optional: bestimmtes aircraft / type assignment
  preferredAircraftTypeId String?
  preferredAircraftType   AircraftType? @relation(fields: [preferredAircraftTypeId], references: [id])
  createdAt       DateTime @default(now())

  @@index([routeId, active])
}

// EXTEND Booking
model Booking {
  // ADD:
  generatedFromScheduleId String?
  generatedFromSchedule   RouteSchedule? @relation(fields: [generatedFromScheduleId], references: [id])
  isPublished             Boolean        @default(false) // ungebucht-but-published vs only-on-demand
  // currently userId required; published-but-unbooked needs userId nullable
  // OR new model PublishedFlight (preferred — siehe risk-section)
}
```

### Cron job

`apps/api/src/jobs/generate-schedule.ts` (via NestJS @Cron oder eigenen runner):
- Läuft nightly um 00:00 UTC
- Generiert Bookings für die nächsten 7 Tage aus aktiven Schedules
- Skipped existing (idempotent via `generatedFromScheduleId + scheduledDeparture` unique-pair)

### UI

- `/airline/routes/[id]/schedule` — schedule editor pro route:
  - Day-of-week selector (Mo Tu We Th Fr Sa Su pillen)
  - Time picker (UTC)
  - Validity window
  - Preferred aircraft type
- `/airline/schedule` — wochen-view aller scheduled flights über fleet
- `/airline/schedule/calendar` — kalender-view per hub

### Dependencies

- Phases A + C für aircraft-type und type-rating gates

### Risiken

- **Big design decision**: Booking als published-flight verwenden (current
  schema, userId nullable bis pilot bucht) ODER neues PublishedFlight model
  einführen, Booking bleibt user-spezifisch. Empfehlung: **neues Model**,
  wegen state-machine-cleanliness. Booking bleibt "ein user hat sich für
  X gemeldet", PublishedFlight ist "die airline plant X". Das ist saubere
  separation, kostet aber initial mehr Aufwand. Adjustiere phase auf 6-8d
  wenn dieser pfad gewählt.

---

## Phase E — Branding & Public Identity (3-5 Tage)

**Ziel**: Jede Airline hat ein eigenes Gesicht. Public page für recruiting.

### Schema

```prisma
// EXTEND Airline
model Airline {
  // ADD:
  founded             DateTime?
  description         String?    // markdown about
  websiteUrl          String?
  brandColorPrimary   String?    // "#FFCC00" für DLH yellow
  brandColorSecondary String?
  motto               String?    // "Connecting Europe"
  publicPageEnabled   Boolean    @default(true)
}
```

### UI

- `/airline/branding` — admin editor:
  - Color pickers (primary, secondary)
  - Logo URL upload
  - Description (markdown)
  - Founded date
  - Motto
  - Toggle public-page-enabled
- `/airlines/[icao]` — public page (kein auth required):
  - Hero with brand-colors, logo, motto
  - About (description)
  - Fleet showcase (top 5 aircraft images)
  - Active hubs map
  - Top pilots leaderboard (anonymized if user wants)
  - Recent activity feed
  - "Apply to join" CTA → invite request
- Brand-color application: ThemeProvider extension liest airline.brandColors
  und appliziert als CSS-vars für authenticated users der airline.
  Override-hierarchy: user-theme > airline-brand > default-indigo.

### Dependencies

- None (kann parallel zu A-D laufen)

### Risiken

- Brand-color clash mit dark/light theme — needs accessibility check
  (contrast ratios). Validation in editor.

---

## Phase F — Ops Communications (4-6 Tage)

**Ziel**: Tagesgeschäft hat einen kommunikations-channel.

### Schema

```prisma
model Announcement {
  id          String   @id @default(cuid())
  airlineId   String
  airline     Airline  @relation(fields: [airlineId], references: [id])
  authorId    String
  author      User     @relation(fields: [authorId], references: [id])
  title       String
  body        String   // markdown
  pinned      Boolean  @default(false)
  publishedAt DateTime @default(now())
  expiresAt   DateTime?

  @@index([airlineId, publishedAt])
}

model Document {
  id          String   @id @default(cuid())
  airlineId   String
  airline     Airline  @relation(fields: [airlineId], references: [id])
  category    String   // "SOP" | "Manual" | "Training" | "Reference"
  title       String
  body        String   // markdown
  version     String   @default("1.0")
  authorId    String
  author      User     @relation(fields: [authorId], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([airlineId, category])
}

model Bulletin {
  id          String   @id @default(cuid())
  airlineId   String
  airline     Airline  @relation(fields: [airlineId], references: [id])
  type        String   // "NOTAM" | "SafetyAlert" | "ScheduleChange"
  severity    String   // "info" | "warning" | "critical"
  title       String
  body        String
  validFrom   DateTime @default(now())
  validUntil  DateTime?
  affectedAirports String[]  // ICAO codes
  createdAt   DateTime @default(now())

  @@index([airlineId, validUntil])
}

// User-side read-tracking (so dashboard can show "3 unread announcements")
model AnnouncementRead {
  id             String       @id @default(cuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id])
  announcementId String
  announcement   Announcement @relation(fields: [announcementId], references: [id])
  readAt         DateTime     @default(now())

  @@unique([userId, announcementId])
}
```

### UI

- `/airline/announcements` — list + create form (admin)
- `/airline/announcements/[id]` — detail view
- `/airline/docs` — categorized list of SOPs/manuals
- `/airline/docs/[id]` — markdown viewer with version history
- `/airline/bulletins` — current active bulletins, severity-color-coded
- Dashboard widget: "3 ungelesene Announcements" + "1 NOTAM aktiv"
- Sidebar: notification dot wenn ungelesene Announcements

### Dependencies

- None

### Risiken

- Markdown rendering — needs sanitization (DOMPurify auf server side,
  oder remark mit safe-mode). Don't allow embedded scripts/iframes.

---

## Phase G — Analytics & Reporting (6-9 Tage)

**Ziel**: Airline leadership kann fragen "wie performen wir?" und kriegt
Zahlen.

### Computed metrics (no schema changes — alles aus existing data)

- **OTP** (On-Time Performance): % of PIREPs where `flightTimeMin` is within
  ±10% of `route.estimatedMinutes`
- **Completion rate**: % of bookings that reach Approved PIREP vs cancelled/expired
- **Fleet utilization**: % of fleet that flew at least once in last 7 days
- **Hub activity**: arrivals + departures per hub per day
- **Pilot productivity**: hours per active pilot per month
- **Route popularity**: bookings count per route per month

### UI

- `/airline` — upgrade to dashboard with KPI cards:
  - Active pilots (this month vs last month)
  - Total flight hours this month
  - OTP last 30 days
  - Fleet utilization
  - Top routes
  - Recent rank-ups
- `/airline/reports` — generated reports:
  - Monthly summary (PDF)
  - Pilot performance (per pilot, per period)
  - Route performance
  - Fleet utilization timeline
- `/airline/leaderboard` — full leaderboard:
  - Tabs: This Month | This Year | All Time
  - Sort modes: hours, flights, rank, OTP, longest single flight
  - Export to CSV

### Tech notes

- KPI computation: server actions mit raw SQL für aggregation efficiency
  (Prisma's groupBy ist limited). Cache in memory mit 5min TTL — ist
  acceptable für non-realtime dashboard.
- PDF export: `puppeteer` oder `@react-pdf/renderer`. Empfehlung
  react-pdf wegen bundle-size + style-control.

### Dependencies

- Phases A-D für rich data sources
- Phase B für hub-level metrics

---

## Phase H — Award/Achievement Activation (3-5 Tage)

**Ziel**: Existing Award/UserAward schema → live unlock-system.

### Schema additions

```prisma
// EXTEND Award
model Award {
  // existing: id, name, description, iconUrl, criteria (Json), createdAt
  // ADD:
  category    String?  // "milestone" | "rank" | "type-rating" | "longhaul" | "special"
  rarity      String   @default("common")  // common | rare | epic | legendary
  airlineId   String?  // null = system-wide award, set = airline-specific
  airline     Airline? @relation(fields: [airlineId], references: [id])
  active      Boolean  @default(true)
  triggerType String   // "first_flight" | "total_hours_X" | "type_rating_X" | "manual"
  triggerData Json?    // {hours: 100} oder {typeId: "..."} etc.
}
```

### Trigger engine

`packages/db/awards.ts`:
- `evaluateAwardsForUser(userId)` — runs all active triggers, grants any
  matched awards (creates UserAward).
- Hook: rufen aus PIREP-approve, type-rating-grant, rank-promote.
- Retroactive scan: admin-action `awards.scanAll()` — runs für alle users
  (für initial-grant nach award-creation).

### UI

- `/airline/awards` — admin: create/edit airline-spezifische awards
- `/dashboard` — badge gallery widget: deine awards + 3 next-to-unlock
- `/pilots/[id]` — public profile: awards display
- `/airline/leaderboard` — awards-count column

### System-wide awards seed

Seed initiale awards die für alle airlines gelten:
- "First Flight" — first approved PIREP
- "100 Hour Club", "500 Hour Club", "1000 Hour Club"
- "Long Haul Pilot" — flightTime > 600min
- "Heavy Iron" — type-rating für wide-body
- "Globe Trotter" — flights to 25 different airports
- "Iron Pilot" — 30 days streak
- "Type Master" — 5 type-ratings

### Dependencies

- Phase A für type-rating triggers
- Phase C für employment-event triggers

---

## Phase I — Multi-Airline & Alliance (7-10 Tage)

**Ziel**: Wenn das System 5+ airlines hat, brauchen wir cross-airline
features. Bis dahin in der Roadmap zwecks Vollständigkeit.

### Schema

```prisma
model Alliance {
  id          String   @id @default(cuid())
  name        String
  iata        String?  @unique
  description String?
  logoUrl     String?
  founded     DateTime @default(now())

  members AllianceMember[]
}

model AllianceMember {
  id         String   @id @default(cuid())
  allianceId String
  alliance   Alliance @relation(fields: [allianceId], references: [id])
  airlineId  String
  airline    Airline  @relation(fields: [airlineId], references: [id])
  joinedAt   DateTime @default(now())
  active     Boolean  @default(true)

  @@unique([allianceId, airlineId])
}

model AirlineTransferRequest {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  fromAirlineId   String
  fromAirline     Airline  @relation("TransferFrom", fields: [fromAirlineId], references: [id])
  toAirlineId     String
  toAirline       Airline  @relation("TransferTo", fields: [toAirlineId], references: [id])
  status          String   @default("pending")  // pending | approved | rejected | cancelled
  reason          String?
  createdAt       DateTime @default(now())
  resolvedAt      DateTime?
  resolvedById    String?
  resolver        User?    @relation("TransferResolver", fields: [resolvedById], references: [id])
  hourCreditMode  String   @default("partial")  // none | partial | full
}
```

### UI

- `/airlines` — public directory of all airlines (with public-page-enabled)
- `/airlines/transfer` — pilot transfer request flow
- `/airline/transfers` — admin: incoming transfer requests
- `/alliances` — alliance directory (when implemented)
- Cross-airline leaderboard option

### Dependencies

- Phases A-H sollten complete sein (sonst gibt's wenig zu cross-airline'n)

### Risiken

- Hour-credit-policies sind politische Decisions (Wieviel credit
  bei transfer? 0%, 50%, 100%?). Per-target-airline configurable.
- Existing data-references (Pireps, Bookings) bleiben mit
  fromAirline assoziiert — historie bleibt zugeordnet, current-airline
  ist user.airlineId.

---

## Empfohlene Reihenfolge

### Falls du strategisch maximalen value pro woche willst

```
Woche 1-2:    Phase A (Aircraft & Fleet Depth)         ← unlocks vieles
Woche 3:      Phase B (Hubs)                           ← schmal, building-block
Woche 4-5:    Phase C (Personnel)                      ← parallel-able mit B
Woche 6-7:    Phase E (Branding + Public)              ← außerordentlich sichtbarer impact
Woche 8-10:   Phase G (Analytics)                      ← braucht A-C-data, hier dann fully ready
Woche 11-12:  Phase F (Ops Comms)                      ← polishes day-to-day
Woche 13-15:  Phase D (Schedule Generator)             ← nice-to-have, nicht critical
Woche 16-17:  Phase H (Awards Activation)              ← engagement-layer
Woche 18-20:  Phase I (Multi-Airline)                  ← nur wenn 5+ airlines existieren
```

Logik: A ist foundational, danach B+C parallel weil minimal overlap. E vorgezogen
weil "public airline page" sofort dem owner +1 motivation gibt. G nach C
sinnvoll weil dann genug data exists. D später weil es erst lohnt wenn
mehrere routes existieren. H als engagement-cherry on top. I letzter.

### Falls du minimalen viable airline ops willst (~3-4 Wochen)

```
A → B → C → E (skip D, F, G, H, I für now)
```

Das gibt dir: fleet-management, hubs, HR, branding + public page. Damit ist
"airline rundum verwalten und anzeigen" zu ~70% gedeckt für den single-
airline-case.

### Falls du nur Quick-Wins für eigene Airline ohne UI-explosion willst

```
A (4-6d) + Phase E (3-5d) + minimal slice von G (KPI dashboard, 3d)
= ~10-14 Tage für massive perceived value
```

---

## Decision Points (vor Phase A)

Bevor du startest, klare Antworten auf:

1. **PublishedFlight vs Booking-with-null-userId** (für Phase D) — empfehle
   eigenes PublishedFlight model, aber Phase A-C entscheiden das nicht, kannst
   später entscheiden.

2. **AircraftType backfill strategy** — manual (du editierst die 1-5 existing
   aircraft) oder script (Aircraft.type-string parser → AircraftType.icaoType
   match). Empfehlung: script + manual fallback.

3. **Maintenance-rules** — initial simple ("C-check alle 6000h") oder
   type-spezifisch ("B738 hat C-check alle 6000h, A330 alle 7500h"). Empfehle
   simple v1, type-specific v2.

4. **Brand-color application scope** — nur public-page (no theme conflict)
   oder full app (overrides indigo accent für members of that airline).
   Empfehle full app mit dark/light contrast validation.

5. **HR audit-log retention** — lifetime oder 2-jahre-rolling? Empfehle
   lifetime (records sind klein, audit-value ist hoch).

6. **Schedule generator timezone** — alles UTC oder per-hub local time?
   Empfehle UTC storage + UI-display in user-prefs-timezone.

---

## Was NICHT in dieser Roadmap ist

Diese Themen overlappen mit Airline Ops, gehören aber zu anderen Visionen:

- **Economy/Finance Simulation** (revenue, fuel-cost, P&L) — eigenes vision-
  theme, würde Phase D+G stark erweitern wenn integriert
- **ACARS Client** — pilot-side tool, nicht airline-side management
- **IVAO Live Sync** — bereits foundation in LiveSession, Erweiterung ist
  pilot-facing
- **Tours & Events** — community-loop, nicht airline-management
- **Training & Exam System** — separate career-theme, könnte Phase C+H
  speisen
- **Discord Bot** — integration-theme, role-mappings sind im Schema, der
  bot selbst ist eigenes Projekt

Wenn du eines davon mit Airline Ops fusionieren willst, sag bescheid —
dann passe ich entsprechende Phasen an.

---

## Zusammenfassung

Roadmap deckt **9 Phasen über 38-58 Tage** Coding-time, calibrated **55-85
Tage** real-time, **~12-18 Wochen part-time**.

Output bei Vollendung:
- 5 neue Schema-models (AircraftType, Maintenance, Hub, AircraftTypeRating,
  HrEvent, RouteSchedule, Announcement, Document, Bulletin, Alliance,
  AllianceMember, AirlineTransferRequest, AnnouncementRead) — **13 models**
- 12 neue Pages (`/airline/fleet`, `/airline/fleet/[reg]`, `/airline/hubs`,
  `/airline/hubs/[icao]`, `/airline/pilots/[id]`, `/airline/hr`,
  `/airline/schedule`, `/airline/branding`, `/airlines/[icao]`,
  `/airline/announcements`, `/airline/docs`, `/airline/bulletins`,
  `/airline/awards`, `/airline/transfers`, `/alliances`) — ~15 pages
- ~30 server actions
- 1 cron job
- ~10-15 system-wide awards
- Public airline directory + per-airline public page
- Inter-airline transfer flow
- Brand-customization across UI

Update-cadence: jede phase ist single-PR-shippable, also continous-delivery
gegen die haupt-airline (Lufthansa Virtual). Du kannst jederzeit pausieren,
re-priorisieren, oder phasen umsortieren — die Dependencies sind documented.
