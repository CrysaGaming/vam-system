# Weather-Provider-Strategie für VAM-System

> Multi-Provider-Architektur mit Geo-Awareness und automatischem Failover.
> Ziel: Beste Wetter-Daten für jeden Pilot, weltweit, im Free-Tier-Bereich,
> mit eleganter Degradation und ACARS-Integration.

**Stand:** April 2026  
**Verwandte Dokumente:**
- [`acars-architecture.md`](./acars-architecture.md) — ACARS-Position-Coupling
- [`pirep-analysis-page.md`](./pirep-analysis-page.md) — Wettervergleich-Section
- [`todo-obs-overlay-system.md`](./todo-obs-overlay-system.md) — Live-Map-Wetter-Layer

---

## 1. Das Problem

### Aktueller Stand (April 2026)

```
VAM nutzt RainViewer als einzige Wetter-Quelle.

Probleme:
  ❌ Zoom-Limit 7 → "Grid-Pattern" beim Reinzoomen ab ~30km Maßstab
  ❌ Single-Point-of-Failure (RainViewer down = kein Wetter)
  ❌ RainViewer hat seit 2025 "limited operation" Status
  ❌ Globale Daten-Qualität durchschnittlich
  ❌ Keine Möglichkeit, lokal bessere Quellen zu nutzen
  ❌ Kein Limit-Tracking → bei API-Änderung böse Überraschung
```

### Vision

```
Ein Multi-Provider-System mit:
  ✅ Geo-Awareness (lokale Provider wo verfügbar)
  ✅ Automatischer Failover bei Limit oder Outage
  ✅ Self-Limiting (bleibt im Free-Tier)
  ✅ Caching (gleiche Tiles nicht mehrfach holen)
  ✅ Transparente UX (User merkt Switch nicht)
  ✅ Admin-Monitoring (Discord-Alerts bei Anomalien)
  ✅ ACARS-gekoppelt (Position-aware Provider-Wahl)
```

---

## 2. Provider-Marktanalyse

### Globale Provider

| Provider | Free-Tier | Max Zoom | Update | Coverage | API-Key | Qualität |
|---|---|---|---|---|---|---|
| **RainViewer** | ✅ Unbegrenzt (Personal) | 7 | 5 Min | Weltweit | ❌ | Gut |
| **OpenWeatherMap** | ✅ 1k/Tag (30k/Monat) | 9 | 3h (Free) / 10min (Pro) | Weltweit | ✅ | Solide |
| **Rainbow Weather** | ✅ 30k/Monat | 12+ | Real-time | Weltweit | ✅ + KK | Excellent |
| **Tomorrow.io** | ❌ Auf Anfrage | 12+ | Real-time | Weltweit | ✅ | Excellent |
| **Meteoblue** | ❌ Silver+ | 9-12 | Real-time | Weltweit | ✅ | Excellent |
| **Xweather/Vaisala** | ❌ Enterprise | 12+ | Real-time | Weltweit | ✅ | Best-in-class |

### Nationale/Regionale Provider (Premium-Quality, oft kostenlos)

| Provider | Region | Limit | Max Zoom | API-Key | Lizenz |
|---|---|---|---|---|---|
| **DWD GeoServer** | 🇩🇪 Deutschland | ✅ Unbegrenzt | ~10 | ❌ | CC BY 4.0 |
| **NOAA NWS MRMS** | 🇺🇸 USA | ✅ Unbegrenzt | 7-9 | ❌ | Public Domain |
| **Met Office DataPoint** | 🇬🇧 UK | ⚠️ Free Tier | 9 | ✅ | Open Data |
| **Météo-France** | 🇫🇷 Frankreich | ⚠️ Free Tier | 9 | ✅ | Open Data |
| **MSC GeoMet** | 🇨🇦 Kanada | ✅ Unbegrenzt | 10+ | ❌ | Open Government |
| **EUMETSAT** | 🇪🇺 Europa | ⚠️ Anmeldung | 9 | ✅ | Frei nach Reg. |
| **MeteoSwiss** | 🇨🇭 Schweiz | ⚠️ Limited | 10 | ⚠️ | Limitiert |
| **GeoSphere Austria** | 🇦🇹 Österreich | ⚠️ Limited | 10 | ⚠️ | CC BY 4.0 |
| **KNMI** | 🇳🇱 Niederlande | ✅ Unbegrenzt | 10+ | ❌ | Open Data |

### Schlüssel-Insight

```
Die nationalen Wetter-Services sind:
  ✅ Original-Datenquellen (was RainViewer/OWM aggregieren)
  ✅ Höhere Auflösung als globale Aggregatoren
  ✅ Bessere Qualität in ihrer Region
  ✅ Oft komplett kostenlos für nicht-kommerziellen Use
  ✅ Zoom-Levels höher als RainViewer
  
Strategie:
  → Wo nationale Quelle existiert + free → die nutzen
  → Sonst → globaler Fallback
  → Resultat: bessere Daten + weniger Free-Tier-Verbrauch
```

---

## 3. Provider-Detail-Profile

### 3.1 DWD GeoServer (Empfohlen für Deutschland)

```
URL:           https://maps.dwd.de/geoserver/dwd/wms
Format:        WMS (OGC-Standard, nicht XYZ-Tiles)
Lizenz:        Creative Commons BY 4.0 (Attribution erforderlich)
Verfügbarkeit: 98% (Production + Backup-Cluster)
API-Key:       Nicht erforderlich
Rate-Limit:    Keine offizielle Begrenzung
Coverage:      Deutschland + Anrainer-Staaten

Verfügbare Layer (Auswahl):
  - Radar Composite mit Vorhersage (WN)
  - Niederschlag aktuell + nowcast
  - Unwetter-Warnungen
  - Pollen-Index
  - Satellit-Bilder
  - Wind, Temperatur, Druck

Vorteile:
  ✅ Original-Daten (DWD ist die Quelle die andere aggregieren)
  ✅ Höchste Genauigkeit für Deutschland
  ✅ Real-Time (5-15 Min Lag)
  ✅ Kostenlos und unbegrenzt
  ✅ Officiell unterstützter staatlicher Service
  
Nachteile:
  ⚠️ WMS statt XYZ → Adapter im Code nötig
  ⚠️ "Kein Anspruch auf Verfügbarkeit" rechtlich
  ⚠️ Nur Deutschland-Region
  ⚠️ Pflicht-Attribution: "© Deutscher Wetterdienst"
```

### 3.2 NOAA NWS MRMS (Empfohlen für USA)

```
URL:           https://mapservices.weather.noaa.gov/...
Format:        XYZ-kompatible Tiles
Lizenz:        Public Domain (US-Regierung)
Verfügbarkeit: Sehr hoch (Government-Service)
API-Key:       Nicht erforderlich
Rate-Limit:    Keine offizielle Begrenzung (faire Nutzung)
Coverage:      USA + Territorien

Vorteile:
  ✅ MRMS = native 1km Auflösung (Multi-Radar Multi-Sensor)
  ✅ Real-Time (5-10 Min Lag)
  ✅ Free + Public Domain
  ✅ Gleiche Quelle die FAA nutzt
  
Nachteile:
  ⚠️ Nur USA
  ⚠️ Experimentelles Service-Tier (laut NOAA)
  ⚠️ Englisch-only Labels
```

### 3.3 Rainbow Weather (Empfohlen als globaler Premium-Fallback)

```
URL:           https://api.rainbow.ai/...
Format:        XYZ-Tiles
Lizenz:        Kommerziell mit Free-Tier
Verfügbarkeit: SLA bei Paid-Tier
API-Key:       Erforderlich (Kreditkarte für Account)
Rate-Limit:    30k Tiles/Monat free, danach $0.20/1k
Coverage:      Weltweit

Vorteile:
  ✅ Best-in-class globale Coverage
  ✅ Real-Time Nowcast (besser als RainViewer historisch)
  ✅ Mapbox GL JS Plugin direkt verfügbar
  ✅ Custom Color-Schemes möglich
  ✅ 30k/Monat free reicht für mittlere VAMs
  
Nachteile:
  ⚠️ Kreditkarte für Account-Setup nötig
  ⚠️ Kosten-Risiko bei Über-Verbrauch (überwachen!)
  ⚠️ Relativ junges Service (gegründet 2024)
```

### 3.4 OpenWeatherMap (Empfohlen als Notfall-Fallback)

```
URL:           https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png
Format:        XYZ-Tiles
Lizenz:        Free Tier mit Attribution
Verfügbarkeit: Hoch (etabliertes Service)
API-Key:       Erforderlich (kostenlos, ohne KK)
Rate-Limit:    1k Calls/Tag (60 Calls/Min) im Free-Tier
Coverage:      Weltweit
Update-Lag:    3 Stunden (Free) / 10 Min (Paid)

Vorteile:
  ✅ Free-Tier komplett ohne KK
  ✅ De-facto-Standard für Hobby-Projekte
  ✅ Mehrere Layer-Optionen (Wind, Temp, Pressure, Clouds)
  ✅ Stabiles Service seit Jahren
  
Nachteile:
  ⚠️ 3h Update-Lag im Free-Tier ist für Live-Wetter zu langsam
  ⚠️ Free Quality < RainViewer im Free
  ⚠️ Pro-Tier wäre $40/Monat
```

### 3.5 RainViewer (Status-Quo, als globaler Last-Resort behalten)

```
URL:           https://tilecache.rainviewer.com/v2/radar/...
Format:        XYZ-Tiles
Lizenz:        Free für Personal Use
Verfügbarkeit: Reduziert seit 2025 (limited operation)
API-Key:       Nicht erforderlich
Rate-Limit:    Keine offizielle Begrenzung
Coverage:      Weltweit
Max Zoom:      7  ⚠️ DAS HAUPTPROBLEM

Vorteile:
  ✅ Komplett free
  ✅ Kein API-Key
  ✅ Aktuelles VAM-Setup
  
Nachteile:
  ❌ Zoom-Limit 7 (Grid-Pattern beim Reinzoomen)
  ⚠️ Service-Future ungewiss seit 2025
  ⚠️ Niedrigere Daten-Qualität als nationale Provider
```

---

## 4. Architektur — Multi-Provider mit Geo-Awareness

### 4.1 Konzeptioneller Daten-Fluss

```
┌─────────────────────────────────────────────────────────────────┐
│  USER REQUEST: GET /api/weather/tile/{z}/{x}/{y}                │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────┐
                │  CACHE-LOOKUP                     │
                │  (Tile bereits gecached?)         │
                └──────────────────────────────────┘
                       │                   │
                  ✅ Hit             ❌ Miss
                       │                   │
                       │                   ▼
                       │   ┌───────────────────────────────┐
                       │   │  TILE-COORDS → BOUNDING-BOX   │
                       │   │  (Wo auf der Welt liegt das?) │
                       │   └───────────────────────────────┘
                       │                   │
                       │                   ▼
                       │   ┌───────────────────────────────┐
                       │   │  PROVIDER-SELECTION-LOGIC     │
                       │   │  1. National-Provider?        │
                       │   │     ✅ Deutschland → DWD       │
                       │   │     ✅ USA         → NOAA      │
                       │   │  2. Globaler Fallback         │
                       │   │     - Limit-Check pro Provider│
                       │   │     - Priority-Order          │
                       │   └───────────────────────────────┘
                       │                   │
                       │                   ▼
                       │   ┌───────────────────────────────┐
                       │   │  PROVIDER-REQUEST             │
                       │   │  (DWD WMS / Rainbow XYZ / ...)│
                       │   └───────────────────────────────┘
                       │                   │
                       │                   ▼
                       │   ┌───────────────────────────────┐
                       │   │  COUNTER ERHÖHEN               │
                       │   │  (Falls Provider mit Limit)   │
                       │   └───────────────────────────────┘
                       │                   │
                       │                   ▼
                       │   ┌───────────────────────────────┐
                       │   │  TILE CACHEN                   │
                       │   │  (Browser + Server-Side)       │
                       │   └───────────────────────────────┘
                       │                   │
                       └──────►  RESPONSE  ◄─┘
                                 │
                                 ▼
                ┌──────────────────────────────────┐
                │  TILE PNG + Headers:              │
                │  - Cache-Control: max-age=600     │
                │  - X-Weather-Provider: dwd        │
                │  - X-Provider-Tier: 1 (national)  │
                └──────────────────────────────────┘
```

### 4.2 Provider-Selection-Pseudo-Code

```typescript
async function selectProvider(bbox: BBox): Promise<WeatherProvider> {
  // PHASE 1: Check für National-Provider (immer bevorzugt)
  for (const region of NATIONAL_REGIONS) {
    if (bboxIntersects(bbox, region.bbox)) {
      const provider = getProviderById(region.preferredProvider);
      if (await isProviderHealthy(provider)) {
        return provider;  // z.B. DWD für Deutschland
      }
    }
  }
  
  // PHASE 2: Globale Provider nach Priority + Free-Tier
  const globalProviders = getGlobalProviders().sort(byPriority);
  
  for (const provider of globalProviders) {
    // Skip wenn unhealthy
    if (!await isProviderHealthy(provider)) continue;
    
    // Skip wenn Limit erreicht
    if (provider.monthlyLimit !== null) {
      const usage = await getMonthlyUsage(provider.id);
      const utilizationPercent = (usage / provider.monthlyLimit) * 100;
      
      // Smart-Switch bei 95% (Buffer für letzte Requests in Flight)
      if (utilizationPercent >= 95) continue;
    }
    
    return provider;  // Erster verfügbarer
  }
  
  // PHASE 3: Last-Resort (RainViewer, immer verfügbar)
  return getProviderById('rainviewer');
}
```

### 4.3 Geo-Awareness-Region-Definitionen

```typescript
const NATIONAL_REGIONS: RegionConfig[] = [
  {
    id: 'germany',
    name: 'Deutschland',
    bbox: [5.87, 47.27, 15.03, 55.04],
    preferredProvider: 'dwd',
  },
  {
    id: 'usa-continental',
    name: 'United States (Continental)',
    bbox: [-125.0, 24.5, -66.9, 49.4],
    preferredProvider: 'noaa-nws',
  },
  {
    id: 'canada',
    name: 'Canada',
    bbox: [-141.0, 41.7, -52.6, 83.1],
    preferredProvider: 'msc-geomet',
  },
  {
    id: 'uk',
    name: 'United Kingdom',
    bbox: [-8.6, 49.9, 1.8, 60.9],
    preferredProvider: 'metoffice',
  },
  // Weitere Regionen schrittweise hinzufügbar
];
```

### 4.4 Tile-Coords → BBox-Konvertierung

```typescript
// Standard Web-Mercator Tile-Math
function tileToBBox(x: number, y: number, z: number): BBox {
  const n = Math.pow(2, z);
  const lonLeft = (x / n) * 360 - 180;
  const lonRight = ((x + 1) / n) * 360 - 180;
  const latTop = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const latBottom = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
  
  return [lonLeft, latBottom, lonRight, latTop];
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}
```

---

## 5. ACARS-Coupling (Premium-Feature)

### 5.1 Konzept

Wenn ein Pilot via ACARS-Client verbunden ist, weiß das System die **exakte Live-Position**. Diese kann für **proaktive Provider-Optimierung** genutzt werden.

```
SZENARIO: Pilot fliegt EDDF (Frankfurt) → LOWW (Wien)

PHASE 1 — Über Deutschland:
  ACARS-Position: 50.05°N, 8.57°E
  → Geo-Lookup: liegt in Deutschland-Region
  → Provider: DWD (höchste Qualität, kein Free-Tier-Verbrauch)

PHASE 2 — Über Tschechien/Österreich:
  ACARS-Position: 48.5°N, 14.2°E
  → Geo-Lookup: außerhalb National-Regionen
  → Provider: Rainbow Weather (globaler Premium-Fallback)

PHASE 3 — Approach LOWW:
  ACARS-Position: 48.11°N, 16.57°E
  → Geo-Lookup: noch außerhalb (Österreich Open-Data komplex)
  → Provider: bleibt Rainbow Weather

Übergang ist transparent — User sieht nur "Wetter funktioniert immer".
```

### 5.2 User-Position-aware Tile-Requests

Wenn ACARS-User eingeloggt ist, **kann der Selector die User-Position priorisieren**:

```typescript
async function selectProviderForUser(
  userId: string | null,
  tileBbox: BBox,
): Promise<WeatherProvider> {
  
  // Wenn ACARS-User: nutze User-Position für Geo-Awareness
  if (userId) {
    const acarsSession = await getActiveAcarsSession(userId);
    if (acarsSession) {
      const userBbox = positionToBbox(
        acarsSession.latitude,
        acarsSession.longitude,
        50  // 50km Umkreis
      );
      
      // Wenn Tile im Umkreis des Users → User-Position-Provider bevorzugen
      if (bboxIntersects(tileBbox, userBbox)) {
        const userProvider = await selectProvider(userBbox);
        return userProvider;
      }
    }
  }
  
  // Sonst: Standard-Selection nach Tile-Position
  return selectProvider(tileBbox);
}
```

### 5.3 Pre-Caching basierend auf Flight-Plan

Mit ACARS kennen wir den Flight-Plan (Departure → Arrival). **Wir können vorhersagen wo der User in den nächsten 30 Min sein wird**:

```typescript
// Pre-Cache-Worker (background job)
async function preCacheForActiveFlights() {
  const flights = await prisma.liveSession.findMany({
    where: { isActive: true, dataSource: 'ACARS_CLIENT' },
  });
  
  for (const flight of flights) {
    // Berechne Position in 15 Min basierend auf Heading + GroundSpeed
    const futurePosition = projectPosition(
      flight.latitude,
      flight.longitude,
      flight.heading,
      flight.groundSpeed,
      15  // Minuten
    );
    
    // Pre-fetch Tiles für diese Region (12 Tiles in 4 Zoom-Levels)
    const tilesToFetch = computeTilesAroundPosition(futurePosition, 6, 9);
    
    await Promise.all(tilesToFetch.map(tile => 
      preFetchTile(tile.z, tile.x, tile.y)
    ));
  }
}
```

**Effekt:**
- User merkt **null Lag** beim Reinzoomen auf seine Position
- Tiles sind bereits im Cache wenn User dort hinscrollt
- Rainbow-Weather-Limit-Verbrauch ist optimiert

---

## 6. Caching-Strategie

### 6.1 Multi-Layer-Caching

```
LAYER 1: Browser Cache
  - HTTP Cache-Control: max-age=600 (10 Min)
  - User scrollt rückwärts → keine Server-Requests
  - 0% Server-Last für gleiche Tiles im 10-Min-Window

LAYER 2: Cloudflare Tunnel Edge-Cache
  - Wenn Cloudflare-CDN aktiviert
  - Edge-Tiles werden pro Region gecached
  - Multi-User-Effekt: 50 User in Frankfurt = 1 Provider-Request

LAYER 3: Server-Side Memory Cache (LRU)
  - Recently-requested Tiles in RAM
  - 1000 Tiles à 50KB = 50MB RAM
  - Hit-Rate ~90% bei normaler Nutzung

LAYER 4: Server-Side DB Cache (optional)
  - Persistente Tiles in PostgreSQL
  - Für Tiles die >10 Min relevant bleiben (z.B. DWD bei wenig Wetter)
  - Cleanup-Cron: Tiles älter 1h löschen
```

### 6.2 Cache-Effekt-Berechnung

```
SCENARIO: 100 aktive User, Standard-Browse-Pattern

OHNE CACHE:
  - 100 Users × 200 Tiles/Session × 30 Tage = 600.000 Requests/Monat
  - Alle Provider erschöpft bis Tag 5
  
MIT BROWSER-CACHE (10min):
  - Reduktion ~70% (gleiche Tiles im Window)
  - = 180.000 Requests/Monat
  - Rainbow-Limit immer noch erreicht bis Tag 18

MIT BROWSER + CLOUDFLARE-CACHE:
  - Reduktion ~85%
  - = 90.000 Requests/Monat
  - Rainbow-Limit erreicht bis Tag 25

MIT ALLEN 4 LAYERN:
  - Reduktion ~95%
  - = 30.000 Requests/Monat
  - Bleibt im Free-Tier!
```

### 6.3 Cache-Invalidation

```
RAINVIEWER:    Frame-Refresh alle 5 Min → Cache 5 Min
DWD:           Update alle 5-15 Min → Cache 5 Min
RAINBOW:       Real-time → Cache 2-3 Min
OWM (Free):    3h Lag → Cache 30 Min OK (Daten ändern sich kaum)
NOAA:          Update alle 5-10 Min → Cache 5 Min
```

---

## 7. Database-Schema

### 7.1 Neue Tabellen

```prisma
model WeatherProvider {
  id              String   @id  // 'dwd', 'rainbow', 'rainviewer', etc.
  name            String
  enabled         Boolean  @default(true)
  
  // Limit-Konfiguration
  monthlyLimit    Int?     // null = unbegrenzt
  warnThreshold   Int?     // z.B. 25000 für Discord-Notification
  hardCutoff      Int?     // z.B. 28000 (vor 30k Free-Tier-Limit)
  
  // Health-Tracking
  healthStatus    String   @default("ok")  // 'ok', 'degraded', 'down'
  lastHealthCheck DateTime?
  consecutiveErrors Int    @default(0)
  
  // Metadata
  apiType         String   // 'xyz', 'wms'
  baseUrl         String
  priority        Int      // 1 = höchste
  
  usages          WeatherUsage[]
  
  @@index([enabled, priority])
}

model WeatherUsage {
  id              String   @id @default(cuid())
  providerId      String
  provider        WeatherProvider @relation(fields: [providerId], references: [id])
  
  yearMonth       String   // "2026-04" für monatliche Aggregation
  count           Int      @default(0)
  lastReset       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@unique([providerId, yearMonth])
  @@index([yearMonth])
}

model WeatherTileCache {
  id              String   @id @default(cuid())
  cacheKey        String   @unique  // "provider-yearmonth-z-x-y"
  
  providerId      String
  z               Int
  x               Int
  y               Int
  
  data            Bytes    // PNG-Binary
  contentType     String   @default("image/png")
  
  expiresAt       DateTime
  createdAt       DateTime @default(now())
  hitCount        Int      @default(0)
  
  @@index([cacheKey])
  @@index([expiresAt])  // für Cleanup-Cron
}

model WeatherProviderHealthLog {
  id              String   @id @default(cuid())
  providerId      String
  
  timestamp       DateTime @default(now())
  status          String   // 'ok', 'degraded', 'down'
  responseTimeMs  Int?
  errorMessage    String?
  
  @@index([providerId, timestamp])
}
```

### 7.2 Initial-Daten (Seed)

```typescript
const PROVIDERS_SEED = [
  {
    id: 'dwd',
    name: 'Deutscher Wetterdienst',
    apiType: 'wms',
    baseUrl: 'https://maps.dwd.de/geoserver/dwd/wms',
    priority: 1,  // National = höchste Priorität in Deutschland
    monthlyLimit: null,
  },
  {
    id: 'noaa-nws',
    name: 'NOAA National Weather Service',
    apiType: 'xyz',
    baseUrl: 'https://mapservices.weather.noaa.gov/...',
    priority: 1,
    monthlyLimit: null,
  },
  {
    id: 'rainbow',
    name: 'Rainbow Weather',
    apiType: 'xyz',
    baseUrl: 'https://api.rainbow.ai/tiles',
    priority: 2,  // Globaler Premium-Fallback
    monthlyLimit: 28000,
    warnThreshold: 25000,
    hardCutoff: 28000,
  },
  {
    id: 'openweather',
    name: 'OpenWeatherMap',
    apiType: 'xyz',
    baseUrl: 'https://tile.openweathermap.org/map',
    priority: 3,  // Notfall-Fallback
    monthlyLimit: 25000,
    warnThreshold: 22000,
    hardCutoff: 25000,
  },
  {
    id: 'rainviewer',
    name: 'RainViewer',
    apiType: 'xyz',
    baseUrl: 'https://tilecache.rainviewer.com',
    priority: 4,  // Last-Resort, immer verfügbar
    monthlyLimit: null,
  },
];
```

---

## 8. API-Endpoints

### 8.1 Tile-Proxy-Endpoint

```typescript
// GET /api/weather/tile/[z]/[x]/[y]
// Returns: PNG image with provider headers

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;
  const tileCoords = { z: parseInt(z), x: parseInt(x), y: parseInt(y) };
  
  // 1. Cache-Lookup
  const cached = await getCachedTile(tileCoords);
  if (cached && cached.expiresAt > new Date()) {
    return tileResponse(cached.data, cached.providerId, true);
  }
  
  // 2. BBox berechnen
  const bbox = tileToBBox(tileCoords.x, tileCoords.y, tileCoords.z);
  
  // 3. Optional: User-Position für ACARS-User
  const session = await auth();
  const userId = session?.user?.id;
  
  // 4. Provider wählen
  const provider = await selectProviderForUser(userId, bbox);
  
  // 5. Provider-Request
  const tileData = await fetchTileFromProvider(provider, tileCoords, bbox);
  
  // 6. Counter erhöhen
  if (provider.monthlyLimit !== null) {
    await incrementProviderUsage(provider.id);
  }
  
  // 7. Cachen
  await cacheTile({
    providerId: provider.id,
    ...tileCoords,
    data: tileData,
    expiresAt: new Date(Date.now() + provider.cacheTtlMs),
  });
  
  return tileResponse(tileData, provider.id, false);
}

function tileResponse(data: Buffer, providerId: string, fromCache: boolean) {
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=600',
      'X-Weather-Provider': providerId,
      'X-Cache': fromCache ? 'HIT' : 'MISS',
    },
  });
}
```

### 8.2 Status-Endpoint

```typescript
// GET /api/weather/status
// Returns: Provider-Status für UI

export async function GET() {
  const yearMonth = currentYearMonth();
  const providers = await prisma.weatherProvider.findMany({
    where: { enabled: true },
    include: {
      usages: { where: { yearMonth } },
    },
    orderBy: { priority: 'asc' },
  });
  
  return NextResponse.json({
    providers: providers.map(p => ({
      id: p.id,
      name: p.name,
      tier: p.priority,
      health: p.healthStatus,
      usage: {
        used: p.usages[0]?.count ?? 0,
        limit: p.monthlyLimit,
        percentage: p.monthlyLimit 
          ? Math.round(((p.usages[0]?.count ?? 0) / p.monthlyLimit) * 100)
          : null,
      },
    })),
    activeProvider: getCurrentlyActiveProvider(),
    resetAt: nextMonthStart(),
  });
}
```

### 8.3 Admin-Endpoints

```typescript
// POST /api/admin/weather/provider/{id}/disable
// Admin kann Provider manuell deaktivieren

// POST /api/admin/weather/provider/{id}/enable  
// Wieder aktivieren

// POST /api/admin/weather/provider/{id}/reset-counter
// Notfall-Reset (z.B. wenn Provider Limit-Logik ändert)

// GET /api/admin/weather/usage-history?days=30
// Historie für Dashboard
```

---

## 9. Frontend-Integration

### 9.1 Live-Map-Anpassung

```tsx
// live-map.tsx — Wetter-Layer mit Proxy

{filters.weatherRadar && (
  <Source 
    id="weather" 
    type="raster" 
    tiles={['/api/weather/tile/{z}/{x}/{y}']}  // ← Eigener Proxy
    tileSize={256}
    maxzoom={11}  // Höher als RainViewer-only weil DWD bis 10 geht
  >
    <Layer 
      id="weather-layer"
      type="raster"
      maxzoom={12}
      paint={{ 
        'raster-opacity': [
          'interpolate', ['linear'], ['zoom'],
          5, 0.7,
          10, 0.5,
          12, 0,
        ],
      }}
    />
  </Source>
)}
```

### 9.2 Provider-Status-Indicator

```tsx
function WeatherStatusBadge() {
  const [status, setStatus] = useState<WeatherStatus | null>(null);
  
  useEffect(() => {
    if (!filters.weatherRadar) return;
    
    fetch('/api/weather/status')
      .then(r => r.json())
      .then(setStatus);
    
    const interval = setInterval(() => {
      fetch('/api/weather/status').then(r => r.json()).then(setStatus);
    }, 60_000);  // Status-Check alle 1 Min
    
    return () => clearInterval(interval);
  }, [filters.weatherRadar]);
  
  if (!status) return null;
  
  const tier = status.activeProvider.tier;
  const tierColor = tier === 1 ? 'text-emerald-400' : 
                    tier === 2 ? 'text-blue-400' : 
                    'text-amber-400';
  
  return (
    <div className="absolute bottom-12 right-4 bg-gray-900/80 px-3 py-1.5 rounded text-xs">
      <span className={tierColor}>●</span>{' '}
      Wetter via <strong>{status.activeProvider.name}</strong>
      {status.activeProvider.tier > 2 && (
        <span className="text-amber-400 ml-2">⚠ Fallback</span>
      )}
    </div>
  );
}
```

### 9.3 Settings-Page für Admin

```tsx
// /settings/admin/weather

function WeatherProvidersAdmin() {
  return (
    <div className="space-y-4">
      <h2>Weather-Provider-Status</h2>
      
      {providers.map(p => (
        <div key={p.id} className="bg-gray-900 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">{p.name}</h3>
              <p className="text-sm text-gray-400">Priority: {p.tier}</p>
            </div>
            <HealthBadge status={p.health} />
          </div>
          
          {p.usage.limit && (
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1">
                <span>{p.usage.used.toLocaleString()} / {p.usage.limit.toLocaleString()}</span>
                <span>{p.usage.percentage}%</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${
                    p.usage.percentage > 90 ? 'bg-red-500' :
                    p.usage.percentage > 75 ? 'bg-amber-500' :
                    'bg-emerald-500'
                  }`}
                  style={{ width: `${p.usage.percentage}%` }}
                />
              </div>
            </div>
          )}
          
          <div className="mt-3 flex gap-2">
            <button onClick={() => toggleProvider(p.id)}>
              {p.enabled ? 'Disable' : 'Enable'}
            </button>
            <button onClick={() => resetCounter(p.id)}>
              Reset Counter
            </button>
          </div>
        </div>
      ))}
      
      <DiscordWebhookConfig />
    </div>
  );
}
```

---

## 10. Monitoring & Alerts

### 10.1 Discord-Notifications

```typescript
// Wenn Provider 90% Limit erreicht
async function checkAndAlertProviderUsage() {
  const providers = await prisma.weatherProvider.findMany({
    where: { enabled: true, monthlyLimit: { not: null } },
    include: { usages: { where: { yearMonth: currentYearMonth() } } },
  });
  
  for (const provider of providers) {
    const usage = provider.usages[0]?.count ?? 0;
    const percentage = (usage / provider.monthlyLimit!) * 100;
    
    if (percentage >= 90 && !await alreadyAlerted(provider.id, '90%')) {
      await sendDiscordAlert({
        title: `⚠️ Weather-Provider bei 90% Limit`,
        description: `${provider.name}: ${usage}/${provider.monthlyLimit} (${percentage.toFixed(1)}%)`,
        severity: 'warning',
      });
      await markAlerted(provider.id, '90%');
    }
    
    if (percentage >= 100 && !await alreadyAlerted(provider.id, '100%')) {
      await sendDiscordAlert({
        title: `🚨 Weather-Provider EXHAUSTED`,
        description: `${provider.name} hat Monats-Limit erreicht. Failover aktiv.`,
        severity: 'error',
      });
      await markAlerted(provider.id, '100%');
    }
  }
}

// Cron-Job alle 15 Min
```

### 10.2 Health-Checks

```typescript
// Alle 5 Min: Provider-Health prüfen
async function healthCheckProviders() {
  const providers = await prisma.weatherProvider.findMany({ where: { enabled: true } });
  
  for (const provider of providers) {
    const start = Date.now();
    try {
      // Test-Request: Standard-Tile (z.B. Frankfurt bei Zoom 5)
      const testTile = await fetchTileFromProvider(provider, { z: 5, x: 16, y: 10 });
      const responseTime = Date.now() - start;
      
      await updateProviderHealth(provider.id, 'ok', responseTime);
      
    } catch (err) {
      await updateProviderHealth(provider.id, 'down', null, err.message);
      
      // Alert bei 3 consecutive errors
      if (provider.consecutiveErrors >= 3) {
        await sendDiscordAlert({
          title: `🔴 Provider DOWN: ${provider.name}`,
          description: `Letzter Fehler: ${err.message}`,
          severity: 'error',
        });
      }
    }
  }
}
```

### 10.3 Admin-Dashboard-Metrics

```
KPIs für Admin-Dashboard:
  - Aktueller Active-Provider pro Region
  - Monatliche Usage pro Provider (Bar-Chart)
  - Cache-Hit-Rate (% gecacht vs. Live-Request)
  - Average-Response-Time pro Provider
  - Healthcheck-Failures (letzten 24h)
  - Tile-Requests pro Stunde (Time-Series)
  - Top-Regions nach Tile-Requests (Heatmap)
```

---

## 11. Implementation-Phasen

### Phase 0: Quick-Fix (5 Min, JETZT)

```
Ziel: Aktuelles Grid-Pattern-Issue beheben

- [ ] live-map.tsx: maxzoom={7} auf RainViewer-Source
- [ ] live-map.tsx: maxzoom={11} auf Layer  
- [ ] live-map.tsx: smooth opacity fade-out (interpolate expression)
- [ ] Test: 30km Maßstab kein Grid mehr
- [ ] Commit + Push
```

### Phase 1: Server-Proxy-Foundation (2-3h)

```
Ziel: Eigener Proxy-Endpoint, RainViewer durchschleifen

- [ ] DB-Schema: WeatherProvider, WeatherUsage, WeatherTileCache
- [ ] Migration
- [ ] Seed-Data: RainViewer als einziger Provider initial
- [ ] API-Route: GET /api/weather/tile/[z]/[x]/[y]
- [ ] Tile-Caching (Server-side memory + DB)
- [ ] live-map.tsx: tiles=['/api/weather/tile/...'] statt direkter URL
- [ ] Test: alles funktioniert weiterhin via Proxy
- [ ] Commit
```

### Phase 2: Limit-Tracking (1-2h)

```
Ziel: Counter-System für Free-Tier-Provider

- [ ] Counter-Increment-Logic in API-Route
- [ ] Status-Endpoint: GET /api/weather/status
- [ ] Frontend: WeatherStatusBadge Component
- [ ] Settings-UI: User sieht Provider-Status
- [ ] Test: Counter erhöht sich korrekt
- [ ] Commit
```

### Phase 3: Multi-Provider mit Fallback (2-3h)

```
Ziel: OpenWeatherMap als Fallback dazu schalten

- [ ] OWM-Account anlegen, API-Key in .env
- [ ] OWM zu PROVIDERS_SEED hinzufügen
- [ ] Provider-Selector-Logic implementieren
- [ ] Fallback-Cascade testen (Limit-Override für Test)
- [ ] Provider-Indicator im Frontend zeigt aktuellen Provider
- [ ] Test: simulierter RainViewer-Outage → OWM übernimmt
- [ ] Commit
```

### Phase 4: Geo-Awareness mit DWD (3-4h)

```
Ziel: DWD-Integration für Deutschland-Region

- [ ] DWD-WMS-Adapter (WMS → Tile-Konvertierung)
- [ ] Region-Definitionen (NATIONAL_REGIONS)
- [ ] Tile-zu-BBox Mathematik
- [ ] Geo-aware Selector-Logic
- [ ] DWD zu PROVIDERS_SEED
- [ ] Test: Tiles über Frankfurt → DWD; Tiles über Wien → Rainbow
- [ ] Test: Visueller Übergang ist sauber
- [ ] DWD-Attribution im Frontend ("© DWD")
- [ ] Commit
```

### Phase 5: Premium-Provider Rainbow Weather (2h)

```
Ziel: Rainbow Weather als globaler Premium-Fallback

- [ ] Rainbow-Account anlegen (KK nötig)
- [ ] API-Key in .env
- [ ] Rainbow zu PROVIDERS_SEED
- [ ] Provider-Priorität anpassen
- [ ] Free-Tier-Limit auf 28k konfigurieren (mit Buffer)
- [ ] Test: Rainbow als globaler Default außerhalb Deutschland
- [ ] Commit
```

### Phase 6: Caching-Optimierung (1-2h)

```
Ziel: Cache-Hit-Rate maximieren

- [ ] Server-Side LRU Memory-Cache (1000 Tiles à 50KB)
- [ ] DB-Cache mit TTL pro Provider
- [ ] Cleanup-Cron: Tiles älter 1h löschen
- [ ] Cache-Stats im Status-Endpoint
- [ ] Test: 90%+ Hit-Rate bei normaler Nutzung
- [ ] Commit
```

### Phase 7: Monitoring + Alerts (1-2h)

```
Ziel: Admin sieht Probleme bevor User sie merkt

- [ ] Health-Check-Cron (alle 5 Min)
- [ ] Discord-Webhook-Integration
- [ ] Alert-Logic: 90%, 100%, Provider-Down
- [ ] Admin-Dashboard für Provider-Status
- [ ] Manual-Override-Buttons (Disable/Enable/Reset)
- [ ] Commit
```

### Phase 8: ACARS-Coupling (1-2h, NACH ACARS-Implementation)

```
Ziel: User-Position-aware Provider-Selection

- [ ] selectProviderForUser() Logic
- [ ] LiveSession-Position-Lookup
- [ ] Pre-Caching basierend auf Flight-Plan
- [ ] Test: ACARS-User in Deutschland → DWD bevorzugt
- [ ] Commit
```

### Phase 9: National-Provider-Erweiterung (variable)

```
Ziel: Weitere Länder mit Premium-Quellen abdecken

- [ ] NOAA NWS für USA
- [ ] MSC GeoMet für Kanada
- [ ] KNMI für Niederlande
- [ ] (Optional) Met Office UK, Météo-France, etc.
- [ ] Pro Land: Account + API-Verbindung + Region-Definition

Aufwand: ~1-2h pro Land
```

**Total:** ~15-22h für vollständiges System (Phasen 1-9)

---

## 12. Edge-Cases & Fallback-Strategien

### 12.1 Was wenn alle Provider down sind?

```
Szenario: RainViewer + OWM + Rainbow + DWD alle down
Reaktion:
  - Status-Endpoint returned activeProvider: null
  - Frontend zeigt: "🌧 Wetter aktuell nicht verfügbar"
  - Map ohne Wetter-Layer (alles andere funktioniert)
  - Discord-Alert an Admin
  - Auto-Retry alle 5 Min
```

### 12.2 Was wenn DWD-Server während Flight ausfällt?

```
Szenario: Pilot fliegt über Deutschland, DWD wird mid-flight unhealthy
Reaktion:
  - Health-Check detected: DWD = 'down'
  - Selector-Logic: skip DWD, fallback zu Rainbow
  - User sieht: kurzer Wechsel zu Rainbow-Tiles (anderes Color-Scheme)
  - Frontend zeigt: "Wetter via Rainbow Weather (Fallback)"
  - Bei DWD-Recovery: Auto-Switch zurück
```

### 12.3 Was wenn Rainbow-Limit unerwartet schnell erreicht?

```
Szenario: Bot/Spam fragt 30k Requests in 1 Tag (DDoS oder Bug)
Reaktion:
  - Rate-Limit pro IP: max 1000 Requests/Stunde
  - Rate-Limit pro User: max 500 Requests/Stunde  
  - Bei Anomalie: Discord-Alert + Auto-Disable für IP
  - Rainbow erreicht 100% früher → Fallback zu OWM
  - User merkt: "Wetter via OpenWeatherMap" Indicator
```

### 12.4 Was wenn nationale Quelle veraltete Daten liefert?

```
Szenario: DWD liefert Tiles, aber Daten sind 2h alt (Cache-Bug)
Reaktion:
  - Health-Check fragt zusätzlich Last-Modified-Header
  - Wenn > 30 Min alt → mark provider 'degraded'
  - Selector skipt 'degraded' Provider
  - Recovery wenn Daten wieder frisch
```

### 12.5 Provider ändert API-Format

```
Szenario: Rainbow ändert Tile-URL-Schema
Reaktion:
  - Health-Check schlägt fehl (404/500)
  - Provider auto-disabled nach 3 consecutive errors
  - Discord-Alert mit Stack-Trace
  - Admin: muss baseUrl in DB anpassen
  - Schnelles Fix-Deployment möglich (kein Code-Change wenn baseUrl konfigurierbar)
```

---

## 13. Kosten-Analyse

### 13.1 Setup-Kosten (einmalig)

```
Rainbow Weather Account:        $0 (Free-Tier)
                                Aber Kreditkarte für Account erforderlich
                                
OpenWeatherMap Account:         $0 (Free-Tier ohne KK)

DWD GeoServer:                  $0 (komplett kostenlos)

NOAA NWS:                       $0 (Public Domain)

Eigener Server-Tunnel:          $0 (Cloudflare Tunnel free)

Implementation-Zeit:            ~15-22h Solo-Arbeit
                                Bei externer Entwicklung: 2-3 Tage
```

### 13.2 Laufende Kosten (monatlich)

```
SCENARIO A: VAM-Klein (10 aktive User)
  - ~5.000 Requests/Monat
  - Fast alle via Cache
  - Free-Tier reicht 100% locker
  → Kosten: 0 EUR

SCENARIO B: VAM-Mittel (50 aktive User)
  - ~25.000 Requests/Monat
  - Mit Cache reduziert auf ~5.000
  - Free-Tier reicht
  → Kosten: 0 EUR

SCENARIO C: VAM-Groß (200 aktive User, 30% Deutschland)
  - 70% global + 30% DWD = 70% Free-Tier-Verbrauch
  - ~70.000 Requests global/Monat
  - Mit Cache: ~15.000 effektiv
  - Free-Tier reicht für Rainbow
  → Kosten: 0 EUR

SCENARIO D: VAM-Sehr-Groß (1000 aktive User)
  - Free-Tier-Verbrauch nicht mehr ausreichend
  - Rainbow-Pro: $0.20 pro 1k Tiles ab 30k
  - 200k Requests = $34/Monat
  → Kosten: ~30-50 EUR/Monat
  
  ALTERNATIVE: Mehr Caching, längere TTLs
  - Bei aggressivem Caching: 50% weniger Requests
  - Kosten halbiert
```

### 13.3 ROI-Betrachtung

```
Implementation:    15-22h Solo-Arbeit
Monatliche Kosten: 0 EUR (in 95% der VAM-Größen)
Wert für User:     ✅ Wetter funktioniert immer
                   ✅ Beste Qualität verfügbar
                   ✅ Keine "Grid-Pattern"-Frustration
                   ✅ Geo-optimiert (DWD für Deutschland-Pilots)
                   
Fazit: hohe einmalige Investment, dann läuft es Jahre kostenlos
```

---

## 14. Risiken & Mitigations

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|
| RainViewer ändert Service erneut | Mittel | Niedrig | DWD/Rainbow als Fallback bereits da |
| Rainbow Weather erhöht Preise | Mittel | Mittel | Multiple Provider, kein Lock-In |
| DWD-API-Format ändert sich | Niedrig | Mittel | Adapter isoliert, Fix wäre lokal |
| Server-Bandbreite-Kosten | Niedrig | Niedrig | Cloudflare Tunnel free, Tile-Größe klein |
| Caching-Bug verursacht stale Daten | Mittel | Niedrig | Kurze TTLs, easy invalidation |
| Provider-Account wird gesperrt | Niedrig | Mittel | Multiple Fallbacks |
| API-Key leakt im Frontend | Niedrig | Hoch | Server-Proxy verhindert das |
| Implementation zieht sich hin | Hoch | Niedrig | Phasen klar abgegrenzt, jede ist nutzbar |

---

## 15. Integration mit anderen VAM-Systemen

### 15.1 Mit ACARS

```
ACARS liefert:
  - Echtzeit-Position (1-2s)
  - Sim-Wetter (was im Sim simuliert wird)

Integration:
  - User-Position für Provider-Selection
  - Pre-Caching basierend auf Flight-Plan
  - Vergleich: Sim-Wetter vs. Real-Wetter (Pirep-Page)
```

### 15.2 Mit OBS-Overlay

```
Overlay zeigt:
  - Optional: aktuelles Wetter am Standort
  - "VFR" / "IFR" Badge basierend auf METAR

Integration:
  - Overlay-Endpoint nutzt gleichen Provider-Mechanismus
  - Server-Side rendering vermeidet Token-Exposure
```

### 15.3 Mit PIREP-Analyse

```
Pirep-Page zeigt:
  - Wetter zum Flugzeitpunkt entlang der Strecke
  - Vergleich Sim-Wetter vs. Real-Wetter

Integration:
  - Historical-Tiles (über Time-Slider)
  - DWD/NOAA archives für Deutschland/USA-Flüge
  - Rainbow Weather Forecast-API für Vorhersagen
```

### 15.4 Mit Discord-Bot

```
Bot-Integration:
  - /weather <ICAO> Command zeigt aktuelles METAR
  - Auto-Posts bei Unwetter-Warnungen (DWD)
  - Discord-Alert bei Provider-Issues (Admin)
```

---

## 16. Open Questions

- [ ] Sollen User die Provider-Wahl manuell überschreiben können?
- [ ] Wettervergleich-Feature (Sim vs. Real): wie tief integrieren?
- [ ] Historische Wetter-Daten für PIREP-Replay: welcher Provider?
- [ ] Wie lange Tiles im DB-Cache halten? (Trade-off Speicherplatz vs. Hit-Rate)
- [ ] Mobile-Optimierung: weniger/kleinere Tiles für 4G?
- [ ] Wettervorhersage-Layer (vs. nur "current"): lohnt sich der Aufwand?
- [ ] Multi-Tenant-Support: andere VAs könnten dasselbe System nutzen?
- [ ] Pro-Tier wenn Free nicht reicht: ab welchem User-Count Sinn?
- [ ] API-Rate-Limits pro VAM-User: was ist sinnvoll?
- [ ] Bei DWD-Outage: User-Notification oder still failover?

---

## 17. Conclusion

```
VISION:
  Multi-Provider-Weather-System mit Geo-Awareness und ACARS-Coupling.
  Best-in-class Daten, kostenlos im Free-Tier, transparent für User.

ARCHITEKTUR:
  - Server-Proxy mit Caching
  - Provider-Cascade: National → Premium → Free → Last-Resort
  - Geo-aware Selection (Deutschland → DWD)
  - ACARS-Position-Coupling für Premium-Optimization

IMPLEMENTATION:
  - 9 Phasen, ~15-22h Total
  - Jede Phase einzeln nutzbar
  - Phase 0 (Quick-Fix) heute
  - Phase 1-3 in nächsten 1-2 Wochen
  - Phase 4-9 nach OBS-Overlay-Komplettierung

NUTZEN:
  - User: bessere Wetter-Daten, immer verfügbar
  - Admin: kein Stress mit Provider-Limits
  - Kosten: 0 EUR in 95% der VAM-Größen
  - Future-Proof: einfach neue Provider hinzufügen
  - Differentiator: kein anderes VAM-System hat das
```

---

## Referenzen

### Primary Sources

- [DWD GeoServer](https://maps.dwd.de/geoserver/dwd/wms) — Deutscher Wetterdienst
- [DWD OpenData](https://opendata.dwd.de) — DWD-Datenarchiv
- [DWD GeoServices Doku](https://www.dwd.de/EN/ourservices/geoservices/geodienste.html)
- [NOAA NWS MapServices](https://mapservices.weather.noaa.gov/) — US National Weather Service
- [Rainbow Weather API](https://rainbow.ai) — Premium Global Weather Tiles
- [OpenWeatherMap Tile API](https://openweathermap.org/api/weathermaps) — De-facto Standard
- [RainViewer API](https://www.rainviewer.com/api/weather-maps-api.html) — Aktueller Provider

### Implementation-Referenzen

- [Mapbox GL JS Source-Spec](https://docs.mapbox.com/style-spec/reference/sources/) — Tile-Source-Config
- [Mapbox GL JS Layer-Spec](https://docs.mapbox.com/style-spec/reference/layers/) — Layer-Config
- [OGC WMS Specification](https://www.ogc.org/standards/wms) — Standard für DWD
- [Web Mercator Tile Math](https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) — Tile-Coords-Konvertierung

### Related Docs in this Repo

- [`acars-architecture.md`](./acars-architecture.md) — ACARS-Integration
- [`pirep-analysis-page.md`](./pirep-analysis-page.md) — Wettervergleich-Section
- [`simconnect-data-catalog.md`](./simconnect-data-catalog.md) — Sim-Wetter-Daten
- [`todo-obs-overlay-system.md`](./todo-obs-overlay-system.md) — OBS-Overlay-Roadmap
