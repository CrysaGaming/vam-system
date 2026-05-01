# Airline Ops — Complete Roadmap (v2)

Stand: 2026-05-01. Roadmap für das Theme **"Airline rundum verwalten und
anzeigen"**, restructured um den expliziten user-ask:

> "Routen welche die airline anbieten soll erstellen, bearbeiten, löschen
> kann, das gleiche dann für fleet, aircraft, hubs, airports."

V2 vs v1: **Resource-CRUD-first** statt feature-first. Die ersten 4 Phasen
geben dem airline-admin volle Kontrolle über die foundational data —
Airports, Aircraft-Types, Aircraft, Fleet, Hubs, Routes. Erst danach kommen
operational depth, schedule, branding, analytics.

11 Phasen, **48-72 Tage Coding**, calibrated **72-108 Tage** real-time =
**~14-22 Wochen** part-time.

---

## Vision

Eine virtual airline läuft nicht nur, sie *fühlt sich nach airline an*.
Das heißt:

- **Verwalten**: Airline-admin kann jede core-resource via UI managen —
  Airports, Aircraft, Fleet, Routes, Hubs, Personal — vollständige CRUD,
  nicht nur view
- **Anzeigen**: Pilots sehen "wo ist meine 747 gerade", admins sehen "wie
  performed unsere Hub EDDF", besucher sehen eine richtige public-page
- **Operations**: Tagesgeschäft hat einen UI-flow — announcements, NOTAMs,
  schedule-changes, HR-actions
- **Analytics**: KPIs, reports, on-time-performance, pilot-rankings —
  airline-leadership kann entscheiden statt raten
- **Identität**: Jede airline hat brand-farben, livery, hubs, eigene rank-
  hierarchie, eigene awards — nicht alle sehen identisch aus

---

## Aktueller CRUD-Stand (gap analysis)

| Resource | Schema | Admin-UI | Status |
|---|---|---|---|
| Airline (own settings) | ✅ | ✅ `/airline` settings-form | Basic, kann erweitert werden |
| Member-list | ✅ | ✅ `/airline` member-table | List-view, keine HR-actions |
| Invite | ✅ | ✅ `/airline` invite-section | CRUD funktioniert |
| Role | ✅ | ✅ `/admin/roles` | CRUD funktioniert |
| **Airport** | ✅ | ❌ | Schema da, keine Admin-UI |
| **AircraftType** | ❌ | ❌ | Weder Schema noch UI (currently nur `Aircraft.type` als String) |
| **Fleet** | ✅ | ❌ | Schema da, keine UI um Types zu Airline hinzuzufügen |
| **Aircraft** (airframe) | ✅ | ❌ | Schema da, keine UI um Tails zu managen |
| **Route** | ✅ | ⚠️ | Nur public read-only `/routes`, KEIN admin CRUD |
| **Hub** | ❌ | ❌ | Weder Schema noch UI |
| Pirep | ✅ | ✅ `/pireps` | Submit + review flow funktioniert |
| Booking | ✅ | ✅ `/bookings` | CRUD funktioniert |

**Gap**: 5 von 6 core-resources die der user explizit nannte (Routes,
Fleet, Aircraft, Hubs, Airports) haben **keine Admin-CRUD-UI**. Plus
AircraftType fehlt komplett als Schema. Das ist der zentrale Block den
diese Roadmap adressiert.

---

## Multi-Tenancy & Isolation

Die Roadmap ist **multi-tenant-by-design**. Jeder airline-admin sieht und
verwaltet ausschließlich die eigene airline. DLH-admin sieht keine BAW-
aircraft, kann keine BAW-routes editieren, sieht keine BAW-announcements.
Das ist nicht eine Phase-11-Erweiterung — es ist ab Phase 1 baseline.

### Resource-Isolation-Matrix

| Ownership | Resources | Isolation-Mechanismus |
|---|---|---|
| **Airline-owned** | Aircraft, Fleet, Route, Hub, Booking, Pirep, Rank, Invite, RouteSchedule, PublishedFlight, Announcement, Document, Bulletin, HrEvent (indirekt via User) | `airlineId` FK auf jedem record + auth-gate `requireAirlineAdmin` |
| **User-owned** (innerhalb airline) | UserAward, AircraftTypeRating | `userId` FK; user hat selbst airlineId |
| **Shared global** | Airport, AircraftType | Kein airlineId — reality-shared (EDDF ist EDDF, B738 ist B738) |
| **System-wide** | Award (system-tier), Alliance | airlineId nullable; system-admin curated |

### Auth-Gate-Pattern

Jede airline-admin server-action geht durch `requireAirlineAdmin(resource)`:

```ts
async function requireAirlineAdmin(resourceAirlineId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true, role: { select: { name: true } } }
  });

  if (user?.role?.name !== 'admin') throw new Error('Not admin');
  if (user.airlineId !== resourceAirlineId) throw new Error('Wrong airline');

  return user;
}
```

Konsequenz: DLH-admin kann nicht
- BAW-aircraft list aufrufen (server-action throws 403)
- BAW-routes editieren
- BAW-HR-data sehen
- BAW-announcements posten oder lesen

### Shared-Resource-Handling

**Airport** (geographische realität — EDDF ist EDDF für jeden):
- **Create**: jeder airline-admin (validates ICAO-uniqueness global)
- **Edit**: airline-admin kann editieren; `lastEditedById` getrackt für audit
- **Delete**: nur wenn keine FK-references existieren; system-admin only
- **Conflict**: gleichzeitige edits → last-write-wins v1 (mit audit-trail).
  Edit-history-table als Phase-1.5 falls 5+ aktive airline-admins
- **Risk**: DLH-admin könnte EDDF.latitude verändern und BAW-routes brechen.
  Mitigation: lat/lon-edits bedürfen system-admin approval. Andere fields
  (name, city) sind safe.

**AircraftType** (engineering realität — B738 ist B738 für jeden):
- **Create**: airline-admin direct (v1)
- **Edit**: airline-admin kann eigene creations editieren; system-admin
  alle. Bestehende fields (rangeNm, capacity) sind quasi-immutable.
- **Delete**: nur wenn kein aircraft references; system-admin only
- **Conflict**: airline-admins sollten gleiche `icaoType`-namen agreed
  haben (B738 ist global standardized via ICAO-doc-8643). Custom variants
  (B738MAX9, etc.) → system-admin merges duplikate. v2 könnte "verified"
  flag mit approval-flow haben.

### Globale-Uniqueness-Constraints (per airline)

| Constraint | Scope | Begründung |
|---|---|---|
| `Aircraft.registration` | global unique | Real-world registrations sind weltweit unique (D-AIZA gehört einem airframe) |
| `Route.flightNumber` | unique per airline | LH123 und LH123 dürfen nicht in DLH parallel; aber LH123 (DLH) und BA123 (BAW) ok |
| `Rank.name` | unique per airline | DLH kann "First Officer" haben, BAW auch |
| `Hub airportId` | unique per airline | DLH kann nicht 2x EDDF als hub haben; BAW darf EDDF auch als hub haben |
| `Airport.icao` | global unique | Aviation-standard |
| `AircraftType.icaoType` | global unique | ICAO-standard |
| `Airline.icao` | global unique | Aviation-standard |

### Public-facing Multi-tenancy

- `/airlines` — directory aller airlines mit `publicPageEnabled=true`
- `/airlines/[icao]` — public airline page, URL-isoliert pro airline
- Brand-colors (Phase 7) appliziert basierend auf URL-icao
- Jede public page zeigt nur eigene fleet/hubs/pilots/routes
- Recruiting-CTA (apply-to-join) per airline isoliert

### Cross-airline Interaktionen (nur Phase 11)

Das einzige wo airlines sich "sehen":
- Public directory `/airlines`
- Pilot-transfer-requests mit dual-approval (from-airline + to-airline)
- Optional cross-airline-leaderboards (opt-in, anonymized default)
- Alliances mit mutual consent

Bevor Phase 11 läuft das system **vollständig isoliert**.

### Database-Query-Discipline

Jede query muss airlineId-scoped sein:

```ts
// ✓ KORREKT
const aircraft = await prisma.aircraft.findMany({
  where: { airlineId: session.user.airlineId, ...filters }
});

// ✗ FALSCH — leaked across airlines
const aircraft = await prisma.aircraft.findMany({
  where: filters
});
```

Existing codebase-pattern (per `app/airline/actions.ts`, `app/admin/roles/actions.ts`)
enforced das schon. Phase 5 Personnel extrahiert `lib/auth-guards.ts` mit
helpers `requireAirlineAdmin()`, `requireAirlineMember()`, `scopeToAirline()`.
Code-review-checkliste wird das als hard rule führen.

### Performance bei Skalierung

Mit proper composite-indexes auf `(airlineId, ...)`:
- Aircraft-list pro airline: O(log n) unabhängig von gesamt-aircraft-count
- Routes-map: scoped zu single airline, kein cross-airline-load
- Analytics-queries: airlineId in jeder WHERE-clause
- Index-strategy bereits in existing schema sichtbar (`@@index([airlineId, status])`
  auf Pirep, etc.)

Bei 100 airlines × 50 aircraft × 1000 PIREPs = 5M PIREP-rows, queries pro
airline sehen weiterhin nur 1000 rows wenn richtig indexed. Das ist
production-ready ohne sharding.

### Was als airline-admin in der eigenen airline managed wird

Per Phase visualisiert (was DLH-admin sieht in seiner eigenen UI):

| Phase | Was DLH-admin selbst managen kann |
|---|---|
| 1 | Eigene preferred airports anlegen, eigene aircraft-types anlegen (alle anderen airlines können diese auch nutzen) |
| 2 | Eigene Fleet (Aircraft-Types die DLH operiert), eigene Aircraft (D-AIZA, D-AIBL, ...) — voll isoliert |
| 3 | Eigene Hubs (EDDF, EDDM, ...) — BAW kann auch EDDF als hub haben, das ist parallel |
| 4 | Eigene Routes (LH918, LH400, ...) — voll isoliert |
| 5 | Eigene Pilots — voll isoliert |
| 6 | Eigene RouteSchedules + PublishedFlights — voll isoliert |
| 7 | Eigene Branding-config + public page — voll isoliert |
| 8 | Eigene Announcements/SOPs/Bulletins — voll isoliert |
| 9 | Eigene Analytics/Reports — voll isoliert (KPIs sind airline-scoped) |
| 10 | Eigene custom Awards (zusätzlich zu system-wide) — voll isoliert |
| 11 | Cross-airline-flows (transfers, alliances) — explizit |

### Was zwischen airlines geshared wird

Nur die unbedingt-shared resources:
- **Airport-catalog** (jede airline nutzt EDDF, EDDM, etc.)
- **AircraftType-catalog** (jede airline kann B738 operieren)
- **System-wide awards** (z.B. "First Flight" gilt für alle airlines)
- **Alliances** (Phase 11 — explicit shared structure)

Alles andere ist hard-isolated. Wenn 100 airlines im system sind, sieht
jeder airline-admin nur seine 1/100 der daten.

---


## Roadmap Übersicht

| Phase | Theme | Days | Cal | Was es liefert |
|---|---|---|---|---|
| **1** | Airport & Aircraft-Type Catalogs | 3-5 | 4-7 | Foundation: alles andere referenced diese |
| **2** | Fleet & Aircraft Management | 8-12 | 12-18 | Type-fleet + Tail-CRUD + operational depth |
| **3** | Hubs CRUD | 2-4 | 3-6 | Multi-hub airlines, Hub-zuweisungen |
| **4** | Routes Management | 4-6 | 6-9 | Vollständige Route-CRUD mit Map-Picker |
| **5** | Personnel Management | 5-7 | 7-10 | HR actions, type-ratings, audit log |
| **6** | Schedule Generator | 5-7 | 7-10 | RouteSchedule + Cron + Auto-bookings |
| **7** | Branding & Public Identity | 3-5 | 4-7 | `/airlines/[icao]` showcase + brand-colors |
| **8** | Ops Communications | 4-6 | 6-9 | Announcements + SOPs + Bulletins |
| **9** | Analytics & Reporting | 6-9 | 9-13 | KPI dashboard + OTP + PDF reports |
| **10** | Award Activation | 3-5 | 4-7 | Trigger engine für existing Award schema |
| **11** | Multi-Airline & Alliance | 7-10 | 10-15 | Inter-airline transfers, alliances |
| | **Total** | **50-76** | **72-111** | |

Phasen 1-4 (Foundation CRUD) = **17-27 Tage** = ~3-5 Wochen part-time. Wenn
du nur das willst, ist das ein klar abgegrenzter scope.

---

## Phase 1 — Airport & Aircraft-Type Catalogs (3-5 Tage)

**Ziel**: Die zwei "shared resource" catalogs auf die alles andere
referenced. Foundation phase.

### 1.1 Airport CRUD

#### Was existiert
- `Airport` schema mit icao, iata, name, city, country, lat/lon, elevation
- Keine UI zum Erstellen/Editieren

#### Auth-Strategy
Airports sind **shared resources** (mehrere airlines nutzen EDDF). Daher:
- **Create**: Airline-admin darf neue Airports anlegen (wenn ICAO frei)
- **Edit**: Airline-admin darf editieren → markiert als `lastEditedBy`. Bei
  conflict mit anderer airline-admin: system-admin entscheidet.
- **Delete**: Soft-delete via `active=false`. Hard-delete nur system-admin
  und nur wenn keine FK-references existieren.

#### Schema-Erweiterung

```prisma
model Airport {
  // existing: id, icao, iata, name, city, country, latitude, longitude, elevation
  // ADD:
  active        Boolean   @default(true)
  createdById   String?
  createdBy     User?     @relation("AirportCreator", fields: [createdById], references: [id])
  lastEditedById String?
  lastEditedBy  User?     @relation("AirportEditor", fields: [lastEditedById], references: [id])
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

#### UI

- `/airports` — public read-only catalog (existing /routes-style)
- `/admin/airports` — system-admin full CRUD with conflict detection
- `/airline/airports` — airline-admin: create new airport, edit-with-suggest,
  view all (filtered to active by default)

Forms:
- Create: ICAO (required, validated as 4 letters), IATA (optional 3 letters),
  Name, City, Country (dropdown), Lat (-90..90), Lon (-180..180), Elevation
- Edit: same fields, with "Last edited by [user] on [date]" indicator

### 1.2 Aircraft-Type Catalog

#### Schema

```prisma
model AircraftType {
  id            String     @id @default(cuid())
  icaoType      String     @unique  // "B738", "A20N", "A359"
  name          String                // "Boeing 737-800"
  manufacturer  String                // "Boeing"
  category      String                // "narrow_body" | "wide_body" | "regional" | "cargo"
  rangeNm       Int
  capacityPax   Int
  cruiseSpeedKt Int
  fuelBurnKgH   Int
  imageUrl      String?
  active        Boolean    @default(true)
  createdById   String?
  createdBy     User?      @relation(fields: [createdById], references: [id])
  createdAt     DateTime   @default(now())

  aircraft      Aircraft[]
  fleets        Fleet[]    // wenn Fleet via FK auf type-id refactored wird
  ratings       AircraftTypeRating[]   // Phase 5
  schedules     RouteSchedule[]        // Phase 6
}
```

#### Seeding

Initial seed mit 15 häufigen typen: B738, A20N, A21N, A319, A320, A321, A332,
A333, A359, A35K, A388, B748, B772, B773, B788, CRJ9, E190.

#### UI

- `/admin/aircraft-types` — system-admin CRUD
- `/airline/aircraft-types` — airline-admin: read-only browse, request-new
  (creates entry mit `active=false` bis system-admin approved). v1 simpler:
  airline-admin darf direkt anlegen, system-admin kann später duplikate
  mergen.

### 1.3 Migration

- Backfill script: scan `Aircraft.type` strings (existing simple String
  field), match against AircraftType.icaoType, set Aircraft.aircraftTypeId
- Same für Fleet.type → Fleet.aircraftTypeId
- Keep old `type` String columns für 1 release als fallback, dann remove

### Risiken

- AircraftType backfill kann fail wenn existing strings nicht ICAO sind
  (z.B. "Boeing 737" statt "B738"). Manual fixup-pass nötig.
- Conflict-resolution für concurrent airport edits — initial: last-write-wins
  + history table als Phase 2-feature

---

## Phase 2 — Fleet & Aircraft Management (8-12 Tage)

**Ziel**: Volles Aircraft + Fleet management — die airline-admin kann ihre
Flotte komplett verwalten. Inkl. operational depth.

### 2.1 Fleet CRUD

Fleet = airline×type Kombination mit type-level SimBrief overlay.

#### UI

- `/airline/fleet/types` — Übersicht: Welche Aircraft-Types operiert diese
  Airline?
- "Add type to fleet" → modal mit AircraftType picker + simBrief overlay
  editor
- Per fleet entry: edit overlay, remove from fleet (mit warning falls
  aircraft existieren)

#### Schema-Refactor

Fleet hat aktuell `type: String`. Migration auf `aircraftTypeId: String`
mit FK. Backwards compatible über Phase-1 backfill.

### 2.2 Aircraft (Airframe) CRUD

#### Was existiert
- `Aircraft` mit registration, type (String), homeIcao, active, simBriefOverlay
- Keine Admin-UI

#### Schema-Erweiterung

```prisma
model Aircraft {
  // existing: id, airlineId, registration, type, homeIcao, active, simBriefOverlay
  // ADD:
  aircraftTypeId      String?
  aircraftType        AircraftType? @relation(fields: [aircraftTypeId], references: [id])
  status              String        @default("active")  // active | maintenance | stored | retired
  currentLocationIcao String?       // updated bei PIREP-approve
  totalHours          Float         @default(0)         // computed from PIREPs
  totalCycles         Int           @default(0)
  acquiredAt          DateTime      @default(now())
  retiredAt           DateTime?
  livery              String?
  homeHubId           String?       // Phase 3
  homeHub             Hub?          @relation(fields: [homeHubId], references: [id])
  maintenance         Maintenance[]
}

model Maintenance {
  id          String    @id @default(cuid())
  aircraftId  String
  aircraft    Aircraft  @relation(fields: [aircraftId], references: [id])
  type        String    // "A_check" | "B_check" | "C_check" | "D_check"
  dueAtHours  Float?
  dueAtDate   DateTime?
  completedAt DateTime?
  notes       String?
  createdAt   DateTime  @default(now())
}
```

#### UI

- `/airline/fleet` — list page mit:
  - Columns: Reg | Type | Status | Location | Total Hours | Next Maint | Hub
  - Filter: type, status, hub
  - Sort: hours-desc, recently-updated, registration
  - "Add Aircraft" button → form
  - Per row: edit, retire, delete (delete only if no PIREPs reference)
- `/airline/fleet/[reg]` — detail page mit:
  - Header: registration, type, livery thumbnail
  - Stats card: total hours, cycles, age, status
  - Location block: aktueller airport, home-hub
  - Recent flights: last 10 PIREPs
  - Maintenance schedule: upcoming + history
  - SimBrief overlay editor (existing Json-editor pattern aus airline-settings)
  - Action panel: Schedule maintenance, Mark for retirement, Edit basics
- `/airline/fleet/new` — create form:
  - Required: registration (unique per airline), aircraftType (picker)
  - Optional: homeHub (Phase 3 picker), livery URL, simBrief overlay
  - Auto-generate `acquiredAt = now()`

### 2.3 Operational Depth

#### PIREP-completion-hook

Bei `approvePirep`:
- `aircraft.totalHours += pirep.flightTimeMin / 60`
- `aircraft.totalCycles += 1`
- `aircraft.currentLocationIcao = pirep.arrival.icao`
- Check maintenance thresholds → flag if due

#### Maintenance flagging

UI-side: rotes badge auf fleet-list und detail wenn `status==='active' &&
nextMaintenance.dueAtHours <= totalHours + 50` (50h warning-window).

#### Backfill

Migration-script: für alle existing Aircraft, compute totalHours from
historic PIREPs (sum of approved flightTimeMin / 60), set
currentLocationIcao = latest approved PIREP arrival.

### Phase 2 Dependencies

- Phase 1 (AircraftType existieren muss vor Aircraft.aircraftTypeId)
- Phase 3 deferred (homeHubId optional, FK-nullable)

### Risiken

- 8-12 Tage ist viel. Wenn nur CRUD ohne operational depth gewünscht:
  cut auf 5-7 Tage. Operational depth dann als Phase 2.5 separat.
- Aircraft-delete-cascade: Aircraft mit PIREPs blockiert delete. Soft-
  delete via `retiredAt` ist der primary path.

---

## Phase 3 — Hubs CRUD (2-4 Tage)

**Ziel**: Airline-admin kann mehrere Hubs definieren und assigned.

### Schema

```prisma
model Hub {
  id          String   @id @default(cuid())
  airlineId   String
  airline     Airline  @relation(fields: [airlineId], references: [id])
  airportId   String
  airport     Airport  @relation(fields: [airportId], references: [id])
  isPrimary   Boolean  @default(false)
  description String?
  createdAt   DateTime @default(now())

  aircraft    Aircraft[]
  basedUsers  User[]   @relation("UserBaseHub")

  @@unique([airlineId, airportId])
  @@index([airlineId, isPrimary])
}

// User extension
model User {
  // ADD:
  baseHubId String?
  baseHub   Hub?     @relation("UserBaseHub", fields: [baseHubId], references: [id])
}
```

### UI

- `/airline/hubs` — list page
  - Columns: ICAO | Name | Primary | Aircraft-count | Pilots-count
  - "Add Hub" → modal mit Airport-picker (autocomplete)
  - Per row: set-primary, remove
- `/airline/hubs/[icao]` — Hub dashboard:
  - Today's departures + arrivals (aus Bookings)
  - Aircraft based here
  - Pilots based here
  - Recent activity (PIREPs from/to)

### Backfill

Migration: für jede Airline mit existing aircraft, create hub aus dem
häufigsten `homeIcao` value als primary. Dann set aircraft.homeHubId
entsprechend.

### Dependencies

- Phase 1 (Airport exists)

---

## Phase 4 — Routes Management (4-6 Tage)

**Ziel**: Airline-admin verwaltet das Streckennetz vollständig.

### Was existiert
- Route schema mit flightNumber, departure, arrival, aircraft (optional),
  estimatedMinutes, distanceNm, active, simBriefOverlay
- `/routes` public list-page (read-only)
- KEINE admin CRUD

### Schema-Erweiterung

```prisma
// EXTEND Route — minor additions
model Route {
  // existing: id, airlineId, flightNumber, departureId, arrivalId, aircraftId,
  //           estimatedMinutes, distanceNm, active, simBriefOverlay
  // ADD:
  description    String?           // freitext über die route
  preferredAircraftTypeId String?   // type-rating gate (Phase 5)
  preferredAircraftType   AircraftType? @relation(fields: [preferredAircraftTypeId], references: [id])
  category       String?           // "scheduled" | "charter" | "ferry" | "training"
  createdById    String?
  createdBy      User?             @relation(fields: [createdById], references: [id])
  updatedAt      DateTime          @updatedAt
}
```

### UI

- `/airline/routes` (NEU als admin-CRUD) — list page:
  - Columns: FlightNumber | Departure | Arrival | Distance | Time | Aircraft | Active
  - Filters: dep-airport, arr-airport, aircraft-type, active
  - Sort: flightNumber, distance, recently-updated
  - "Add Route" button
- `/airline/routes/[id]` — detail page:
  - Header: flightNumber + dep→arr
  - Map-view (mapbox) showing the route line
  - Stats: distance, est-time, # times flown (from PIREPs)
  - Performance: avg actual flight time vs estimate, OTP
  - SimBrief overlay editor
  - Action: edit, deactivate, schedule (Phase 6)
- `/airline/routes/new` — create form:
  - FlightNumber: prefix from airline ICAO + manual number
  - Departure airport (autocomplete from Phase 1)
  - Arrival airport (autocomplete)
  - Auto-compute distance via great-circle from lat/lon
  - Manual estimatedMinutes (default = distance / 460kt cruise speed)
  - Optional: preferred aircraft type
  - Optional: category, description
  - SimBrief overlay (Json editor or wizard)
- `/airline/network` — map view of all airline routes:
  - Mapbox base, polylines per route
  - Color by category (scheduled = blue, charter = orange)
  - Hover tooltip shows flightNumber + airport names
  - Filter by hub, type, active

### Server actions

- `createRoute()` — validates uniqueness `{airlineId, flightNumber}`
- `updateRoute()` — admin-only, partial updates
- `deactivateRoute()` — sets active=false (soft, preferred over delete)
- `deleteRoute()` — hard-delete, only if no PIREPs/Bookings reference

### Dependencies

- Phase 1 (airports needed for picker)
- Phase 1 (aircraft-types for preferred-type picker)
- Phase 2 optional (if aircraft FK is used)

### Risiken

- Hard-delete blockiert oft (PIREPs reference). Default: deactivate.
- Mapbox quota: 50k loads/month free tier — ausreichend für single-airline.

---

## Phase 5 — Personnel Management (5-7 Tage)

**Ziel**: HR-management mit type-ratings, audit-log.

(Inhalt unverändert von Roadmap v1 Phase C — siehe original-doc-history für
details. Schema-summary:)

### Schema

```prisma
// EXTEND User
model User {
  // ADD:
  hireDate       DateTime  @default(now())
  status         String    @default("active")  // active | leave | inactive | terminated
  statusUntil    DateTime?
  leftAt         DateTime?
  employeeId     String?   @unique
  lastActiveAt   DateTime?
  rankAcquiredAt DateTime?
  ratings        AircraftTypeRating[]
  hrEvents       HrEvent[]
}

model AircraftTypeRating {
  id             String       @id @default(cuid())
  userId         String
  user           User         @relation(fields: [userId], references: [id])
  aircraftTypeId String
  aircraftType   AircraftType @relation(fields: [aircraftTypeId], references: [id])
  acquiredAt     DateTime     @default(now())
  acquiredById   String?
  notes          String?

  @@unique([userId, aircraftTypeId])
}

model HrEvent {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  type          String
  fromValue     String?
  toValue       String?
  reason        String?
  performedById String?
  createdAt     DateTime @default(now())
}
```

### UI

- `/airline/pilots` (NEU als admin-CRUD) mit sort/filter
- `/airline/pilots/[id]` — pilot detail mit type-ratings, HR-event timeline
- `/airline/hr` — admin-only HR dashboard
- Booking gate: type-rating check vor SimBrief-dispatch

### Dependencies

- Phase 1 (AircraftType für ratings)
- Phase 3 optional (hub-transfers)

---

## Phase 6 — Schedule Generator (5-7 Tage)

**Ziel**: Routes haben wiederkehrende Schedules, Bookings werden auto-generated.

### Schema

```prisma
model RouteSchedule {
  id              String   @id @default(cuid())
  routeId         String
  route           Route    @relation(fields: [routeId], references: [id])
  daysOfWeek      String   // "1,2,3,4,5"
  departureTimeUtc String  // "12:30"
  validFrom       DateTime @default(now())
  validUntil      DateTime?
  active          Boolean  @default(true)
  preferredAircraftTypeId String?
  preferredAircraftType   AircraftType? @relation(fields: [preferredAircraftTypeId], references: [id])
  createdAt       DateTime @default(now())
}

// NEW model (recommended over nullable Booking.userId)
model PublishedFlight {
  id              String        @id @default(cuid())
  routeId         String
  route           Route         @relation(fields: [routeId], references: [id])
  scheduledDeparture DateTime
  scheduledAircraftId String?
  scheduledAircraft   Aircraft? @relation(fields: [scheduledAircraftId], references: [id])
  generatedFromScheduleId String?
  generatedFromSchedule   RouteSchedule? @relation(fields: [generatedFromScheduleId], references: [id])
  bookingId       String?       @unique  // 1:1 — wenn ein pilot gebucht hat
  booking         Booking?      @relation(fields: [bookingId], references: [id])
  status          String        @default("published")  // published | booked | flown | cancelled
  createdAt       DateTime      @default(now())

  @@index([routeId, scheduledDeparture])
  @@unique([routeId, scheduledDeparture])  // prevent duplicates
}
```

### UI

- `/airline/routes/[id]/schedule` — schedule editor pro route
- `/airline/schedule` — wochen-view
- `/airline/schedule/calendar` — kalender-view per hub

### Cron

`apps/api/src/jobs/generate-schedule.ts`:
- Nightly 00:00 UTC
- Generate PublishedFlights für nächste 7 Tage aus aktiven RouteSchedules
- Idempotent via unique constraint

### Pilot booking flow

- `/bookings/new` zeigt jetzt published-flights als browse-and-book vs
  existing manual route-pick
- Bei booking: PublishedFlight.status='booked', PublishedFlight.bookingId=X

### Dependencies

- Phase 1 (aircraft types)
- Phase 4 (routes)
- Phase 5 (type-rating gate)

---

## Phase 7 — Branding & Public Identity (3-5 Tage)

**Ziel**: Jede airline hat eigenes Gesicht. Public page für recruiting.

### Schema

```prisma
model Airline {
  // ADD:
  founded             DateTime?
  description         String?    // markdown
  websiteUrl          String?
  brandColorPrimary   String?    // "#FFCC00"
  brandColorSecondary String?
  motto               String?
  publicPageEnabled   Boolean    @default(true)
}
```

### UI

- `/airline/branding` — admin editor (color pickers, logo, description)
- `/airlines/[icao]` — public page (no auth):
  - Hero with brand-colors, logo, motto
  - About (description)
  - Fleet showcase (aus Phase 2 data)
  - Hubs map (aus Phase 3 data)
  - Routes preview (aus Phase 4 data)
  - Top pilots leaderboard
  - "Apply to join" CTA → invite request

Brand-color application: ThemeProvider extension, override für members.

### Dependencies

- Phasen 1-4 für rich data on public page

---

## Phase 8 — Ops Communications (4-6 Tage)

**Ziel**: Day-to-day kommunikations-channel.

### Schema

```prisma
model Announcement {
  id          String   @id @default(cuid())
  airlineId   String
  authorId    String
  title       String
  body        String   // markdown
  pinned      Boolean  @default(false)
  publishedAt DateTime @default(now())
  expiresAt   DateTime?
}

model Document {
  id        String   @id @default(cuid())
  airlineId String
  category  String   // "SOP" | "Manual" | "Training"
  title     String
  body      String   // markdown
  version   String   @default("1.0")
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Bulletin {
  id          String   @id @default(cuid())
  airlineId   String
  type        String   // "NOTAM" | "SafetyAlert" | "ScheduleChange"
  severity    String   // "info" | "warning" | "critical"
  title       String
  body        String
  validFrom   DateTime @default(now())
  validUntil  DateTime?
  affectedAirports String[]
}

model AnnouncementRead {
  id             String       @id @default(cuid())
  userId         String
  announcementId String
  readAt         DateTime     @default(now())

  @@unique([userId, announcementId])
}
```

### UI

- `/airline/announcements` — list + create (admin)
- `/airline/docs` — categorized list + viewer
- `/airline/bulletins` — active bulletins, severity-color
- Dashboard widget: unread count

---

## Phase 9 — Analytics & Reporting (6-9 Tage)

**Ziel**: KPI-driven airline-leadership view.

### Computed metrics (no schema changes — alles aus existing data)

- **OTP**: % PIREPs where flightTimeMin within ±10% of route.estimatedMinutes
- **Completion rate**: bookings → approved PIREPs %
- **Fleet utilization**: % of fleet flying ≥1 last 7 days
- **Hub activity**: arr+dep per hub per day
- **Pilot productivity**: hours/active-pilot/month
- **Route popularity**: bookings/route/month

### UI

- `/airline` upgrade → KPI dashboard cards
- `/airline/reports` — generated reports (PDF export via @react-pdf/renderer)
- `/airline/leaderboard` — full pilot leaderboard

### Dependencies

- Phasen 1-6 für rich data

---

## Phase 10 — Award/Achievement Activation (3-5 Tage)

(Inhalt unverändert von v1.)

### Schema additions

```prisma
model Award {
  // existing: id, name, description, iconUrl, criteria, createdAt
  // ADD:
  category    String?
  rarity      String   @default("common")
  airlineId   String?  // null = system-wide
  active      Boolean  @default(true)
  triggerType String   // "first_flight" | "total_hours_X" | etc.
  triggerData Json?
}
```

### Trigger engine

`packages/db/awards.ts` mit `evaluateAwardsForUser(userId)` aus PIREP-approve,
type-rating-grant, rank-promote.

### UI

- `/airline/awards` — admin: create/edit
- `/dashboard` — badge gallery widget
- `/pilots/[id]` — public profile awards

---

## Phase 11 — Multi-Airline & Alliance (7-10 Tage)

(Inhalt unverändert von v1.)

### Schema

```prisma
model Alliance {
  id, name, iata, description, logoUrl, founded
  members AllianceMember[]
}

model AllianceMember {
  id, allianceId, airlineId, joinedAt, active
}

model AirlineTransferRequest {
  id, userId, fromAirlineId, toAirlineId, status, reason,
  createdAt, resolvedAt, resolvedById, hourCreditMode
}
```

### UI

- `/airlines` — public directory
- `/airlines/transfer` — pilot transfer flow
- `/airline/transfers` — admin: incoming requests
- Cross-airline leaderboards

---

## Empfohlene Reihenfolge

### Pfad A: CRUD-First (empfohlen, matched user-ask)

```
Woche 1:        Phase 1  (Airport + AircraftType catalogs)
Woche 2-4:      Phase 2  (Fleet + Aircraft — der biggest)
Woche 5:        Phase 3  (Hubs)
Woche 6-7:      Phase 4  (Routes)
              ─── Foundation CRUD complete (3-5 Wochen) ───
Woche 8-9:      Phase 7  (Branding + Public Page) ← sofort sichtbarer impact
Woche 10-11:    Phase 5  (Personnel)
Woche 12-13:    Phase 9  (Analytics)
Woche 14:       Phase 8  (Ops Comms)
Woche 15-16:    Phase 6  (Schedule Generator)
Woche 17:       Phase 10 (Awards)
Woche 18-19:    Phase 11 (Multi-airline)
```

Logik: Foundation-CRUD (1-4) als block, dann Branding (7) als motivation-
boost weil sofort zeigbar, Personnel (5) für tiefe, Analytics (9) sobald
data-rich, dann der Rest.

### Pfad B: Minimum Viable Airline Management (~3-5 Wochen)

```
Phase 1 → 2 → 3 → 4
```

Nur die Foundation-CRUD-phasen. Du hast danach: Airports + Aircraft + Fleet
+ Hubs + Routes voll managebar via UI. ~17-27 Tage = ~3-5 Wochen part-time.

### Pfad C: Quick wins für single-airline-demo (~2 Wochen)

```
Phase 1 (3-5d) → Phase 2 ohne operational depth (5-7d) → Phase 4 (4-6d)
                                                                = 12-18d
```

Skip Hubs (Phase 3), defer operational depth (Phase 2 trim), skip Personnel.
Du hast danach: airline-admin kann airports anlegen, aircraft hinzufügen,
routes definieren. Genug für demo + erste 2-3 pilots.

---

## Decision Points (vor Phase 1)

1. **Airport authority model**: airline-admin darf creates aber nicht edits
   von "shared" airports? Oder edit-mit-history? Empfehle:
   create-frei, edit-with-audit, delete-system-only.

2. **AircraftType authority**: airline-admin darf neu anlegen, oder
   request-flow mit system-admin approval? Empfehle: airline-admin direct,
   system-admin merged duplikate später.

3. **Soft-delete vs hard-delete**: Standard für Aircraft/Route ist
   soft-delete (active=false / retiredAt). Empfehle: alle non-shared
   resources soft-delete, system-admin kann hard-purgen.

4. **PublishedFlight (Phase 6)**: eigenes Model oder nullable Booking.userId?
   Empfehle: eigenes Model. Saubere state-machine separation.

5. **Backfill strategy**: scripts vs manual für bestehende DLH-data?
   Empfehle: scripts mit dry-run-flag, dann apply.

6. **Brand-color scope**: nur public-page oder full-app theme override?
   Empfehle: full-app mit dark/light contrast validation.

7. **HR audit retention**: lifetime oder rolling? Empfehle: lifetime.

8. **Schedule-generator timezone**: UTC storage, user-tz display.

---

## Was NICHT in dieser Roadmap ist

Themen die overlappen aber zu anderen visions gehören:

- **Economy/Finance Simulation** — eigenes vision-theme
- **ACARS Client** — pilot-side tool, nicht airline-management
- **IVAO Live Sync** — foundation existiert (LiveSession), Erweiterung
  ist pilot-facing
- **Tours & Events** — community-loop
- **Training & Exam System** — separate career-theme
- **Discord Bot** — integration-theme

Wenn du eines davon mit Airline Ops fusionieren willst, sag bescheid —
ich passe phasen an.

---

## Zusammenfassung

V2 Roadmap deckt **11 Phasen über 50-76 Tage** Coding-time, calibrated
**72-111 Tage** = **~14-22 Wochen** part-time.

Output bei Vollendung:
- **Volle CRUD-UI** für: Airports, AircraftTypes, Fleet, Aircraft, Hubs,
  Routes, Personnel, Schedules, Announcements/Docs/Bulletins, Awards,
  Alliances, Transfer-Requests
- **~16 neue Schema-models** (AircraftType, Maintenance, Hub,
  AircraftTypeRating, HrEvent, RouteSchedule, PublishedFlight,
  Announcement, Document, Bulletin, AnnouncementRead, Alliance,
  AllianceMember, AirlineTransferRequest, Airport-extensions, Award-extensions)
- **~20 neue Pages** (`/airline/airports`, `/airline/fleet`,
  `/airline/fleet/[reg]`, `/airline/aircraft-types`, `/airline/hubs`,
  `/airline/hubs/[icao]`, `/airline/routes`, `/airline/routes/[id]`,
  `/airline/network`, `/airline/pilots`, `/airline/pilots/[id]`,
  `/airline/hr`, `/airline/schedule`, `/airline/branding`,
  `/airlines/[icao]`, `/airline/announcements`, `/airline/docs`,
  `/airline/bulletins`, `/airline/awards`, `/airline/transfers`)
- **~50 neue server actions**
- **1 cron job**
- **~15 system-wide awards**

Foundation-CRUD-block (Phasen 1-4) ist **17-27 Tage = ~3-5 Wochen part-time**
und matched den expliziten user-ask.

Update-cadence: jede Phase ist single-PR-shippable. Continuous-delivery
gegen die haupt-airline (Lufthansa Virtual). Jederzeit pausen, re-prio,
oder phasen splitten — alle Dependencies dokumentiert.
