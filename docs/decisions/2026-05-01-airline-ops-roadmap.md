# Airline Ops — Complete Roadmap (v3)

Stand: 2026-05-01. Roadmap für das Theme **"Airline rundum verwalten und
anzeigen"**, restructured um den expliziten user-ask:

> "Routen welche die airline anbieten soll erstellen, bearbeiten, löschen
> kann, das gleiche dann für fleet, aircraft, hubs, airports."

**v3 vs v2**: Shared resources (Airport + AircraftType) sind jetzt
**system-admin curated mit PIREP-style request-flow**. Airline-admin
proposed neue entries, VAM-system-admin approved per 1-click (mit
"verified" / "unverified" tier). Mirror eines bewährten patterns — gleicher
mental-model wie PIREP submit/approve, gleiche UI-components reusable.

**v2 vs v1**: Resource-CRUD-first statt feature-first. Die ersten 4 Phasen
geben dem airline-admin volle Kontrolle über die foundational data —
Airports, Aircraft-Types, Aircraft, Fleet, Hubs, Routes.

11 Phasen, **52-78 Tage Coding**, calibrated **75-113 Tage** real-time =
**~15-23 Wochen** part-time.

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

### Shared-Resource-Handling (system-curated mit request-flow)

Shared resources (Airport + AircraftType) sind **VAM-system-admin curated**.
Airline-admin kann nicht direkt creates/editen — stattdessen submitted er
einen **request** (mirror eines bewährten patterns: PIREP submit/approve).
Das löst den potentiellen "DLH-admin verändert EDDF.lat und bricht BAW-
routes"-conflict komplett: nur system-admin schreibt jemals in den catalog.

**Pre-seeded baseline**:
- Airport-catalog wird mit ~10k airports aus **OurAirports.com** (public
  domain CSV) geseeded — alle als `verified=true`
- AircraftType-catalog wird mit ~150 ICAO-standard-typen aus **ICAO-doc-8643**
  geseeded — alle als `verified=true`
- Airline-admin findet 99% der needed entries sofort in browse-UI

**Request-flow** (neue entries):
- Airline-admin sieht "Vorschlag einreichen"-button auf catalog-page
- Submit-form fragt alle airport-felder (ICAO, IATA, name, city, country,
  lat, lon, elevation) ODER alle aircraft-type-felder (icaoType, name,
  manufacturer, category, rangeNm, capacityPax, etc.) plus optional reason
- Status-pipeline: `Submitted → UnderReview → Approved / Rejected`
- Airline-admin sieht status pro request in `/airline/requests` — gleiches
  pattern wie `/pireps` für seine eigenen einreichungen
- VAM-system-admin sieht sidebar-badge "X Anträge zur Prüfung" (mirror
  PIREP "PIREPs zur Prüfung"), öffnet `/admin/requests`, reviewed in 1-click

**Approve-tier (verified vs unverified)**:
- **Approve as verified** — system-admin hat die daten geprüft (z.B. lat/lon
  gegen externe quelle abgeglichen). Airport/Type wird mit `verified=true`
  erstellt. Standard-fall für well-known entries.
- **Approve as unverified** — system-admin hat keine zeit für deep-check
  aber daten erscheinen plausibel. Airport/Type wird mit `verified=false`
  erstellt + im catalog mit "⚠ Unverified"-badge markiert. Andere airlines
  können nutzen aber wissen es ist user-contributed. System-admin kann
  später async upgraden.
- **Edit & approve** — system-admin korrigiert ein feld (z.B. tippfehler
  in name) und approved dann als verified.
- **Reject** — mit reason. Airline-admin sieht reason in `/airline/requests`,
  kann re-submit mit korrigierten daten.

**Risk eliminiert**: DLH-admin kann **nicht** EDDF.lat verändern. Alles was
er kann ist einen edit-request submitten — system-admin entscheidet. Damit
ist BAW-routes-breaking durch DLH-edit unmöglich.

**Edge-cases**:
- **Duplicate-detection bei submit**: Form prüft bei ICAO-eingabe ob bereits
  im catalog ODER als pending request → zeigt "Existiert bereits" mit link,
  oder "Antrag steht aus von [User]" mit join-link
- **Rate-limiting**: max 10 offene requests pro airline-admin (verhindert
  spam, großzügig genug für legitime needs)
- **Approved-then-edit**: nach approval kann system-admin Airport-entity
  direkt editieren (separater flow). Request bleibt approved als history.
- **Re-submit nach reject**: airline-admin sieht reject-reason, kann neue
  request stellen. Original-request bleibt in history.
- **Unverified-warnings**: in route-creation form zeigt picker "⚠ Unverified"-
  badge. Beim final create gibt's eine info-toast "Diese route nutzt einen
  unverified airport — bitte daten ggf. melden".

**Hard-delete von Airport/AircraftType**: nur system-admin via `/admin/...`-
seite und nur wenn keine FK-references existieren. Soft-delete via
`active=false`-flag für entries die obsolete sind (z.B. closed airports).

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
| 1 | Browse system-curated catalog (10k airports, 150 aircraft-types). Vorschläge für neue entries einreichen — system-admin approved als verified/unverified |
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
| **1** | Airport & Aircraft-Type Catalogs | 5-7 | 7-10 | Foundation: system-curated mit request-flow |
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
| | **Total** | **52-78** | **75-113** | |

Phasen 1-4 (Foundation CRUD) = **19-29 Tage** = ~4-6 Wochen part-time. Wenn
du nur das willst, ist das ein klar abgegrenzter scope.

---

## Phase 1 — Airport & Aircraft-Type Catalogs (5-7 Tage)

**Ziel**: Die zwei "shared resource" catalogs auf die alles andere
referenced. **System-curated mit PIREP-style request-flow** — airline-admin
browse + propose, VAM-system-admin approve. Foundation phase.

### 1.1 Airport-Catalog (system-curated)

#### Was existiert
- `Airport` schema mit icao, iata, name, city, country, lat/lon, elevation
- Keine UI zum browsen, keine seed-data, keine request-mechanik

#### Strategie: comprehensive seed + request-flow

**Seeding** aus OurAirports.com (public domain CSV):
- `airports.csv` enthält ~80k airport-records weltweit
- Filter auf `type IN ('large_airport', 'medium_airport', 'heliport')`
  reduziert auf ~10k useful entries
- Mapping: ident→icao, iata_code→iata, name, municipality→city, iso_country
  →country, latitude_deg→latitude, longitude_deg→longitude, elevation_ft→elevation
- Alle pre-seeded entries werden als `verified=true` markiert
- Skript `packages/db/seeds/airports.ts` lädt CSV via stream, batch-insert
  in chunks of 500
- Idempotent via `upsert` auf `icao`

**Request-flow** für nicht-pre-seeded airports:
- Airline-admin findet airport nicht in browse → klickt "Vorschlag einreichen"
- Form fragt alle airport-felder + optional reason
- Status: Submitted → UnderReview → Approved (verified|unverified) | Rejected
- Bei approve: Airport-entity wird erstellt + AirportRequest.createdAirportId
  gesetzt + Airport.verified je nach approval-tier

#### Schema-Erweiterung

```prisma
model Airport {
  // existing: id, icao, iata, name, city, country, latitude, longitude, elevation
  // ADD:
  active        Boolean   @default(true)
  verified      Boolean   @default(false)         // pre-seeded entries: true
  verifiedAt    DateTime?
  verifiedById  String?
  verifiedBy    User?     @relation("AirportVerifier", fields: [verifiedById], references: [id])
  // Provenance — wer hat den airport ursprünglich vorgeschlagen
  proposedById  String?
  proposedBy    User?     @relation("AirportProposer", fields: [proposedById], references: [id])
  proposedFromRequestId String? @unique
  proposedFromRequest   AirportRequest? @relation(fields: [proposedFromRequestId], references: [id])
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

### 1.2 AircraftType-Catalog (system-curated)

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
  verified      Boolean    @default(false)
  verifiedAt    DateTime?
  verifiedById  String?
  verifiedBy    User?      @relation("AircraftTypeVerifier", fields: [verifiedById], references: [id])
  proposedById  String?
  proposedBy    User?      @relation("AircraftTypeProposer", fields: [proposedById], references: [id])
  proposedFromRequestId String? @unique
  proposedFromRequest   AircraftTypeRequest? @relation(fields: [proposedFromRequestId], references: [id])
  createdAt     DateTime   @default(now())

  aircraft      Aircraft[]
  fleets        Fleet[]
  ratings       AircraftTypeRating[]   // Phase 5
  schedules     RouteSchedule[]        // Phase 6
}
```

#### Seeding aus ICAO-doc-8643

ICAO Doc 8643 ist die offizielle aircraft-type-designators-liste, ~150
common types. Public reference, kann manuell als JSON kuratiert werden.

`packages/db/seeds/aircraft-types.ts` enthält die ~150 entries als
TypeScript-array, alle mit `verified=true`. Beispiel-entries:

```ts
{
  icaoType: "B738", name: "Boeing 737-800", manufacturer: "Boeing",
  category: "narrow_body", rangeNm: 3060, capacityPax: 189,
  cruiseSpeedKt: 460, fuelBurnKgH: 2500,
}
```

### 1.3 Request-Flow Schema

Mirror der PIREP-state-machine.

```prisma
enum RequestStatus {
  Submitted       // airline-admin hat eingereicht
  UnderReview     // system-admin hat sich zugewiesen
  Approved        // angenommen (verified oder unverified)
  Rejected        // abgelehnt mit reason
}

model AirportRequest {
  id                 String        @id @default(cuid())
  // Proposed data — alle Airport-felder die der user ausgefüllt hat
  icao               String
  iata               String?
  name               String
  city               String?
  country            String
  latitude           Float
  longitude          Float
  elevation          Int?
  // Request-meta
  status             RequestStatus @default(Submitted)
  reason             String?       // freitext: warum wird dieser airport gebraucht
  // Submitter (mirrors Pirep.user)
  requestedById      String
  requestedBy        User          @relation("AirportRequester", fields: [requestedById], references: [id])
  requestedAirlineId String?       // null wenn user nicht in airline
  requestedAirline   Airline?      @relation("AirportRequestAirline", fields: [requestedAirlineId], references: [id])
  submittedAt        DateTime      @default(now())
  // Reviewer (mirrors Pirep.approver)
  reviewedById       String?
  reviewer           User?         @relation("AirportReviewer", fields: [reviewedById], references: [id])
  reviewedAt         DateTime?
  rejectionReason    String?
  reviewerNotes      String?       // optional internal notes
  approvedAsVerified Boolean?      // bei Approve: war es verified-tier oder unverified-tier?
  // After approval — link zur erstellten Airport-entity
  createdAirport     Airport?      // back-relation via Airport.proposedFromRequestId

  @@index([status, submittedAt])           // für admin-queue sorted by oldest first
  @@index([requestedById, submittedAt])    // für "meine requests" page
  @@index([icao])                           // für duplicate-detection bei submit
}

model AircraftTypeRequest {
  id                 String        @id @default(cuid())
  // Proposed data
  icaoType           String
  name               String
  manufacturer       String
  category           String
  rangeNm            Int
  capacityPax        Int
  cruiseSpeedKt      Int
  fuelBurnKgH        Int
  imageUrl           String?
  // Request-meta (analog zu AirportRequest)
  status             RequestStatus @default(Submitted)
  reason             String?
  requestedById      String
  requestedBy        User          @relation("AircraftTypeRequester", fields: [requestedById], references: [id])
  requestedAirlineId String?
  requestedAirline   Airline?      @relation("AircraftTypeRequestAirline", fields: [requestedAirlineId], references: [id])
  submittedAt        DateTime      @default(now())
  reviewedById       String?
  reviewer           User?         @relation("AircraftTypeReviewer", fields: [reviewedById], references: [id])
  reviewedAt         DateTime?
  rejectionReason    String?
  reviewerNotes      String?
  approvedAsVerified Boolean?
  createdAircraftType AircraftType? // back-relation

  @@index([status, submittedAt])
  @@index([requestedById, submittedAt])
  @@index([icaoType])
}
```

### 1.4 UI Pages

#### Airline-admin side

- `/airline/airports` — browse system-curated catalog
  - Search-bar (autocomplete by icao/iata/name/city)
  - Filter: country, verified/unverified, active
  - Table: ICAO | IATA | Name | City | Country | Verified-badge
  - "⚠ Unverified" badge auf nicht-verified entries
  - "Vorschlag einreichen"-button oben rechts
- `/airline/airports/request` — submit-form
  - Felder: ICAO (required, validated unique gegen catalog + pending requests),
    IATA, Name, City, Country (dropdown), Lat, Lon, Elevation, Reason
  - Submit → AirportRequest mit status='Submitted'
  - Bestätigung: "Antrag eingereicht. Status verfolgen unter `/airline/requests`"
- `/airline/aircraft-types` — analog: browse + "Vorschlag einreichen"
- `/airline/aircraft-types/request` — submit-form analog
- `/airline/requests` — meine eingereichten requests
  - Tabs: "Alle" | "Submitted" | "UnderReview" | "Approved" | "Rejected"
  - Per row: type-badge (Airport / AircraftType), proposed-name, status-pill,
    submittedAt, reviewedAt
  - Click → request-detail
- `/airline/requests/[id]` — meine request-detail
  - Header: status-pill + reason
  - Submitted-data anzeigen (read-only)
  - Bei Rejected: rejectionReason + "Neuen request mit korrigierten daten
    stellen"-button
  - Bei Approved: link zur erstellten Airport/AircraftType-entity

#### VAM-system-admin side

- Sidebar-badge "X Anträge zur Prüfung" — count aller `Submitted` requests
  (mirror "PIREPs zur Prüfung" pattern)
- `/admin/requests` — review-queue
  - Filter: type (Airport | AircraftType), status, requesting-airline
  - Sort: oldest-first als default
  - Table: type-badge | proposed-name (icao/icaoType) | requester | airline |
    submittedAt | status
  - Click row → review-page
- `/admin/requests/[id]` — review-page
  - Header: request-type + status
  - Submitted-data anzeigen (editable form fields — system-admin kann
    korrekturen vor approval machen)
  - Duplicate-check: zeigt warning "ICAO existiert bereits in catalog" mit
    link, oder "Anderer pending request für gleiche ICAO" mit link
  - Action-panel:
    - **Approve as verified** — primary action, daten gelten als geprüft
    - **Approve as unverified** — secondary action, daten go-live mit warning-badge
    - **Reject** — modal mit reason-text-area
  - Bei Approve: Airport/AircraftType-entity wird erstellt mit
    `verified=approvedAsVerified`, `proposedById=request.requestedById`,
    `verifiedById=approver` (nur wenn verified=true), Request-status →
    Approved + approvedAsVerified gesetzt + reviewerId gesetzt
  - Bei Reject: Request-status → Rejected + rejectionReason gesetzt
- `/admin/airports` — system-admin direct CRUD auf Airport-entity
  - Für nachträgliche edits + verify-toggle (unverified → verified upgrade)
- `/admin/aircraft-types` — analog für AircraftType

### 1.5 Server Actions

```ts
// Airline-admin actions
async function submitAirportRequest(input: AirportRequestInput) {
  // Validate ICAO format
  // Check duplicate: existing airport OR pending request with same ICAO
  // Check rate-limit: max 10 open requests per user
  // Create AirportRequest with status=Submitted, requestedById=session.user.id
  // Notify system-admin (sidebar-badge auto-updates via revalidatePath)
}

async function submitAircraftTypeRequest(input: AircraftTypeRequestInput) {
  // analog
}

// System-admin actions
async function approveAirportRequest(requestId: string, asVerified: boolean, edits?: AirportEdits) {
  // requireSystemAdmin()
  // Apply edits to request fields (if any)
  // Create Airport with verified=asVerified, proposedById=request.requestedById,
  //   verifiedById=session.user.id (nur wenn asVerified=true), proposedFromRequestId=requestId
  // Update request: status=Approved, approvedAsVerified=asVerified,
  //   reviewedById=session.user.id, reviewedAt=now()
  // revalidatePath für catalog + admin-queue + airline-requests
}

async function rejectAirportRequest(requestId: string, rejectionReason: string) {
  // requireSystemAdmin()
  // Update request: status=Rejected, rejectionReason, reviewedById, reviewedAt
}

async function verifyAirport(airportId: string) {
  // requireSystemAdmin()
  // Upgrade unverified → verified, set verifiedAt + verifiedById
}

// analog für AircraftType
```

### 1.6 Migration aus existing data

- **Existing Airport-records**: bereits 1 oder 2 entries (für DLH route).
  Migration setzt `verified=true` (assume manuell kuratiert), `proposedById=null`
- **Existing Aircraft.type strings**: backfill-script matched gegen die
  ICAO-doc-8643-seed. Wenn match → set Aircraft.aircraftTypeId. Wenn kein
  match (z.B. "Boeing 737" statt "B738") → log + manual fixup
- **Existing Fleet.type**: gleicher backfill
- Keep `Aircraft.type` und `Fleet.type` String columns für 1 release als
  fallback, dann remove

### 1.7 Edge-Cases & Sonderfälle

- **Duplicate-detection**: bei `/airline/airports/request` form-submit wird
  validated:
  1. Existiert Airport mit dieser ICAO bereits? → "Airport existiert
     bereits" + link `/airline/airports#EDDF`, kein submit
  2. Pending AirportRequest mit dieser ICAO? → "Antrag steht bereits aus
     von [User] seit [date]" + link `/airline/requests/[id]`, kein submit
- **Rate-limiting**: server-action checked `count(AirportRequest WHERE
  requestedById=user.id AND status IN [Submitted, UnderReview]) < 10`
- **Re-submit nach reject**: airline-admin sieht reject-reason, klickt
  "Neuen request stellen", form pre-filled mit submitted-data, user kann
  korrigieren + resubmit. Original-request bleibt in history.
- **Request-batching**: system-admin kann queue filtern auf "all EDDX-related"
  → wenn duplicate-requests existieren, manually mergen (approve einen,
  reject die anderen mit reason "duplicate, see [link]")
- **Notification-fatigue**: nur sidebar-badge im UI, keine emails per
  request. Optional digest "3 neue requests" einmal pro tag (Phase 1.5).
- **Unverified-handling in routes**: in `/airline/routes/new` form picker
  zeigt verified-badge. Beim final create gibt's eine info-toast falls
  unverified airport gewählt: "Diese route nutzt einen unverified airport
  — bitte daten ggf. melden via Vorschlag-form".

### Risiken

- **OurAirports.com CSV download**: ~80k records, ~10MB. Stream-parsing
  nötig damit memory-pressure nicht explodiert. `csv-parse/sync` reicht
  für den seed-script (one-time) aber kann bei production-deploys
  langsam sein.
- **AircraftType backfill kann fail** wenn existing strings nicht ICAO
  sind. Manual fixup-pass nötig — aber existing DB hat nur 1-2 aircraft,
  also trivial.
- **Naming-collisions in custom AircraftTypes**: airline-admin fragt
  "B738MAX9" obwohl ICAO standardisiert "B38M" für 737 MAX 9. System-admin
  muss aufpassen + edits-vor-approve nutzen.
- **OurAirports.com data-quality**: lat/lon stimmen nicht immer für kleine
  airfields. Mitigation: Filter auf large+medium reduces das problem.

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

1. ~~**Airport authority model**~~ — **RESOLVED in v3**: System-curated catalog
   mit OurAirports.com seed (~10k entries, alle verified=true). Airline-admin
   submitted neue entries via PIREP-style request-flow. System-admin approved
   als "verified" (geprüft) oder "unverified" (provisional, mit warning-badge).
   Niemand außer system-admin schreibt jemals direkt in den Airport-catalog.

2. ~~**AircraftType authority**~~ — **RESOLVED in v3**: Same approach — ICAO-doc-
   8643 seed (~150 types, alle verified=true) + request-flow + verified-tier.
   Custom variants gehen durch system-admin review.

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

9. **Request-rate-limit threshold**: max 10 open requests pro airline-admin
   in v3. Empfehle: start mit 10, monitor, anpassen falls nötig.

10. **Unverified-airport-warnings stärke**: nur info-toast (v3 default), oder
    explicit confirm-dialog "Confirm unverified airport"? Empfehle: info-toast
    initially, upgrade falls user-feedback zeigt dass leute sie übersehen.

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

V3 Roadmap deckt **11 Phasen über 52-78 Tage** Coding-time, calibrated
**75-113 Tage** = **~15-23 Wochen** part-time.

Output bei Vollendung:
- **Volle CRUD-UI** für: Fleet, Aircraft, Hubs, Routes, Personnel, Schedules,
  Announcements/Docs/Bulletins, Awards, Alliances, Transfer-Requests
- **System-curated catalogs** mit request-flow für: Airports (~10k seeded),
  AircraftTypes (~150 seeded). Airline-admin browse + propose,
  system-admin approve.
- **~18 neue Schema-models** (AircraftType, AirportRequest, AircraftTypeRequest,
  RequestStatus enum, Airport-verified-extension, AircraftType-verified-extension,
  Maintenance, Hub, AircraftTypeRating, HrEvent, RouteSchedule, PublishedFlight,
  Announcement, Document, Bulletin, AnnouncementRead, Alliance,
  AllianceMember, AirlineTransferRequest, Award-extensions)
- **~28 neue Pages**:
  - **Phase 1 (request-flow)**: `/admin/requests`, `/admin/requests/[id]`,
    `/admin/airports`, `/admin/aircraft-types`, `/airline/airports`,
    `/airline/airports/request`, `/airline/aircraft-types`,
    `/airline/aircraft-types/request`, `/airline/requests`,
    `/airline/requests/[id]`
  - **Phase 2-11**: `/airline/fleet`, `/airline/fleet/[reg]`,
    `/airline/fleet/types`, `/airline/hubs`, `/airline/hubs/[icao]`,
    `/airline/routes`, `/airline/routes/[id]`, `/airline/network`,
    `/airline/pilots`, `/airline/pilots/[id]`, `/airline/hr`,
    `/airline/schedule`, `/airline/branding`, `/airlines/[icao]`,
    `/airline/announcements`, `/airline/docs`, `/airline/bulletins`,
    `/airline/awards`, `/airline/transfers`
- **~55 neue server actions** (inkl. submit/approve/reject für request-flow)
- **1 cron job** (schedule-generator Phase 6)
- **2 seed scripts** (OurAirports.com → Airport, ICAO-doc-8643 → AircraftType)
- **~15 system-wide awards**

Foundation-CRUD-block (Phasen 1-4) ist **19-29 Tage = ~4-6 Wochen part-time**
und matched den expliziten user-ask + system-curated-approach.

**Phase 1 (system-curated catalogs + request-flow) deliverables**:
- Airline-admin: browse 10k airports + 150 aircraft-types, einreichen-flow für edge cases
- System-admin: 1-click approval queue mit verified/unverified tier, sidebar-badge
- Multi-tenancy: shared catalogs sind read-only für airlines, write nur durch system-admin
- Provenance: jeder vom-airline-vorgeschlagene entry hat audit-trail (proposedBy + verifiedBy)

Update-cadence: jede Phase ist single-PR-shippable. Continuous-delivery
gegen die haupt-airline (Lufthansa Virtual). Jederzeit pausen, re-prio,
oder phasen splitten — alle Dependencies dokumentiert.
