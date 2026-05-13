# ACARS-Architektur für VAM-System

> System-Design für den eigenen ACARS-Client und seine Integration ins VAM-System.
> Klammer um den SimConnect-Datenkatalog (was wir lesen) und die Pirep-Analyse-Page
> (was wir damit anzeigen). Beschreibt das **Wie** zwischen Sim und Web.

**Stand:** April 2026 (initiale architektur-vision) · **Aktualisiert:** 13. Mai 2026 mit status-realität
**Voraussetzungen:**
- [`simconnect-data-catalog.md`](./simconnect-data-catalog.md) — Welche Daten verfügbar sind
- [`pirep-analysis-page.md`](./pirep-analysis-page.md) — Was am Ende angezeigt wird
- [`todo-obs-overlay-system.md`](./todo-obs-overlay-system.md) — Phase 8 dieser Roadmap

---

## 🔵 STATUS-UPDATE (13. Mai 2026) — Was tatsächlich gebaut wurde

> Dieses dokument ist die **architektur-vision** von April 2026. Die echte implementation hat seitdem stattgefunden und in **manchen punkten andere wege genommen** als hier ursprünglich skizziert. Dieser status-block fasst die wichtigsten abweichungen zusammen — der rest des dokuments ist für context erhalten.

### Tech-Stack-Realität (vs. Section 13 weiter unten)

**Hier in Section 13 steht:** Electron + React + TypeScript + node-simconnect
**Realität:** WPF + .NET 10 + Microsoft SimConnect.dll (managed wrapper)
**Repo:** [github.com/CrysaGaming/vam-acars-client](https://github.com/CrysaGaming/vam-acars-client), branch `master`

Warum der wechsel: node-simconnect ist community-maintained mit single-point-of-failure bei MSFS-updates. Microsoft SimConnect-managed-wrapper ist offiziell und survives sim-updates direkter. Plus: .NET self-contained binary ist 50% kleiner als electron-äquivalent (~70 MB vs ~140 MB).

### Implementations-Phasen-Status

| Phase aus Section 8 (Migrations-Plan) | Plan | Realität |
|---|---|---|
| Phase 0 (DB-Vorbereitung) | ~30 min | ✅ DONE — NetworkType, DataSource, preferredNetwork alle migriert |
| Phase 1 (ACARS-Backend ~3 tage) | 6 endpoints | ✅ DONE — pairing/redeem, heartbeat, event, disconnect, status alle live unter `apps/web/app/api/acars/` |
| Phase 2 (ACARS-Client ~5-7 tage) | Electron-stack | ✅ DONE — als WPF/.NET (M1-M4 in github-repo, ~90 commits) |
| Phase 3 (Auto-PIREP ~2-3 tage) | Block-On detection + auto-generation | ✅ DONE — `apps/web/lib/acars/auto-pirep.ts` + `generate-pirep.ts` mit Draft-flow (option #19) |
| Phase 4 (Pirep-Detail-Page) | MVP-page | ⏳ Partial — basic page existiert, premium features (3D-globe, weather-compare, ATC-sessions) noch offen |

### Erweiterungen aus Section 11 — Status

| Erweiterung | Section 11 hier | Realität |
|---|---|---|
| Wettervergleich (Sim vs Real METAR) | Vorgeschlagen, ~2-3 tage | ❌ Noch offen — siehe [`acars-client-roadmap.md`](./vision/acars-client-roadmap.md) Welle B1 |
| ATC-Integration (COM-Freq matching) | Vorgeschlagen, ~3-4 tage | ❌ Noch offen — Welle B2 |
| Heatmap aller pilots | Vorgeschlagen, ~2-3 tage | ❌ Noch offen — Welle E5 |

### Open Questions aus Section 14 — Status

| Frage | Resolved? |
|---|---|
| Token-storage: OS-Keychain vs File | ✅ DPAPI (windows-native, ähnlich keychain) |
| PIREP-Auto-Submit vs User-Review | ✅ User-Review (Draft seit option #19) |
| Multi-Device-Support | ❌ noch offen — Welle D2 |
| Code-Signing-Cert | ❌ noch offen — Welle D4 |
| Demo-Mode ohne pairing | ❌ noch offen — Welle D5 |
| White-Label per VA | ❌ noch offen — Welle D3 |
| Aircraft-Substitution-Reject vs Warning | ❌ noch offen — Welle B4 (warning-with-flag empfohlen) |
| Crashed-Sim-Resume-Window | ✅ done (option #13 crash-recovery mit session-marker) |

### Single source of truth für post-MVP

→ **Für was als nächstes gemacht wird, siehe: [`docs/vision/acars-client-roadmap.md`](./vision/acars-client-roadmap.md)**

Diese architektur-doc (acars-architecture.md) bleibt erhalten als **system-design-reference** — die kapitel 3 (Schema), 4 (Datenfluss), 5 (API-Endpoints), 6 (Auth-Flow), 9 (Edge-Cases), 10 (Performance) sind weiter gültig und beschreiben das implementierte system korrekt. Nur Section 13 (Tech-Stack) ist superseded durch die WPF-realität.

---

## 1. Begriffsklärung

Drei Konzepte die heute oft vermischt werden, aber **strikt getrennt** werden müssen:

### Network — Wo der Pilot offiziell connected ist

```
NetworkType:
  VATSIM     → Pilot ist auf VATSIM eingelogged via vPilot/xPilot/etc.
  IVAO       → Pilot ist auf IVAO eingelogged via Altitude/IvAp
  Offline    → Pilot fliegt Solo (Single-Player)
```

**Wer setzt das?** Der User in seinen Settings (Account-Verknüpfungen sagen WAS connected ist, beim Flugstart wählt User WO er fliegt).

**Wo wird das genutzt?**
- Anzeige im OBS-Overlay
- Anzeige in der Live-Map ("VATSIM" / "IVAO" Badge)
- Anzeige in der Pirep-Page
- Anti-Cheat-Check: war Pilot wirklich online auf dem gewählten Network?

### DataSource — Woher die Telemetrie kommt

```
DataSource:
  VATSIM_DATAFEED   → Bot pollt VATSIM Public-API alle 30s
  IVAO_WHAZZUP      → Bot pollt IVAO Public-API alle 30s
  ACARS_CLIENT      → Eigene Desktop-App via SimConnect/XPLM (1-2s)
  MANUAL            → Pilot trägt Daten manuell ein (für Notfälle)
```

**Wer setzt das?** Das System automatisch — je nachdem welche Quelle gerade Daten schickt.

**Wo wird das genutzt?**
- Server-interne Logik (welche Felder gibt's, wie aktuell sind sie)
- Quality-Tier (ACARS_CLIENT > VATSIM_DATAFEED in Genauigkeit)
- Admin-Debugging
- Anti-Cheat: gleiche Position aus 2 Sources gleichzeitig?

### ACARS — Eigene Desktop-App

```
ACARS-Client:
  Ist die Software (.exe) die der Pilot auf seinem PC installiert.
  Liest SimConnect (MSFS/P3D) oder XPLM (X-Plane).
  Schickt Heartbeats zum VAM-Server.
  Generiert Auto-PIREPs bei Block-On.
  
  Tech-Stack-Wahl: Electron + TypeScript + node-simconnect
  (siehe Diskussion in OBS-Overlay-Roadmap Phase 8)
```

**Wichtig:** Ein Pilot kann gleichzeitig auf VATSIM (Network) sein UND ACARS (DataSource) nutzen. Beides ist parallel.

---

## 2. User-Stories

### Story 1: VATSIM-Pilot ohne ACARS (heute, bleibt erhalten)

```
1. Pilot startet Sim
2. Pilot connected sich zu VATSIM via vPilot
3. Pilot fliegt
4. Bot-Tracker erkennt Pilot via vatsimCid
5. LiveSession wird gefüllt (network=VATSIM, dataSource=VATSIM_DATAFEED)
6. Pilot beendet Flug
7. Pilot füllt manuell PIREP aus auf der Web-Page

→ Funktioniert wie heute, kein Change.
```

### Story 2: IVAO-Pilot ohne ACARS (heute, bleibt erhalten)

```
Identisch zu Story 1, nur IVAO statt VATSIM.
```

### Story 3: Pilot mit ACARS, nur Single-Player (zukünftig)

```
1. Pilot startet Sim (kein VATSIM/IVAO)
2. Pilot startet ACARS-App
3. ACARS pairt sich initial mit User-Account (1× Pairing-Code)
4. ACARS detected: Sim läuft, Aircraft geladen
5. Pilot wählt in ACARS-App: Network = Offline
6. ACARS schickt Heartbeats an Server
7. LiveSession (network=Offline, dataSource=ACARS_CLIENT)
8. Pilot fliegt — sieht eigene Position auf VAM-Map
9. Beim Block-On generiert ACARS Auto-PIREP
10. Pilot reviewt PIREP auf Web-Page → submitted

→ Volle Pirep-Analyse-Page mit allen Telemetrie-Daten.
```

### Story 4: Pilot mit ACARS UND VATSIM (zukünftig, Premium)

```
1. Pilot startet Sim
2. Pilot connected zu VATSIM via vPilot
3. Pilot startet ACARS-App
4. Pilot wählt in ACARS-App: Network = VATSIM
5. ACARS schickt Heartbeats (1-2s) an Server
6. Bot-Tracker pollt VATSIM (30s) — sieht denselben Pilot
7. SERVER LOGIC:
   → Wenn ACARS-Daten verfügbar: nutze ACARS (höhere Quality)
   → VATSIM-Daten als Backup falls ACARS-Verbindung abreißt
8. LiveSession (network=VATSIM, dataSource=ACARS_CLIENT)
9. Beim Block-On: Auto-PIREP mit voller Telemetrie
10. Pirep-Page zeigt: "VATSIM-Flight, getrackt mit ACARS"

→ Beste Daten + Network-Anwesenheit nachweisbar
```

### Story 5: Streamer-Setup (das ist warum wir das alles machen)

```
1. Pilot ist Streamer auf Twitch
2. ACARS ist installiert + connected
3. OBS hat https://vam.kevindrack.de/overlay/[token] als Browser-Source
4. Pilot fliegt auf VATSIM
5. ACARS schickt Heartbeats
6. Server updated LiveSession
7. Overlay-Page polled alle 5s (oder SSE), zeigt Live-Daten
8. Stream zeigt: Callsign, Route, FL, Speed, ETA — Live, ohne Refresh

→ Differenzierter Stream-Look, niemand sonst hat das
```

---

## 3. Schema-Vorschlag

### Aktuelle LiveSession (heute)

```prisma
model LiveSession {
  id                  String        @id @default(cuid())
  userId              String?
  user                User?         @relation(...)
  
  network             NetworkType   // VATSIM, IVAO, Offline
  externalId          Int?          // vatsimCid oder ivaoVid
  callsign            String
  
  aircraftType        String?
  aircraftRegistration String?
  
  departureIcao       String?
  arrivalIcao         String?
  alternateIcao       String?
  cruiseAltitude      Int?
  flightRules         String?
  
  latitude            Float
  longitude           Float
  altitude            Int
  groundSpeed         Int
  heading             Int
  onGround            Boolean       @default(false)
  
  isActive            Boolean       @default(true)
  connectedAt         DateTime      @default(now())
  lastUpdatedAt       DateTime      @updatedAt
  
  positions           LiveSessionPosition[]
  
  @@index([userId, isActive])
  @@index([network, isActive])
}

enum NetworkType {
  VATSIM
  IVAO
  Offline
}
```

### Erweiterte LiveSession (mit ACARS-Support)

```prisma
model LiveSession {
  id                  String        @id @default(cuid())
  userId              String?
  user                User?         @relation(...)
  
  // Network = wo Pilot offiziell ist
  network             NetworkType   @default(Offline)
  externalId          Int?          // vatsimCid oder ivaoVid (wenn Network!=Offline)
  
  // DataSource = woher die Daten kommen
  dataSource          DataSource    @default(VATSIM_DATAFEED)
  acarsClientVersion  String?       // "vam-acars-1.0.0", null wenn nicht ACARS
  acarsSimulator      Simulator?    // MSFS, P3D, XPLANE — für Stats
  
  callsign            String
  flightNumber        String?       // separates Feld, z.B. "LH123"
  
  aircraftType        String?
  aircraftRegistration String?
  aircraftTitle       String?       // ACARS only, z.B. "Asobo A320 Lufthansa"
  
  departureIcao       String?
  arrivalIcao         String?
  alternateIcao       String?
  cruiseAltitude      Int?
  flightRules         String?
  
  // Position (basics)
  latitude            Float
  longitude           Float
  altitude            Int
  groundSpeed         Int
  heading             Int
  onGround            Boolean       @default(false)
  
  // Extended Telemetry (ACARS-only, nullable)
  altitudeAglFt       Int?
  indicatedAirspeed   Int?
  trueAirspeed        Int?
  mach                Float?
  verticalSpeedFpm    Int?
  pitch               Float?
  bank                Float?
  
  // Engine (Avg over engines)
  engineN1Avg         Float?
  engineN2Avg         Float?
  fuelFlowPph         Int?
  fuelTotalKg         Int?
  
  // State (ACARS-only)
  flapsPercent        Int?
  gearDown            Boolean?
  spoilersDeployed    Boolean?
  parkingBrake        Boolean?
  autopilotMaster     Boolean?
  
  // Forces
  gForce              Float?
  
  // Environment
  windSpeedKts        Int?
  windDirection       Int?
  oatCelsius          Int?
  
  // Phase (computed by ACARS-client)
  currentPhase        String?       // 'Cruise', 'Climb', etc.
  
  // Anti-Cheat
  simRate             Float?        // 1.0 = real-time, >1 = accelerated
  totalPauseSeconds   Int           @default(0)
  
  isActive            Boolean       @default(true)
  connectedAt         DateTime      @default(now())
  lastUpdatedAt       DateTime      @updatedAt
  
  positions           LiveSessionPosition[]
  
  @@index([userId, isActive])
  @@index([network, isActive])
  @@index([dataSource])
}

enum NetworkType {
  VATSIM
  IVAO
  Offline
}

enum DataSource {
  VATSIM_DATAFEED
  IVAO_WHAZZUP
  ACARS_CLIENT
  MANUAL
}

enum Simulator {
  MSFS
  P3D
  XPLANE
  FSX
}
```

### Erweiterte LiveSessionPosition

Für die Trail-Visualisierung und spätere Pirep-Telemetrie:

```prisma
model LiveSessionPosition {
  id              String       @id @default(cuid())
  sessionId       String
  session         LiveSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  timestamp       DateTime     @default(now())
  
  latitude        Float
  longitude       Float
  altitude        Int
  groundSpeed     Int
  heading         Int
  
  // ACARS-only extras (nullable)
  altitudeAglFt   Int?
  indicatedAirspeed Int?
  verticalSpeedFpm Int?
  pitch           Float?
  bank            Float?
  
  // State
  onGround        Boolean
  flapsPercent    Int?
  gearDown        Boolean?
  
  // Phase
  phase           String?
  
  @@index([sessionId, timestamp])
}
```

### Neue User-Felder für ACARS

```prisma
model User {
  // existing fields...
  
  // OBS-Overlay Token (Phase 1, schon committed)
  overlayToken    String?  @unique
  
  // ACARS Token + Pairing (neu)
  acarsToken      String?  @unique
  acarsPairedAt   DateTime?
  acarsLastSeen   DateTime?
  acarsClientVersion String?
  acarsSimulator  Simulator?
  
  // Preferred Network (User-Wahl in Settings, ACARS-Client-Default)
  preferredNetwork NetworkType  @default(Offline)
}
```

### Neue Tabelle: AcarsPairingCode

Temporäre Codes die User in der ACARS-App eingibt um sich zu verbinden.

```prisma
model AcarsPairingCode {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  code        String   @unique  // z.B. "X4F-7K2-9PB" (9 chars, gut lesbar)
  expiresAt   DateTime           // 15 Minuten gültig
  consumedAt  DateTime?          // null = noch nicht eingelöst
  
  createdAt   DateTime @default(now())
  
  @@index([code])
  @@index([userId, consumedAt])
}
```

---

## 4. Datenfluss-Diagramme

### Heute: VATSIM-Tracking

```
[VATSIM Public API]
        │
        │ HTTP-Polling alle 30s
        ▼
[VAM Bot]
        │
        │ Filtert auf bekannte vatsimCids
        │ Schreibt LiveSession (upsert)
        ▼
[PostgreSQL: LiveSession]
        │
        │ Prisma-Read
        ▼
[Web-App: Live-Map / Sidebar / Overlay]
```

### Zukunft: ACARS-Heartbeat

```
[Microsoft Flight Simulator]
        │
        │ SimConnect-Frames (5+ Hz)
        ▼
[ACARS-Client (Electron)]
        │
        │ HTTP-POST mit Bearer-Token
        │ Alle 1-2s: /api/acars/heartbeat
        ▼
[VAM Web-Server: /api/acars/heartbeat]
        │
        │ Validate Token → User
        │ Upsert LiveSession (network=user.preferredNetwork, 
        │                     dataSource=ACARS_CLIENT)
        │ Append LiveSessionPosition
        ▼
[PostgreSQL]
        │
        │ Prisma-Read + (optional) SSE-Push
        ▼
[Web-App: Live-Map / Overlay / Pirep-Detail]
```

### Mixed: ACARS + VATSIM gleichzeitig

```
[MSFS]                              [VATSIM Network]
    │                                       │
    │ SimConnect                            │ Pilot connected via vPilot
    ▼                                       ▼
[ACARS-Client]                      [VATSIM Public API]
    │                                       │
    │ /api/acars/heartbeat (1s)             │ Polled by Bot (30s)
    ▼                                       ▼
[VAM Web-Server] ◄──────────────────[VAM Bot]
    │
    │ Beide Quellen bekannt
    │ ACARS hat Priorität (höher Quality)
    │ VATSIM-Daten als Heartbeat-Backup
    │ network=VATSIM, dataSource=ACARS_CLIENT
    ▼
[PostgreSQL: LiveSession]
```

**Server-Logik bei mixed:**
```typescript
// /api/acars/heartbeat empfängt Daten
const session = await upsertLiveSession({
  userId: user.id,
  network: user.preferredNetwork,  // z.B. VATSIM
  dataSource: 'ACARS_CLIENT',      // Quelle
  ...telemetryFromAcars,
});

// Bot-Tracker (läuft separat, alle 30s):
async function vatsimTrackerTick() {
  for (const pilot of vatsimPilots) {
    const user = findUserByVatsimCid(pilot.cid);
    if (!user) continue;
    
    // Check: hat dieser User bereits eine ACARS_CLIENT-Session?
    const existing = await getActiveSession(user.id);
    if (existing?.dataSource === 'ACARS_CLIENT' &&
        new Date() - existing.lastUpdatedAt < 10_000) {
      // ACARS ist primary, VATSIM-Daten ignorieren
      // Aber: bestätige dass User wirklich auf VATSIM ist
      await markVatsimPresence(existing.id);
      continue;
    }
    
    // Kein ACARS aktiv: schreibe VATSIM-Daten als primary
    await upsertLiveSession({
      userId: user.id,
      network: 'VATSIM',
      dataSource: 'VATSIM_DATAFEED',
      ...vatsimData,
    });
  }
}
```

---

## 5. API-Endpoints

### POST /api/acars/pairing/request

User generiert in der Web-Settings-Page einen Pairing-Code.

```typescript
// Server-Action, Auth via NextAuth-Session
async function requestPairingCode(): Promise<{ code: string; expiresAt: string }> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  
  // Alte unbenutzte Codes invalidieren
  await prisma.acarsPairingCode.updateMany({
    where: { userId: session.user.id, consumedAt: null },
    data: { expiresAt: new Date() }, // Force-Expire
  });
  
  // Neuen Code generieren
  const code = generateReadableCode(); // z.B. "X4F-7K2-9PB"
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  
  await prisma.acarsPairingCode.create({
    data: { userId: session.user.id, code, expiresAt },
  });
  
  return { code, expiresAt: expiresAt.toISOString() };
}

function generateReadableCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I/L
  const segments = Array.from({ length: 3 }, () => 
    Array.from({ length: 3 }, () => 
      chars[Math.floor(Math.random() * chars.length)]
    ).join('')
  );
  return segments.join('-');
}
```

### POST /api/acars/pairing/redeem

ACARS-Client schickt Code, bekommt Token.

```typescript
// Public, kein Auth
async function POST(req: NextRequest) {
  const { code } = await req.json();
  
  const pairing = await prisma.acarsPairingCode.findUnique({
    where: { code },
    include: { user: true },
  });
  
  if (!pairing || pairing.consumedAt || pairing.expiresAt < new Date()) {
    return Response.json({ error: 'invalid_or_expired' }, { status: 400 });
  }
  
  // Generiere Token
  const acarsToken = randomBytes(32).toString('hex'); // 64 chars hex
  
  // Update User + invalidate Pairing-Code
  await prisma.$transaction([
    prisma.user.update({
      where: { id: pairing.userId },
      data: {
        acarsToken,
        acarsPairedAt: new Date(),
      },
    }),
    prisma.acarsPairingCode.update({
      where: { id: pairing.id },
      data: { consumedAt: new Date() },
    }),
  ]);
  
  return Response.json({
    token: acarsToken,
    user: {
      id: pairing.user.id,
      name: pairing.user.name,
    },
  });
}
```

### POST /api/acars/heartbeat

Hauptkanal: ACARS-Client schickt Telemetrie.

```typescript
// Auth via Bearer-Token
async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = auth.slice(7);
  
  const user = await prisma.user.findUnique({
    where: { acarsToken: token },
  });
  if (!user) {
    return Response.json({ error: 'invalid_token' }, { status: 401 });
  }
  
  const data = HeartbeatSchema.parse(await req.json());
  
  // Rate-Limit-Check (max 1 Heartbeat/sec pro User)
  if (await isRateLimited(user.id)) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  
  // Upsert LiveSession
  const session = await prisma.liveSession.upsert({
    where: { 
      // Unique-Constraint: nur eine aktive Session pro User+Source
      userId_dataSource_isActive: {
        userId: user.id,
        dataSource: 'ACARS_CLIENT',
        isActive: true,
      },
    },
    create: {
      userId: user.id,
      network: data.network,
      dataSource: 'ACARS_CLIENT',
      acarsClientVersion: data.clientVersion,
      acarsSimulator: data.simulator,
      callsign: data.flight.callsign,
      flightNumber: data.flight.flightNumber,
      aircraftType: data.aircraft.type,
      aircraftRegistration: data.aircraft.registration,
      aircraftTitle: data.aircraft.title,
      departureIcao: data.flight.departure,
      arrivalIcao: data.flight.arrival,
      // ... all telemetry fields
    },
    update: {
      // Same fields, updated
      lastUpdatedAt: new Date(),
      // ... all telemetry fields
    },
  });
  
  // Append Position für Trail
  await prisma.liveSessionPosition.create({
    data: {
      sessionId: session.id,
      latitude: data.position.latitude,
      longitude: data.position.longitude,
      altitude: data.position.altitudeFt,
      groundSpeed: data.speed.groundKts,
      heading: data.position.headingTrue,
      onGround: data.state.onGround,
      altitudeAglFt: data.position.altitudeAglFt,
      indicatedAirspeed: data.speed.indicatedKts,
      verticalSpeedFpm: data.speed.verticalFpm,
      pitch: data.position.pitch,
      bank: data.position.bank,
      flapsPercent: data.state.flapsPercent,
      gearDown: data.state.gearDown,
      phase: data.phase,
    },
  });
  
  // Update User-Last-Seen
  await prisma.user.update({
    where: { id: user.id },
    data: { acarsLastSeen: new Date() },
  });
  
  return Response.json({ ok: true, sessionId: session.id });
}

const HeartbeatSchema = z.object({
  timestamp: z.string().datetime(),
  clientVersion: z.string(),
  simulator: z.enum(['MSFS', 'P3D', 'XPLANE']),
  network: z.enum(['VATSIM', 'IVAO', 'Offline']),
  phase: z.enum([
    'PreFlight', 'Pushback', 'Taxi', 'Takeoff', 
    'Climb', 'Cruise', 'Descent', 'Approach',
    'Landing', 'TaxiIn', 'BlockOn'
  ]),
  flight: z.object({
    callsign: z.string(),
    flightNumber: z.string().optional(),
    departure: z.string().optional(),
    arrival: z.string().optional(),
  }),
  aircraft: z.object({
    type: z.string(),
    registration: z.string(),
    title: z.string().optional(),
  }),
  position: z.object({
    latitude: z.number(),
    longitude: z.number(),
    altitudeFt: z.number(),
    altitudeAglFt: z.number().optional(),
    headingTrue: z.number(),
    pitch: z.number().optional(),
    bank: z.number().optional(),
  }),
  speed: z.object({
    indicatedKts: z.number(),
    trueKts: z.number().optional(),
    groundKts: z.number(),
    mach: z.number().optional(),
    verticalFpm: z.number(),
  }),
  state: z.object({
    onGround: z.boolean(),
    parkingBrake: z.boolean().optional(),
    flapsPercent: z.number().optional(),
    gearDown: z.boolean().optional(),
    spoilersDeployed: z.boolean().optional(),
    autopilotMaster: z.boolean().optional(),
  }),
  // ... more fields per simconnect-data-catalog
});
```

### POST /api/acars/event

Spezielle Events (Touchdown, Block-On) — separater Endpoint für Auto-PIREP-Trigger.

```typescript
async function POST(req: NextRequest) {
  // Same auth as heartbeat
  const data = EventSchema.parse(await req.json());
  
  switch (data.type) {
    case 'TOUCHDOWN':
      // Save touchdown stats to active session
      // Will be used in Pirep when finalized
      break;
      
    case 'BLOCK_ON':
      // Trigger PIREP-Generation
      const pirep = await generatePirepFromSession(session, data);
      return Response.json({ ok: true, pirepId: pirep.id });
      
    case 'PHASE_CHANGE':
      // Log phase transition
      break;
      
    case 'INCIDENT':
      // Hard-Landing, Stall, Overspeed
      break;
  }
  
  return Response.json({ ok: true });
}
```

### POST /api/acars/disconnect

ACARS-Client schickt beim Beenden ein cleanes "Bye".

```typescript
async function POST(req: NextRequest) {
  // Marks LiveSession as isActive=false
  // Useful damit man nicht wartet bis Timeout greift
}
```

### GET /api/acars/status

Health-Check für die App (Server-Reachable?).

### Settings-UI Endpoints

```typescript
// GET via Server-Component
async function getAcarsStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { 
      acarsPairedAt: true, 
      acarsLastSeen: true,
      acarsClientVersion: true,
      acarsSimulator: true,
    },
  });
  
  return {
    paired: !!user?.acarsPairedAt,
    lastSeenAt: user?.acarsLastSeen,
    clientVersion: user?.acarsClientVersion,
    simulator: user?.acarsSimulator,
    isOnline: user?.acarsLastSeen 
      ? new Date() - user.acarsLastSeen < 30_000 
      : false,
  };
}

// Server-Action für Disconnect
async function disconnectAcars() {
  // Rotate token (alter wird ungültig)
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      acarsToken: null,
      acarsPairedAt: null,
      acarsLastSeen: null,
    },
  });
}
```

---

## 6. Auth-Flow (Pairing-Code-System)

### Warum Pairing-Code statt Login?

Pilot soll **nicht** Discord-Passwort in eine Drittanbieter-App eingeben. Auch nicht VATSIM-Passwort. Stattdessen: einmaliger Code auf der Web-Page → in App eingeben → Token-Austausch.

```
Vorteile:
  ✅ Kein Passwort verlässt die Web-App
  ✅ User kann jederzeit Token revoken (Disconnect-Button)
  ✅ App speichert nur Token, kein Passwort
  ✅ Code expired in 15 Min — Brute-Force-Resistance
  ✅ Standard-Pattern (Spotify Connect, Discord Bot Pairing, etc.)
```

### Flow im Detail

```
┌─────────────────────────────────────────────────────────────┐
│  USER AUF WEB                  USER AUF ACARS-APP           │
│                                                             │
│  1. Settings → ACARS                                        │
│     "Pair Device" Button                                    │
│                                                             │
│  2. Server generiert Code:                                  │
│     "X4F-7K2-9PB"                                           │
│     Expires in 15:00                                        │
│                                                             │
│                                3. User öffnet ACARS-App     │
│                                4. App: "Enter Pairing Code" │
│                                5. User tippt: X4F-7K2-9PB   │
│                                                             │
│                                6. App: POST /api/acars/     │
│                                        pairing/redeem       │
│                                        { code: "X4F-7K..." }│
│                                                             │
│  7. Server: Validate Code                                   │
│     - Existiert? Gültig? Nicht consumed?                    │
│     - Ja: User-ID extrahieren, Token generieren             │
│     - Nein: 400 Error                                       │
│                                                             │
│                                8. App empfängt Token        │
│                                9. App speichert Token sicher│
│                                   (OS-Keychain auf macOS,   │
│                                    DPAPI auf Windows)       │
│                                10. App ist gepaired!        │
│                                                             │
│  11. Web-Page polled GET /api/acars/status                  │
│      (alle 5s während Pair-Modus)                           │
│      Sieht: paired=true                                     │
│      → Zeigt "Connected: vam-acars 1.0.0 (MSFS)"           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Token-Lifecycle

```
Token wird invalidiert wenn:
  - User klickt "Disconnect" in Web-Settings
  - User klickt "Re-Pair" (alte Token wird überschrieben)
  - User wird gebanned/account deleted
  - Anomalien detected (zu viele Heartbeats, ungewöhnliche IPs)

Token wird NICHT auto-rotiert — User behält ihn solange er will.
```

### Sicherheits-Considerations

```
1. Token im Plaintext OK?
   → JA, weil Token bereits 256-bit Random (64 hex chars).
     Brute-Force unmöglich. Token nicht im URL exponiert
     (immer Header), Server-Side Rate-Limit.

2. HTTPS-Pflicht?
   → JA. ACARS-Client validiert TLS-Cert.
     Self-Signed-Certs werden abgelehnt.

3. Was wenn Token leakt?
   → User sieht in Settings "Last Seen IP" + Geolocation
   → User klickt Disconnect, neuer Pair-Code, neuer Token

4. Multi-Device-Support?
   → Aktuell: 1 Token pro User = 1 Device
   → Future: ACARS-Devices als separate Entity, 
     mehrere Tokens pro User möglich

5. CSRF?
   → API nutzt Bearer-Token-Header, nicht Cookies → CSRF-immun

6. Replay-Attacks?
   → Heartbeat-Timestamps werden geprüft
   → Wenn timestamp > 5 Min in Vergangenheit: abgelehnt
   → Wenn timestamp > 1 Min in Zukunft: abgelehnt
```

---

## 7. Was ändert sich am Bestand?

### Bot-Tracker

Heute schreibt der Bot direkt LiveSession bei jedem 30s-Tick.

**Anpassung:**

```typescript
// Vorher
await prisma.liveSession.upsert({
  where: { network_externalId: { network: 'VATSIM', externalId: pilot.cid }},
  create: { /* ... */ },
  update: { /* ... */ },
});

// Nachher
const existing = await prisma.liveSession.findFirst({
  where: { 
    userId: user.id,
    isActive: true,
  },
  orderBy: { lastUpdatedAt: 'desc' },
});

if (existing?.dataSource === 'ACARS_CLIENT' && 
    new Date() - existing.lastUpdatedAt < 10_000) {
  // ACARS hat Vorrang, NUR Network-Presence bestätigen
  await prisma.liveSession.update({
    where: { id: existing.id },
    data: { /* nur acarsLastVerifiedOnVatsim */ },
  });
} else {
  // ACARS nicht aktiv: schreibe VATSIM-Daten wie heute
  await prisma.liveSession.upsert({
    where: { /* ... */ },
    create: { dataSource: 'VATSIM_DATAFEED', /* ... */ },
    update: { /* ... */ },
  });
}
```

### Settings-Page

Neue Section "ACARS-Client" — analog zur OBS-Overlay-Section, aber mit:
- Pairing-Code-Generator + Display
- Status: paired/not paired, last seen, simulator
- Disconnect-Button
- Download-Link zur Desktop-App
- Network-Picker (VATSIM/IVAO/Offline) als Default für ACARS

### Live-Map / Sidebar / OBS-Overlay

**Anzeige bekommt zusätzliches "Quality"-Indikator:**

```
🟢 ACARS  (1s data, 100m precision)    ← Premium-Tier
🟡 VATSIM (30s data, 50m precision)    ← Standard
🟡 IVAO   (30s data, 50m precision)    ← Standard
```

User-facing nicht aufdringlich, kleines Icon.

### LiveSession-Read-Logic

Aktuell: `network` zeigt Quelle und Anzeige.  
Neu: 
- `network` = Anzeige (User-Wahl)
- `dataSource` = Quelle (intern)

→ Live-Map liest beide, zeigt `network` an, nutzt `dataSource` für Quality-Tier.

---

## 8. Migrations-Plan

### Phase 0: Vorbereitung (kann heute committed werden, ohne ACARS-Client)

```
1. Migration: NetworkType += ACARS (für Phase 2 OBS-Overlay)
   → Schon im OBS-Roadmap geplant
   → ACARS-Enum-Value bleibt unbenutzt bis ACARS kommt

2. Migration: DataSource enum + LiveSession.dataSource
   → Default für bestehende Sessions: VATSIM_DATAFEED oder IVAO_WHAZZUP
     (basierend auf bisherigem network-Field)
   → Bot-Tracker setzen es ab jetzt explicit

3. Migration: User.preferredNetwork
   → Default: Offline
   → Settings-UI bekommt Picker (nice-to-have heute schon)
```

### Phase 1: ACARS-Backend (~3 Tage)

```
4. Migration: User.acarsToken + acarsPairedAt + acarsLastSeen + Co.
5. Migration: AcarsPairingCode-Tabelle
6. Migration: LiveSession.* (alle ACARS-Telemetrie-Felder als optional)
7. Migration: LiveSessionPosition.* (Telemetrie-Erweiterung)

8. API-Endpoints:
   - POST /api/acars/pairing/request (server-action)
   - POST /api/acars/pairing/redeem
   - POST /api/acars/heartbeat
   - POST /api/acars/event
   - POST /api/acars/disconnect
   - GET  /api/acars/status

9. Bot-Tracker: ACARS-Aware-Logic
10. Settings-UI: ACARS-Section mit Pairing-Code-Generator
```

### Phase 2: ACARS-Client (~5-7 Tage)

```
11. Electron-App-Setup
12. node-simconnect Integration
13. UI: Login-Screen mit Pairing-Code-Input
14. SimConnect-Reading-Loop
15. Heartbeat-Sender
16. Phase-Detection-Logic
17. UI: Status-Window (Connected, Active-Phase, Last-Heartbeat)
18. Auto-Update-Mechanism
19. Tray-Icon
20. Crash-Recovery
```

### Phase 3: Auto-PIREP (~2-3 Tage)

```
21. Block-On-Detection
22. PIREP-Auto-Generation
23. Pre-Flight-Checks (richtiger Departure, Aircraft-Match)
24. PIREP-Submit-Flow im Web (Review + Confirm)
```

### Phase 4: Pirep-Detail-Page-MVP (~3-4 Tage)

Wenn ACARS-Daten existieren, kommt die Pirep-Page.  
Siehe `pirep-analysis-page.md`.

---

## 9. Edge-Cases

### Sim-Crash mitten im Flight

```
Symptom: ACARS-Client merkt: kein neues SimConnect-Frame > 5s
Reaktion:
  1. ACARS pausiert Heartbeats
  2. ACARS speichert lokale Session-Daten (SQLite)
  3. ACARS zeigt "Sim verloren - warte..."
  4. Bei Sim-Reconnect: User wird gefragt "Flug fortsetzen?"
  5. Bei "Ja": Heartbeats resumen mit ResumeFlag

Server-Side:
  - LiveSession.lastUpdatedAt > 60s alt → isActive=false
  - Bei neuem Heartbeat mit ResumeFlag: Session reaktivieren
  - Bei keinem Resume: Session bleibt inactive, Auto-PIREP triggert nicht
```

### ACARS verbindet während VATSIM-Tracking läuft

```
Szenario: User fliegt schon 20 Min auf VATSIM, startet jetzt ACARS
Server-Logik:
  1. Bot hat bereits LiveSession (dataSource=VATSIM_DATAFEED) erstellt
  2. ACARS-Heartbeat kommt rein
  3. Server findet existing Session
  4. Server upgraded dataSource: VATSIM_DATAFEED → ACARS_CLIENT
  5. Bot's nächster Tick: erkennt dataSource=ACARS_CLIENT, ignoriert
  
Vorteil: kein Session-Reset, Trail bleibt zusammenhängend
```

### Network-Loss in ACARS

```
Symptom: ACARS-Client kann Server nicht erreichen
Reaktion:
  1. Heartbeats werden in lokale Queue geschrieben (max 1000 Heartbeats)
  2. UI zeigt "Verbindung verloren - Versuche erneut..."
  3. Reconnect alle 10s
  4. Bei Reconnect: Queue abgearbeitet, dann Live-Heartbeats
  5. Server akzeptiert alte Heartbeats für Trail-Recovery
  
Wichtig: Heartbeat-Queue mit Timestamp, Server sortiert chronologisch ein
```

### Multiple Sims gleichzeitig

```
Szenario: User hat MSFS UND P3D parallel laufen, beide mit ACARS
Reaktion:
  - Auf User-Seite: ACARS-Client ist 1 Instance, connectet zum erstmöglich
    erreichbaren Sim (MSFS oder P3D, je nach Order)
  - Server-Seite: Token = Device. 1 Token = 1 Device = 1 active Session
  - Wenn 2 ACARS-Instances mit gleichem Token: Server akzeptiert nur einen,
    anderer bekommt 409 Conflict
```

### Anti-Cheat: Time-Acceleration während Flight

```
Detection: simRate > 1.0 in 3 aufeinanderfolgenden Heartbeats
Reaktion:
  - Server flagged Session: "TIME_ACCELERATION_DETECTED"
  - Heartbeats werden weiter angenommen
  - Aber: bei PIREP-Generation wird Flag visible für Admin
  - User sieht in Pirep-Detail: ⚠️ Warning-Icon
  - Admin entscheidet: Approve / Reject
```

### Anti-Cheat: Position-Jump

```
Detection: 
  Distance(lastPosition, currentPosition) > Speed * elapsed * 2
  z.B. 50nm in 30s bei 450kt sollte unmöglich sein
Reaktion:
  - Server flagged Session: "POSITION_JUMP_DETECTED"
  - Aber: Spawn-In-Flight ist möglich nach Crash → tolerant am Anfang
```

### Token-Leak

```
User merkt: Andere Person nutzt seinen Token
User-Action: Settings → "ACARS Disconnect" 
Server-Action: 
  - Token wird auf null gesetzt
  - Aktive LiveSession bleibt (für saubere Pirep-Generation)
  - Nächster Heartbeat mit altem Token: 401
```

---

## 10. Performance & Scaling

### Heartbeat-Volume

```
Bei 100 aktiven ACARS-Pilots:
  - 1 Heartbeat pro Sekunde pro Pilot = 100 req/s
  - Plus: Position-Insert in DB pro Heartbeat
  - Total: ~200 DB-Writes pro Sekunde

PostgreSQL kann das easy.

Bei 1000 aktiven ACARS-Pilots (deutlich mehr als realistisch):
  - 1000 req/s
  - 2000 DB-Writes
  - PostgreSQL braucht eventuell Connection-Pooling-Tuning
  - Aber: weiterhin handhabbar
```

### Trail-Storage

```
Pro Flight:
  - 4h Flight × 3600s × 1Hz = 14400 Position-Records
  - Bei ~150 Bytes/Row: ~2.2 MB pro Flight

Pro Pilot pro Jahr:
  - 100 Flights × 2.2 MB = 220 MB

Bei 100 aktiven Pilots:
  - 22 GB pro Jahr in LiveSessionPosition

Mitigation:
  - Position-Records nach 30 Tagen verschieben in PirepTelemetry-Tabelle
  - PirepTelemetry kann downsampled werden (1Hz → 0.1Hz für ältere Pireps)
  - Optional: TimescaleDB-Migration falls Volumen wirklich groß wird
```

### Polling-Optimization

```
OBS-Overlay-Polling: alle 5s
Live-Map-Polling: alle 10s (User-View)
Pirep-Telemetry: einmalig beim Page-Load

Optimization-Plan:
  Phase 1: Polling reicht für <100 concurrent users
  Phase 2: SSE für Live-Tracking (Push statt Pull)
  Phase 3: Redis Pub/Sub für Bot ↔ Server-Sync
```

---

## 11. Erweiterungen (Future Phase) — Wettervergleich + ATC

> Diese sind separate Features, aber durch ACARS möglich gemacht.

### Wettervergleich

**Idee:** ACARS liefert Sim-Wetter (das was im Sim simuliert wird).
Aber: was war das **echte** Wetter zu der Zeit?

```
Heartbeat liefert:
  - windSpeedKts (vom Sim)
  - windDirection (vom Sim)
  - oatCelsius (vom Sim)
  - ambientPressureMb (vom Sim)

Server holt parallel:
  - Echtes METAR vom Departure/Arrival/Cruise-Region
  - Quelle: aviationweather.gov (kostenlos) oder OpenWeatherMap

Pirep-Page zeigt:
  WEATHER COMPARISON
  ┌─────────────────────────────────────────────────────┐
  │  Cruise Wetter                                      │
  │                                                     │
  │  Im Sim:        Real-World (gleiche Zeit, FL370):   │
  │  Wind 270/65   Wind 280/72                          │
  │  OAT -54°C     OAT -56°C                            │
  │  Press 1013    Press 1015                           │
  │                                                     │
  │  → Sim-Wetter war 90% akkurat zur Realität ✅       │
  └─────────────────────────────────────────────────────┘
```

**Aufwand:** ~2-3 Tage  
**Voraussetzung:** ACARS liefert Wetter-Daten (kommt automatisch)  
**Wert:** Coole Stat für Realismus-Fans

### ATC-Integration

**Idee:** ACARS liefert COM/NAV-Frequenzen. Match gegen VATSIM-ATC-Stationen.

```
ACARS schickt zusätzlich:
  - com1Active: 119.0
  - com1Standby: 121.5
  - nav1Active: 110.3 (ILS-Frequenz)
  
Server hat Access zu VATSIM-ATC-Datafeed:
  - "Welche ATC-Stationen sind aktiv und auf welchen Freqs?"
  - Mapping: 119.0 + Position → "FRA_TWR" (Frankfurt Tower)

Pirep-Page zeigt:
  ATC SESSIONS
  ┌─────────────────────────────────────────────────────┐
  │  12:42  EDDF_GND  121.6  (5 Min)                    │
  │  12:48  EDDF_TWR  119.0  (3 Min)                    │
  │  12:51  LANGEN_R  118.875 (28 Min)                  │
  │  13:20  RHEIN_R   135.5   (52 Min)                  │
  │  ...                                                │
  │                                                     │
  │  → Du hattest 6 ATC-Sessions auf diesem Flug ✅     │
  └─────────────────────────────────────────────────────┘
```

**Aufwand:** ~3-4 Tage  
**Voraussetzung:** 
- ACARS liefert COM-Frequenzen
- Server hat VATSIM-ATC-Datafeed (Bot pollt es schon, einfach erweitern)

**Wert:** Sehr cool für VATSIM-Pilots, zeigt Engagement mit ATC

### Heatmap aller Pilots

**Idee:** Aggregation aller PIREPs ergibt Heatmap der populärsten Routen.

```
Auf der Web-Page:
  - Live-Map hat Toggle "Heatmap zeigen"
  - Toggle on: Heatmap aller geflogenen Strecken über letzte 30 Tage
  - Color-coded: blau (1-10 Flights), gelb (10-50), rot (50+)
  
Tech: Deck.gl HeatmapLayer auf Mapbox-Layer

Plus: Touchdown-Heatmap pro Airport
  - "Wo touchen Pilots typically auf RWY 25R EDDF?"
  - Histogram der Touchdown-Position
  - Coole Übersicht für Airline-Performance
```

**Aufwand:** ~2-3 Tage  
**Wert:** Community-Feature, zeigt VAM-Activity

---

## 12. Implementation-Reihenfolge (Empfehlung)

```
HEUTE/MORGEN (DB-Vorbereitung, ohne ACARS-Client):
  1. NetworkType += ACARS              (5 Min)
  2. DataSource enum + Field           (10 Min)
  3. User.preferredNetwork            (5 Min)
  
WANN IMMER (Backend-Vorbereitung):
  4. AcarsPairingCode-Tabelle         (10 Min)
  5. User.acarsToken + Co.            (10 Min)
  6. Migration                        (5 Min)
  7. API-Endpoints                    (3-4 Tage)
  8. Settings-UI ACARS-Section       (4-6 Stunden)
  9. Bot-Tracker ACARS-Aware-Logic   (4-6 Stunden)
  
DANN (ACARS-Client-Entwicklung):
  10. Electron-Setup                  (1 Tag)
  11. node-simconnect Integration     (1-2 Tage)
  12. UI + Pairing-Flow              (1 Tag)
  13. Heartbeat-Loop + Phase-Detect   (2-3 Tage)
  14. Crash-Recovery + Polish         (1-2 Tage)
  
DANN (Auto-PIREP):
  15. Block-On-Detection              (1 Tag)
  16. PIREP-Generation-Server         (1-2 Tage)
  17. Pre-Flight-Validation           (1 Tag)
  
DANN (Pirep-Detail-Page):
  18. Schema-Erweiterung              (siehe pirep-analysis-page.md)
  19. MVP-Page                        (3-4 Tage)
  20. Premium (3D-Globe etc.)         (3-4 Tage)
  
LATER (Erweiterungen):
  21. Wettervergleich                 (2-3 Tage)
  22. ATC-Integration                 (3-4 Tage)
  23. Heatmap                         (2-3 Tage)
```

**Total:** ~25-35 Tage Solo-Arbeit für vollständige ACARS-Vision.

→ Realistisch über 2-4 Monate verteilt mit Pausen, Beta-Test, Bug-Fixing.

---

## 13. Tech-Stack-Entscheidung Reminder

```
ACARS-Client:
  ✅ Electron + React + TypeScript
  ✅ node-simconnect (npm) für MSFS + P3D
  ✅ Eigener XPLM-Plugin für X-Plane (Phase 2)
  ❌ vmsACARS-Kompatibilität (explizit gestrichen)
  
ACARS-Backend:
  ✅ Next.js Route-Handlers (in apps/web)
  ✅ Prisma für DB-Access
  ✅ Zod für Schema-Validation
  ✅ Bearer-Token-Auth
  
Server-Stack bleibt:
  ✅ PostgreSQL
  ✅ NestJS-Bot
  ✅ Mapbox + CesiumJS (für Pirep-Detail)
  ✅ Recharts + Visx (für Charts)
```

---

## 14. Open Questions

- [ ] Sollen ACARS-Tokens auch rotierbar sein (wie Overlay-Tokens) oder nur via "Disconnect"?
- [ ] Multi-Device-Support: Ein User mit 2 PCs (MSFS + P3D)?
- [ ] Token-Storage in der App: OS-Keychain (sicher) oder File (einfach)?
- [ ] Wie tief soll Anti-Cheat gehen? (Aggressiv = manche legitime Pilots werden geflagged, lax = Cheater kommen durch)
- [ ] PIREP-Auto-Submit oder immer User-Review-Required?
- [ ] Soll ACARS auch ohne Pairing nutzbar sein? (Demo-Mode für Show-Off)
- [ ] Branding: Heißt die App "VAM ACARS" oder spezifisch je Airline?
- [ ] Was bei Aircraft-Substitution? (Pilot fliegt geplanten A320 mit B737 — PIREP-Reject oder Warning?)
- [ ] Crashed-Sim-Recovery: wie lange wird Resume erlaubt? (10 Min? 1h?)
- [ ] Code-Signing-Cert kaufen für Windows-Installer? (~$200-500/Jahr)

---

## 15. Risiko-Einschätzung

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|
| node-simconnect bricht bei MSFS-Update | Mittel | Hoch | Maintainer kontaktieren, eigene Forks pflegen |
| Pilots wollen kein extra Tool | Mittel | Mittel | Optional machen, VATSIM-Tracking bleibt |
| Performance-Probleme bei vielen Heartbeats | Niedrig | Mittel | Rate-Limiting, Connection-Pooling |
| Token-Leaks | Niedrig | Mittel | UI für Quick-Revoke |
| Anti-Cheat-False-Positives | Mittel | Mittel | Admin-Review-Queue, nicht Auto-Reject |
| Cesium-Bundle zu groß für Mobile | Hoch | Niedrig | Lazy-Load, nur Desktop-Nutzer |
| ACARS-App-Distribution (Code-Signing) | Hoch | Mittel | Self-Signed mit Doku, oder Cert kaufen |
| X-Plane-Support komplex | Hoch | Niedrig | Erst MSFS+P3D, X-Plane Phase 2 |

---

## 16. Success-Metrics

Wann ist das ACARS-System "erfolgreich"?

```
Primary Metrics:
  - 50%+ der Discord-Pilots haben ACARS gepairt nach 3 Monaten
  - 80%+ der PIREPs werden über ACARS submittet (nicht manuell)
  - Durchschnittlicher Pirep-Score > 70/100 (zeigt Engagement)
  - Bot-Tracker-Discrepancy < 5% (ACARS-Daten matchen VATSIM-Track)

Secondary Metrics:
  - 10+ Streamer nutzen OBS-Overlay regelmäßig
  - <1% Anti-Cheat-False-Positive-Rate
  - <5% Pirep-Manual-Review-Rate (meist auto-approved)
  - Pilots schauen sich Pirep-Detail-Page an (nicht nur abschicken)

Qualitative:
  - Discord-Feedback positiv ("endlich was Eigenes")
  - Andere VAs fragen nach VAM-System (Marketing-Win)
  - Pirep-Page wird auf Twitter/Discord geteilt
```

---

## 17. Conclusion

Diese Architektur trennt **Network**, **DataSource** und **ACARS** sauber:

- **Network** ist eine User-Wahl, beeinflusst Anzeige.
- **DataSource** ist System-intern, beeinflusst Quality.
- **ACARS** ist die Software-Komponente die Daten liefert.

Mit dieser Trennung kann VAM:
- Heute mit VATSIM/IVAO-Polling weitermachen (kein Breaking-Change)
- Später ACARS dazu schalten (additiv)
- ACARS und VATSIM gleichzeitig haben (Best-of-Both)
- Andere Datenquellen einfach hinzufügen (z.B. später VATSIM-Audio-Tracker)

Die **Pirep-Detail-Page** ist der Pay-Off: alles was hier in den Heartbeats steht wird dort visualisiert. Streamer-Overlay ist ein Nebenprodukt.

→ **Großes System, klar designed, schrittweise implementierbar.**

---

## Referenzen

- [`simconnect-data-catalog.md`](./simconnect-data-catalog.md) — SimVar-Liste
- [`pirep-analysis-page.md`](./pirep-analysis-page.md) — UI-Spec der Pirep-Page
- [`todo-obs-overlay-system.md`](./todo-obs-overlay-system.md) — OBS-Overlay-Roadmap (Phase 8 = ACARS-Implementation)
- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [node-simconnect npm](https://www.npmjs.com/package/node-simconnect)
- [X-Plane XPLM SDK](https://developer.x-plane.com/sdk/)
- [Spotify Connect Pairing](https://developer.spotify.com/documentation/web-api/concepts/connect) — Inspiration für Pairing-Flow
- [Discord Bot Token-Pattern](https://discord.com/developers/docs/topics/oauth2) — Inspiration für Token-Lifecycle
