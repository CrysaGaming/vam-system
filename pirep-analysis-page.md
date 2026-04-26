# PIREP-Analyse-Seite — Vision & Roadmap

> Vollständige Roadmap für die "Detail-Seite nach Flug" — was sieht der Pilot,
> wenn er auf einen abgeschlossenen PIREP klickt? Pegasus-Pegasus-Niveau, aber
> in deinem Stack mit den besten Frameworks die der Web-Stack 2026 hergibt.

**Stand:** April 2026  
**Voraussetzung:** ACARS-Client liefert Telemetrie (siehe `simconnect-data-catalog.md`)

---

## 1. Vision & User-Story

### Wie es heute aussieht

Wenn der Pilot heute auf einen seiner PIREPs klickt:
- Ein paar Zahlen in einer Tabelle (Flight-Time, Fuel, Departure, Arrival)
- Eine 2D-Map mit der Strecke (Mapbox, vorhanden)
- Comments-Bereich für Pilot-Remarks
- Approval-Status

→ Solide Basis, aber **kein Debrief-Erlebnis**.

### Wie es aussehen soll

Wenn der Pilot in 6 Monaten auf einen seiner PIREPs klickt:

> *"Du hast soeben deinen ersten Lufthansa-A320 von EDDF nach LOWW abgeschlossen.
> Block-Time: 1h 47min · Fuel-Burn: 3.2t · Top-of-Climb erreicht in 18min ·
> Landing-Rate: -245 fpm (perfekt). Stable-Approach-Score: 92/100."*

Plus eine ganze Analyse-Seite mit:

- **3D-Replay** der Strecke auf einem Globe
- **Vertical-Profile** mit Phase-Markern (TOC, TOD, FAF, Touchdown)
- **Engine-Performance** (N1/N2/Fuel-Flow über Zeit)
- **Approach-Analyse** (Glide-Slope-Deviation, Localizer-Deviation)
- **Landing-Analyse** (Touchdown-Quality, G-Force, Pitch/Bank)
- **Score-Cards** mit Sub-Scores (Approach, Landing, Smoothness, Realism)
- **Comparison**: dieser Flug vs. dein Durchschnitt vs. Airline-Durchschnitt
- **Key-Events-Timeline** (Engine-Start, Pushback, Take-Off, Gear-Up, etc.)

→ Das ist **Pirep-Detail wie Pegasus** + eigene Twists.

### Inspiration aus der Branche

| Tool | Stärke | Was wir übernehmen |
|---|---|---|
| **vAMSYS Pegasus** | Vertical Profile + Approach Charts | Charts-Konzept |
| **Volanta** | Globe-Replay + Schöne Animationen | 3D-Replay |
| **Sim Toolkit Pro** | Detailliertes Logbook | Logbook-Layout |
| **FlightAware Track Log** | Live-Daten-Heatmap | Heatmap-Idee |
| **PMDG Flight-Sim Logs** | Engine-Detail-Charts | Engine-Charts |

---

## 2. Page-Layout

### Übersicht (Wireframe)

```
┌─────────────────────────────────────────────────────────────┐
│  HERO — Flight Summary                              [PDF↓] │
│  DLH123 · A320 D-AIZA · EDDF → LOWW · 27.04.2026           │
│  Block 1h 47min · Flight 1h 23min · Fuel 3.2t · 92/100      │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  KPI ROW                                                    │
│  [Distance]  [Block]  [Flight]  [Cruise]  [Fuel]  [Land]    │
│   567 nm    1h 47m   1h 23m    FL370    3.2t    -245fpm    │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│  TRAIL MAP (2D)          │  TRAIL GLOBE (3D)                │
│  Mapbox mit Trail        │  CesiumJS mit Camera-Replay      │
│  + Phase-Marker          │  + Aircraft-Model                │
│  + Wind-Layer            │  + Time-Slider zum Scrubben      │
│  [Switch: 2D / 3D]                                          │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  VERTICAL PROFILE                                           │
│  Altitude (links) und Speed (rechts) über Time (X)          │
│  Phase-Markers: ⏵ Takeoff  ⊙ TOC  ⊙ TOD  ⏴ Touchdown        │
│  Hover: zeigt exakte Werte an Position                      │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│  ENGINE PERFORMANCE      │  WIND & WEATHER                  │
│  N1 + N2 + Fuel-Flow     │  Wind-Direction über Time        │
│  pro Engine              │  OAT, Pressure                   │
│  Multi-line chart        │  Visibility-Indicator            │
└──────────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  PHASE BREAKDOWN                                            │
│  Timeline mit Phasen:                                       │
│  ▓▓ Pushback 2m │ ▓▓▓▓ Taxi 5m │ ▓ Takeoff 30s │ ...        │
│  Klick auf Phase: zeigt Details (Avg-Werte etc.)            │
└─────────────────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────────────────┐
│  APPROACH ANALYSIS       │  LANDING ANALYSIS                │
│  Glide-Slope-Chart       │  Touchdown-Stats:                │
│  Localizer-Deviation     │  -245 fpm · 1.08g                │
│  Stable-Approach? ✅     │  Smooth Landing 🌟               │
│  Score 92/100            │  Pitch 4° · Bank 0.5°            │
└──────────────────────────┴──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  SCORE CARD                                                 │
│  Overall Score: 88/100                                      │
│  ├─ Approach Stability   92/100                             │
│  ├─ Landing Quality      95/100                             │
│  ├─ Smoothness           85/100                             │
│  ├─ Fuel Efficiency      90/100                             │
│  └─ Realism              78/100                             │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  COMPARISON                                                 │
│  Dein Durchschnitt: 84/100                                  │
│  Airline-Durchschnitt: 81/100                               │
│  Top-Pilot in dieser Route: 94/100 (CrysaGaming)            │
│  → Du warst in den Top 30% dieser Route ✨                  │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  KEY EVENTS TIMELINE                                        │
│  12:34 Engine 1 Start                                       │
│  12:36 Engine 2 Start                                       │
│  12:38 Pushback                                             │
│  12:43 Taxi to RWY 25R                                      │
│  12:51 Takeoff (RWY 25R, IAS 145kt)                         │
│  12:52 Gear up at 200ft AGL                                 │
│  ...                                                        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  COMMENTS & REMARKS                                         │
│  Pilot: "Light turbulence over EDDF, smooth descent"        │
│  Admin: "PIREP approved ✅"                                 │
└─────────────────────────────────────────────────────────────┘
```

### Mobile Layout

Auf Mobil: Sektionen vertikal stapeln, Charts auf Touch optimiert (Tap statt Hover).

---

## 3. Sektion 1 — Hero & KPI-Row

### Inhalt

```
HERO:
  - Flight-Number + Aircraft-Type
  - Departure → Arrival mit Airport-Names
  - Datum + Block-Time
  - Overall-Score (groß, prominent)
  - Action-Buttons: [PDF Download] [Share] [Repeat Flight]

KPI ROW (6 Kacheln):
  - Distance (nm)
  - Block-Time
  - Flight-Time (Airborne)
  - Cruise-Altitude
  - Fuel-Burn
  - Touchdown-Rate
```

### Framework-Wahl

```
Hero:           Custom React-Component, Tailwind CSS
KPI-Cards:      Tailwind Grid mit Icon-Lucide-React
Score-Number:   CSS-Animation auf Mount (count-up Animation)
                → npm Package: react-countup
```

### Mockup

```
╔═══════════════════════════════════════════════════════════╗
║  ✈ DLH123 · Lufthansa A320 (D-AIZA)                       ║
║                                                           ║
║  EDDF Frankfurt am Main International ✈→ LOWW Wien-       ║
║                                       Schwechat            ║
║  📅 27.04.2026 · 14:32 UTC                                ║
║                                                           ║
║                                  ╭──────────────────╮     ║
║                                  │   Score          │     ║
║                                  │      88          │     ║
║                                  │      ╱100        │     ║
║                                  ╰──────────────────╯     ║
║                                                           ║
║  [📄 PDF Export]  [📤 Share]  [🔁 Fly Again]              ║
╚═══════════════════════════════════════════════════════════╝
```

---

## 4. Sektion 2 — Trail Map (2D)

### Inhalt

Aktuelle Map-Implementation erweitern um:
- Vollständige geflogene Strecke als Polyline
- Phase-Marker entlang der Strecke (TOC, TOD, FAF)
- Wind-Layer (optional, Toggle)
- Hover: zeigt Position-Details
- Klick: setzt Time-Slider an dieser Stelle

### Framework

**Bestehend:** Mapbox GL JS 3.x mit `react-map-gl` — schon im Stack.

**Erweiterungen:**
- `mapbox-gl-draw` für Trail-Editing (falls je nötig)
- Kombination mit `deck.gl` für Heatmap-Layer (zukünftig: alle Pilots auf Heatmap)
- Eigene Layer für Phase-Markers

### Daten

```typescript
GET /api/pireps/[id]/trail
Response: {
  positions: Array<{
    timestamp: string;
    lat: number;
    lon: number;
    altitude: number;
    speed: number;
    heading: number;
    phase: PirepState;
  }>;
  events: Array<{
    type: 'PhaseTransition' | 'Touchdown' | 'EngineStart';
    timestamp: string;
    position: { lat, lon };
    metadata: Record<string, any>;
  }>;
}
```

---

## 5. Sektion 3 — Trail Globe (3D) ⭐ Differentiator

### Inhalt

Das **Wow-Feature** der Pirep-Page. Replay des Fluges auf einem 3D-Globe mit:

- Aircraft-Model in 3D (z.B. A320-Mesh)
- Camera-Modi:
  - **Cockpit** — wie Pilot sieht
  - **Chase** — verfolgt Aircraft
  - **Tower** — fixed, sieht Aircraft kommen/gehen
  - **Free** — User dreht Kamera frei
- Time-Slider zum Scrubben durch den Flug
- Speed: 1×, 5×, 25×, 100× Time-Acceleration
- Pause/Play

### Framework — Optionen

#### Option A: CesiumJS ⭐ Empfehlung

**Pro:**
- Industry-Standard für 3D-Earth/Flight-Viz
- 3D-Terrain mit Höhendaten weltweit
- Aircraft-Model-Loading via glTF
- Time-driven Animations built-in
- Free Tier: 50k Map-Loads/Monat (genug für eine VAM)
- Dokumentation gut

**Contra:**
- Größerer Bundle (~2-3 MB)
- Cesium Ion Account nötig für Premium-Imagery
- Etwas eigene Lernkurve

```bash
npm install cesium resium
```

[resium](https://resium.darwineducation.com/) ist der React-Wrapper.

#### Option B: Mapbox GL JS 3D

**Pro:**
- Schon im Stack (kein neues Dep)
- Bekannt
- Gleiche Mapbox-Token

**Contra:**
- 3D-Globe ist limitiert (nicht so cinematic)
- Aircraft-Model-Integration via Three.js custom Layer (komplex)
- Camera-Modi musst du selber bauen

#### Option C: Three.js + React Three Fiber

**Pro:**
- Maximale Flexibilität
- Eigene Globe-Implementation
- Aircraft-Modelle via gltfjsx

**Contra:**
- Du baust den Globe SELBER (kein Earth-Tileset)
- Keine echten Höhendaten ohne extra Aufwand
- Sehr viel mehr Code

#### Option D: Deck.gl Globe-View

**Pro:**
- Großartig für viele Datenpunkte
- Performance-orientiert
- Free
- Kombinierbar mit Mapbox

**Contra:**
- Globe-Mode ist beta
- Aircraft-Animation manuell

### Empfehlung: **CesiumJS** über `resium`

Begründung:
- Industry-Standard mit großer Community
- Free Tier reicht für eine VAM
- Aircraft-Model-Animation ist ein gelöstes Problem (gltf glb)
- Time-Driven-Replay ist Cesium's Stärke
- Volanta nutzt Cesium-ähnliche Tech und sieht damit beeindruckend aus

### Code-Sketch

```tsx
import { Viewer, Entity, ModelGraphics, PathGraphics } from 'resium';
import { Cartesian3, JulianDate, ClockRange, ClockStep } from 'cesium';

function PirepGlobe({ pirep }: { pirep: PirepWithTrail }) {
  const start = JulianDate.fromIso8601(pirep.takeoffAt);
  const stop = JulianDate.fromIso8601(pirep.touchdownAt);
  
  const positions = pirep.positions.map(p => 
    Cartesian3.fromDegrees(p.lon, p.lat, p.altitudeMeters)
  );
  
  return (
    <Viewer 
      timeline={true}
      animation={true}
      shouldAnimate={false}
      // ...
    >
      <Entity
        position={interpolatedPosition}
        orientation={interpolatedOrientation}
      >
        <ModelGraphics 
          uri="/models/a320.glb"
          minimumPixelSize={64}
        />
        <PathGraphics
          width={3}
          material={Color.CYAN}
          trailTime={300}  // 5 minutes Trail
        />
      </Entity>
    </Viewer>
  );
}
```

### Premium-Features (späterer Phase)

- Wetterlayer (Cloud-Layer aus DWD/NOAA-Daten)
- Andere Pilots gleichzeitig sichtbar (wenn sie im selben Zeitraum geflogen sind)
- Photo-Spots: an Schlüssel-Stellen automatisch Screenshot-Buttons
- Stream-Replay-Mode: Video-Export für YouTube/Twitch

---

## 6. Sektion 4 — Vertical Profile

### Inhalt

Klassisches Pegasus-Style Chart:
- **X-Achse:** Time oder Distance
- **Y-Achse links:** Altitude (ft)
- **Y-Achse rechts:** Speed (kt)
- **Phase-Markers** als vertical Lines auf der X-Achse
- **Hover:** Tooltip mit allen Werten an dieser Position

### Framework — Empfehlung: Recharts

**Pro:**
- Schon im Stack
- React-native, gute Performance bei <10k Punkten
- Zwei Y-Achsen built-in
- Interaktiv (Hover, Click)
- Reference-Lines für Phase-Markers

**Code-Sketch:**

```tsx
import { LineChart, Line, XAxis, YAxis, ReferenceLine, 
         Tooltip, ResponsiveContainer } from 'recharts';

function VerticalProfile({ data, events }: Props) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data}>
        <XAxis dataKey="elapsedMin" unit="min" />
        <YAxis yAxisId="alt" orientation="left" 
               label={{ value: 'Altitude (ft)', angle: -90 }} />
        <YAxis yAxisId="spd" orientation="right"
               label={{ value: 'Speed (kt)', angle: 90 }} />
        
        <Line yAxisId="alt" dataKey="altitudeFt" 
              stroke="#3B82F6" strokeWidth={2} dot={false} />
        <Line yAxisId="spd" dataKey="indicatedKts"
              stroke="#10B981" strokeWidth={2} dot={false} />
        
        {events.map(e => (
          <ReferenceLine x={e.elapsedMin} 
                         stroke="#9CA3AF"
                         label={e.label} />
        ))}
        
        <Tooltip content={<CustomTooltip />} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### Alternative: ECharts (für sehr lange Flights)

Bei 12-Stunden Flügen mit 1-Sekunden-Sampling: 43.200 Datenpunkte.
Recharts wird langsam. Lösung: Downsampling auf 1k Punkte oder ECharts mit Canvas-Rendering.

```bash
npm install echarts echarts-for-react
```

---

## 7. Sektion 5 — Engine Performance

### Inhalt

Multi-Line Chart mit:
- N1% pro Engine
- N2% pro Engine
- Fuel Flow pro Engine
- Toggle: Engine 1 / 2 / Both

### Framework

**Recharts** für 2-Engine-Aircraft (A320, B737).  
**ECharts** für Wide-Body (A380, B777, B747).

### Mockup

```
ENGINE PERFORMANCE
┌─────────────────────────────────────────────────────────┐
│  N1 %                                                   │
│  100│      ╱──╮                                         │
│   80│    ╱     ╰──╮                                     │
│   60│  ╱            ╰────────╮                          │
│   40│                          ╰────╮                   │
│   20│                                                   │
│    0└────────────────────────────────────────────────── │
│       Takeoff  Climb    Cruise    Descent  Approach    │
│                                                         │
│  [✓] Engine 1   [✓] Engine 2                            │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Sektion 6 — Phase Breakdown Timeline

### Inhalt

Horizontale Timeline der Flight-Phasen mit:
- Farb-codierte Bars pro Phase
- Klick: Detail-Panel öffnet sich mit Stats für diese Phase
- Hover: Tooltip mit Dauer

### Framework

**Custom Component** mit Tailwind. Kein Framework nötig — das ist einfaches CSS.

```tsx
function PhaseTimeline({ phases, totalSeconds }: Props) {
  return (
    <div className="relative h-12 bg-gray-800 rounded-lg overflow-hidden">
      {phases.map(phase => {
        const widthPercent = (phase.durationSec / totalSeconds) * 100;
        const startPercent = (phase.startSec / totalSeconds) * 100;
        return (
          <div
            key={phase.id}
            className={`absolute h-full ${PHASE_COLORS[phase.type]}`}
            style={{ 
              left: `${startPercent}%`,
              width: `${widthPercent}%`
            }}
            onClick={() => setSelected(phase)}
          >
            <div className="text-xs text-white px-2 py-1">
              {phase.type}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PHASE_COLORS = {
  Pushback:  'bg-purple-600',
  Taxi:      'bg-yellow-600',
  Takeoff:   'bg-orange-600',
  Climb:     'bg-blue-600',
  Cruise:    'bg-green-600',
  Descent:   'bg-blue-400',
  Approach:  'bg-orange-500',
  Landing:   'bg-red-600',
  TaxiIn:    'bg-yellow-500',
  BlockOn:   'bg-gray-600',
};
```

### Mockup

```
┌─────────────────────────────────────────────────────────┐
│ PHASE BREAKDOWN                                         │
│                                                         │
│ ▓▓│▓▓▓▓│▓│▓▓▓▓▓│▓▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓│▓▓▓│▓│▓▓│▓▓        │
│ Pb│Taxi│To│Climb│   Cruise    │Desc.│App│L│Ti│Bo        │
│ 2m  5m 30 12m       58m         8m   5m  1m 4m 30s      │
│                                                         │
│ [Click on phase for details]                            │
└─────────────────────────────────────────────────────────┘

Click on "Cruise" →

┌──────────────────────────────────┐
│  CRUISE PHASE — 58 minutes       │
├──────────────────────────────────┤
│  Avg Altitude:   FL370            │
│  Avg Speed:      M0.78 / 460kt    │
│  Avg Fuel-Flow:  4500 pph         │
│  Wind:           270°/65kt         │
│  OAT:            -54°C            │
│  Distance:       430 nm            │
└──────────────────────────────────┘
```

---

## 9. Sektion 7 — Approach Analysis

### Inhalt

Detaillierte Approach-Analyse mit zwei Charts:

**Chart 1: Glide Slope Deviation**
- Y-Achse: Höhe über Touchdown (ft)
- X-Achse: Distance to Threshold (nm)
- Plot: ideale Glide-Slope-Linie + tatsächlicher Pfad
- Color-coded: grün (on-slope) / orange (off) / rot (way-off)

**Chart 2: Localizer Deviation**
- Y-Achse: Lateral Deviation (Grad)
- X-Achse: Distance to Threshold (nm)
- Plot: 0-Linie + tatsächlicher Pfad

**Score:**
- Stable Approach: ✅ / ❌
- Score 0-100 basierend auf Deviation-Variance + Configuration-Stability

### Framework

**Visx** für die spezifische Approach-Chart. Begründung:
- Recharts ist limitiert bei Custom-Visuals (gefärbte Bereiche, Slope-Lines)
- D3 wäre overkill
- Visx (Airbnb) ist D3 + React, perfekt für custom Charts

```bash
npm install @visx/group @visx/scale @visx/shape @visx/axis
```

### Mockup

```
APPROACH ANALYSIS — RWY 11 LOWW
┌──────────────────────────────────────────────────────────┐
│  Glide Slope Deviation                                   │
│                                                          │
│  ft AGL                                                  │
│  3000│ ╲                                                 │
│  2500│  ╲   ▼ ideal 3°                                   │
│  2000│   ╲╲╲╲                                            │
│  1500│      ╲╲▓▓ on slope (green)                        │
│  1000│        ╲▓▓                                        │
│   500│           ╲▓                                      │
│     0│___________________________________○ Touchdown    │
│       10 nm      5 nm        2 nm       0               │
│                                                          │
│  Glide Stability Score: 92/100  ✅ Stable Approach       │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Localizer Deviation                                     │
│                                                          │
│  +1 dot │_______________________                         │
│         │       ╱▓▓▓╲                                    │
│   0 dot │──────▓──────▓▓▓──▓▓──╳──── Centerline          │
│         │                                                │
│  -1 dot │_____________________                           │
│           10 nm    5 nm    2 nm     0                    │
│                                                          │
│  Localizer Stability: 96/100                             │
└──────────────────────────────────────────────────────────┘
```

### Stable-Approach-Definition

Stable Approach = bei 1000 ft AGL:
- Glide-Slope: ±1 dot deviation
- Localizer: ±1 dot deviation
- Speed: Vref +5/-0 kts
- Configuration: Flaps + Gear extended
- Power-Setting: stable (kein Throttle-Manöver in letzten 30s)
- Vertical-Speed: < 1000 fpm

→ Wenn alle Conditions: **Stable Approach ✅**

---

## 10. Sektion 8 — Landing Analysis

### Inhalt

Detaillierte Landing-Stats:
- Touchdown-Rate (vertical speed bei TD)
- G-Force at Touchdown
- Pitch Angle bei TD (3-7° normal)
- Bank Angle bei TD (sollte <2° sein)
- Crosswind-Component (berechnet aus Wind + Runway-Heading)
- Touchdown-Position (Distance from Runway-Threshold)
- Runway-Used (z.B. "07L")

### Klassifikation

```
Touchdown-Rate (fpm)   Klassifikation
< -100                 🌟 Butter Landing  (Score 100)
-100 to -250           ✨ Smooth Landing  (Score 95)
-250 to -500           ✅ Acceptable      (Score 85)
-500 to -800           ⚠️ Hard Landing    (Score 60)
-800 to -1500          ❌ Very Hard       (Score 30)
< -1500                💥 Crash-like      (Score 0)
```

### Framework

**React Component** mit Tailwind. Kein Chart-Framework nötig — das sind KPI-Cards.

### Mockup

```
LANDING ANALYSIS — RWY 11 LOWW
┌──────────────────────────────────────────────────────────┐
│                                                          │
│             ✨ Smooth Landing                            │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │  Touchdown     │  │  G-Force       │                  │
│  │  -245 fpm      │  │  1.08g         │                  │
│  │  Score: 95     │  │  Smooth ✅     │                  │
│  └────────────────┘  └────────────────┘                  │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │  Pitch         │  │  Bank          │                  │
│  │  +4.2°         │  │  -0.5°         │                  │
│  │  Normal ✅     │  │  Wings level ✅│                  │
│  └────────────────┘  └────────────────┘                  │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │  Touchdown     │  │  Crosswind     │                  │
│  │  Position      │  │  4 kt          │                  │
│  │  330m past TH  │  │  Slight ✅     │                  │
│  │  Score: 90     │  │                │                  │
│  └────────────────┘  └────────────────┘                  │
└──────────────────────────────────────────────────────────┘
```

---

## 11. Sektion 9 — Score Card

### Inhalt

Overall-Score plus Sub-Scores in einer Übersicht.

### Score-Berechnung

```
Overall Score (0-100):
  = avg(Approach, Landing, Smoothness, Fuel-Efficiency, Realism)

Approach Stability (0-100):
  = (Glide-Slope-Stability * 0.5)
  + (Localizer-Stability * 0.3)
  + (Speed-Stability * 0.1)
  + (Configuration-Stability * 0.1)

Landing Quality (0-100):
  = (Touchdown-Rate-Score * 0.6)
  + (Pitch-Angle-Score * 0.2)
  + (Bank-Angle-Score * 0.1)
  + (Touchdown-Position-Score * 0.1)

Smoothness (0-100):
  = 100 - (G-Force-StdDev * 50)
  - (Bank-StdDev * 5)
  - (Pitch-StdDev * 5)

Fuel Efficiency (0-100):
  = 100 - (|actual_burn - planned_burn| / planned_burn * 100)
  Limit auf [0, 100]
  Bonus +10 wenn 5%+ besser als geplant

Realism (0-100):
  = checkpoints aus 10 Pre-Flight, Phase-Transition Rules
  z.B. Beacon-On vor Engine-Start? +10
       Lichter korrekt während Phasen? +10
       Flaps-Schedule realistisch? +10
       APU-Sequenz korrekt? +10
       Engine-Start korrekt? +10
       Pushback-Sequenz? +10
       Taxi-Speed unter 30kt? +10
       Configuration vor Approach? +10
       Reverse-Thrust nicht über 80kt nach Touchdown? +10
       Parking-Brake nach Block-On? +10
```

### Framework

**Recharts RadialBarChart** für die Score-Anzeige (Donut-Chart).

```tsx
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';

const data = [
  { name: 'Overall', value: 88, fill: '#10B981' }
];

<ResponsiveContainer width="100%" height={250}>
  <RadialBarChart innerRadius="80%" outerRadius="100%" 
                   data={data} startAngle={90} endAngle={-270}>
    <RadialBar dataKey="value" />
    <text x="50%" y="50%" textAnchor="middle" 
          className="text-4xl font-bold">88</text>
  </RadialBarChart>
</ResponsiveContainer>
```

---

## 12. Sektion 10 — Comparison

### Inhalt

Wie schnitt der Pilot ab im Vergleich zu:
- Eigener Durchschnitt (alle Flüge)
- Eigener Durchschnitt (gleiche Route)
- Airline-Durchschnitt
- Top-Pilot dieser Route
- Percentile (in welchem % der Flüge liegt dieser?)

### Mockup

```
┌──────────────────────────────────────────────────────────┐
│  COMPARISON                                              │
│                                                          │
│  Score: 88                                               │
│                                                          │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  Du in dieser Route   ─── 88 ────●────                  │
│  Dein Durchschnitt    ─── 84 ──●──────                  │
│  Airline-Durchschnitt ─── 81 ●────────                  │
│  Top-Pilot            ─── 94 ──────────●                │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                                          │
│  → Du warst in den Top 30% dieser Route ✨               │
└──────────────────────────────────────────────────────────┘
```

### Framework

Custom React mit Tailwind. Bars sind einfach `<div>` mit Width-Prozent.

---

## 13. Sektion 11 — Key Events Timeline

### Inhalt

Chronologische Liste aller wichtigen Events mit Timestamps:
- Engine-Start-Sequenz
- Phase-Transitions
- Gear-Up/Down
- Flaps-Changes
- Autopilot-On/Off
- Top-of-Climb / Top-of-Descent
- Approach-Capture (Localizer/Glide)
- Touchdown
- Reverse-Thrust
- Parking-Brake

### Framework

Custom React mit Tailwind. Liste mit Icons + Timestamps.

### Mockup

```
KEY EVENTS
┌──────────────────────────────────────────────────────────┐
│  12:34  ⚡ Engine 1 Start                                │
│  12:35  ⚡ Engine 2 Start                                │
│  12:36  💡 Beacon On                                     │
│  12:38  ⬅ Pushback Begin                                 │
│  12:40  ⬅ Pushback Complete                              │
│  12:42  🚕 Taxi to RWY 25R                               │
│  12:51  🛫 Takeoff (RWY 25R, IAS 145kt)                  │
│  12:51  ⬆ Gear Up at 200ft AGL                           │
│  12:53  🤖 Autopilot On at FL080                         │
│  12:55  📦 Flaps Up                                      │
│  13:09  ⛰ Top of Climb at FL370                          │
│  14:07  ⛰ Top of Descent                                 │
│  14:34  📦 Flaps Approach                                │
│  14:36  ⬇ Gear Down                                      │
│  14:38  📡 Localizer Captured                            │
│  14:39  📡 Glide Slope Captured                          │
│  14:42  🛬 Touchdown (-245 fpm, 1.08g)                   │
│  14:42  ⬅ Reverse Thrust                                 │
│  14:45  🚕 Taxi to Gate                                  │
│  14:48  🛑 Block On (Brake set)                          │
│  14:49  ⚡ Engine 1 Off                                  │
│  14:49  ⚡ Engine 2 Off                                  │
└──────────────────────────────────────────────────────────┘
```

---

## 14. Sektion 12 — Comments & Remarks

### Inhalt

- Pilot-Comment (editierbar nach Submit)
- Admin-Comment (read-only für Pilot)
- Auto-Generated-Notes (z.B. "Hard-Landing detected", "Time-Acceleration Warning")

### Framework

Custom React mit Tailwind. Form bei Edit-Mode.

---

## 15. Daten-Modell-Erweiterungen

Damit all das funktioniert, brauchen wir Schema-Erweiterungen.

### Neue Tabelle: PirepTelemetry

```prisma
model PirepTelemetry {
  id          String   @id @default(cuid())
  pirepId     String
  pirep       Pirep    @relation(fields: [pirepId], references: [id], onDelete: Cascade)
  
  timestamp   DateTime
  elapsedSec  Int       // seconds since pushback
  phase       String    // 'Climb', 'Cruise', etc.
  
  // Position
  latitude    Float
  longitude   Float
  altitudeFt  Int
  altitudeAglFt Int?
  headingTrue Float
  headingMag  Float
  pitch       Float
  bank        Float
  
  // Speed
  iasKts      Int
  tasKts      Int
  groundKts   Int
  mach        Float?
  vspeedFpm   Int
  
  // Engines
  engineN1Avg Float?
  engineN2Avg Float?
  fuelFlowPph Int?
  
  // State
  flapsPercent Int?
  gearDown     Boolean?
  spoilersDeployed Boolean?
  autopilotOn  Boolean?
  
  // Forces
  gForce      Float?
  
  // Environment
  windSpeedKts Int?
  windDirection Int?
  oatCelsius  Int?
  
  // Approach (only when relevant)
  glideSlopeError Float?
  localizerError Float?
  
  @@index([pirepId, elapsedSec])
}
```

### Neue Tabelle: PirepEvent

```prisma
model PirepEvent {
  id          String   @id @default(cuid())
  pirepId     String
  pirep       Pirep    @relation(fields: [pirepId], references: [id], onDelete: Cascade)
  
  type        String   // 'EngineStart', 'PhaseTransition', 'Touchdown', etc.
  timestamp   DateTime
  elapsedSec  Int
  
  latitude    Float?
  longitude   Float?
  altitudeFt  Int?
  
  metadata    Json?    // type-specific data
  
  @@index([pirepId, elapsedSec])
}
```

### Pirep-Erweiterung

```prisma
model Pirep {
  // existing fields...
  
  // Computed scores (set when PIREP is finalized)
  scoreOverall      Int?    // 0-100
  scoreApproach     Int?
  scoreLanding      Int?
  scoreSmoothness   Int?
  scoreFuelEff      Int?
  scoreRealism      Int?
  
  // Touchdown data
  touchdownVerticalSpeed Int?  // fpm, negative = descent
  touchdownGForce        Float?
  touchdownPitch         Float?
  touchdownBank          Float?
  touchdownRunway        String?  // "07L"
  touchdownPositionFt    Int?     // Distance from threshold
  
  // Approach
  approachStable    Boolean?
  
  // Cruise
  cruiseAltitudeFt  Int?
  cruiseMach        Float?
  
  // Fuel
  fuelBurnedKg      Int?
  fuelPlannedKg     Int?
  fuelEfficiencyPct Float?  // (planned - actual) / planned * 100
  
  // Phase durations (seconds)
  durationPushback  Int?
  durationTaxiOut   Int?
  durationTakeoff   Int?
  durationClimb     Int?
  durationCruise    Int?
  durationDescent   Int?
  durationApproach  Int?
  durationLanding   Int?
  durationTaxiIn    Int?
  
  // Counters
  hardLandingCount  Int @default(0)
  overspeedCount    Int @default(0)
  stallCount        Int @default(0)
  pauseSeconds      Int @default(0)
  
  // ACARS source
  acarsClient       String?  // "vam-acars-1.0.0"
  
  telemetry         PirepTelemetry[]
  events            PirepEvent[]
}
```

---

## 16. API-Endpoints

```
GET /api/pireps/[id]
  → Vollständiger Pirep + alle Scores + Touchdown-Daten

GET /api/pireps/[id]/telemetry
  → PirepTelemetry[] für Charts
  → Optional: ?downsample=1000 (für lange Flüge)
  → Optional: ?phase=Cruise (nur eine Phase)

GET /api/pireps/[id]/events
  → PirepEvent[] chronologisch sortiert

GET /api/pireps/[id]/comparison
  → ComparisonData {
      userAvg: number,
      userRouteAvg: number,
      airlineAvg: number,
      topPilotScore: number,
      percentile: number
    }

GET /api/pireps/[id]/pdf
  → PDF-Export der Pirep-Detail-Seite
```

---

## 17. Implementation-Phasen

### MVP — Phase A (~3-4 Tage Solo)

**Ziel:** Basis-Detail-Page mit den meisten Sektionen, ohne 3D-Globe.

```
- [ ] Schema: PirepTelemetry + PirepEvent + Pirep-Erweiterung
- [ ] Migration
- [ ] API: GET /api/pireps/[id]/telemetry
- [ ] API: GET /api/pireps/[id]/events
- [ ] Page: /pireps/[id]/analysis
  - [ ] Hero + KPI-Row
  - [ ] Trail-Map (2D, Mapbox bereits da)
  - [ ] Vertical-Profile (Recharts)
  - [ ] Phase-Timeline (custom)
  - [ ] Landing-Analysis (Cards)
  - [ ] Score-Card (RadialBarChart)
  - [ ] Comments
- [ ] Score-Berechnung im Backend (bei PIREP-Submit)

Aufwand: ~3-4 Tage
Wow-Faktor: 7/10
```

### Premium — Phase B (~3-4 Tage)

**Ziel:** 3D-Globe-Replay + Advanced-Charts.

```
- [ ] CesiumJS + resium installieren
- [ ] Aircraft-Models (glb-Files für 5-10 wichtigste Aircraft)
- [ ] Trail-Globe Component
- [ ] Camera-Modi (Cockpit, Chase, Tower, Free)
- [ ] Time-Slider mit Speed-Control
- [ ] Engine-Performance-Charts
- [ ] Approach-Analysis-Charts (Visx)
- [ ] Comparison-Section
- [ ] PDF-Export

Aufwand: ~3-4 Tage
Wow-Faktor: 10/10
```

### Polish — Phase C (~2-3 Tage)

**Ziel:** Mobile-Responsive, Performance, Animations.

```
- [ ] Mobile-Layout für alle Sektionen
- [ ] Charts auf Touch optimieren
- [ ] Lazy-Loading: 3D-Globe erst on-demand laden
- [ ] Skeleton-Screens beim Laden
- [ ] Smooth Mount-Animations (Framer Motion)
- [ ] Share-Button (Twitter/Discord/Direct-Link)
- [ ] Export als Image (Pirep-Karte für Social)

Aufwand: ~2-3 Tage
```

**Total Phase A+B+C:** ~8-11 Tage

---

## 18. Framework-Stack-Übersicht

| Sektion | Framework | Warum |
|---|---|---|
| Hero, KPI-Row | React + Tailwind + Lucide-React | Standard-UI |
| Number-Animations | react-countup | Mount-Animation |
| Trail-Map (2D) | Mapbox GL JS + react-map-gl | Schon im Stack |
| Trail-Globe (3D) | CesiumJS + resium | Industry-Standard |
| Aircraft-Modelle | gltfjsx + glb-Files | 3D-Models |
| Vertical-Profile | Recharts | Schon im Stack, einfach |
| Engine-Charts | Recharts | Multi-Line gut |
| Approach-Charts | Visx | Custom-Visuals nötig |
| Phase-Timeline | Custom React + Tailwind | Einfach selbst |
| Score-Card | Recharts RadialBar | Donut-Style |
| Landing-Cards | Custom React + Tailwind | KPI-Display |
| Comparison-Bars | Custom React + Tailwind | Einfach |
| Animations | Framer Motion | Sektion-Mount-Animations |
| PDF-Export | @react-pdf/renderer | Server-Side PDF |
| Long-Flights | ECharts (für >10k Datenpunkte) | Performance |

### Bundle-Size-Impact

```
Aktuelle Web-App:           ~ 2-3 MB initial
+ Cesium (Lazy-Load):       ~ 2-3 MB on Pirep-Detail-Page
+ Recharts (lazy):          ~ 200 KB
+ Visx (lazy):              ~ 300 KB
+ Framer Motion:            ~ 100 KB

Total Pirep-Detail-Bundle:  ~ 6 MB (lazy-loaded)
Initial Page-Load:          unverändert (Lazy-Loading)
```

→ Cesium nur laden wenn User auf Pirep-Detail klickt UND auf "3D" toggled.

---

## 19. Anti-Cheat-Indicators

Auf Pirep-Detail-Page sichtbar (für Admin):

```
PIREP QUALITY FLAGS
┌──────────────────────────────────────────────────────────┐
│  ✅ No time-acceleration detected                        │
│  ⚠️  Pause-Time: 4 minutes (within tolerance)            │
│  ✅ No position-jumps                                    │
│  ✅ Flight-Time consistent with distance                 │
│  ✅ VATSIM online: 95% of flight                         │
│  ⚠️  Hard-Landing flagged for review                     │
└──────────────────────────────────────────────────────────┘
```

---

## 20. Open Questions

- [ ] Soll der 3D-Globe Default oder Toggle-only sein? (Bandwidth-Frage)
- [ ] Welche Aircraft-Modelle sollen wir bereitstellen? (10 default, oder community-uploaded?)
- [ ] PDF-Export: Server-Side (Puppeteer) oder Client-Side (jsPDF)?
- [ ] Score-Berechnung bei Submit oder lazy bei first View?
- [ ] Telemetry-Storage: Volle 1-Sek-Daten in PostgreSQL (10MB pro Flight) oder TimeSeriesDB (z.B. TimescaleDB)?
- [ ] Comparison-Data: Live-Berechnung (DB-Query) oder Materialized-View?
- [ ] Heatmap aller Pilots: Sinnvoll oder Privacy-Risiko?
- [ ] Auto-Generated-Comments: regel-basiert oder LLM-basiert?
- [ ] Soll der Pilot Score-Berechnung hinterher anpassen können (z.B. wenn er mit Hard-Landing-Flag nicht einverstanden ist)?
- [ ] Was bei sehr kurzen Flügen (< 30 Min)? Reduzierte Page?

---

## 21. Inspiration-Sammlung

### vAMSYS Pegasus

[https://vamsys.co.uk](https://vamsys.co.uk) — die Goldstandard. Schau dir an:
- Vertical-Profile mit Phase-Markern
- Approach-Charts mit Glide-Slope-Tracking
- Smart-Scoring mit Sub-Scores
- Multi-Sim-Support

### Volanta

[https://volanta.app](https://volanta.app) — schöne 3D-Replays. Schau dir an:
- Globe-Replay mit Aircraft-Model
- Camera-Modi
- Time-Slider mit Phase-Markers
- Live-Map-Integration

### Sim Toolkit Pro

Detailliertes Logbook + Pirep-Stats. Inspiration für:
- Stats-Aggregationen
- Logbook-Layout
- Achievement-System

### Flightradar24 / FlightAware

Für Trail-Visualization-Ideas:
- Wind-Layer
- Weather-Overlay
- Other-Aircraft-Overlay

---

## 22. Phasen-Abhängigkeit zur OBS-Overlay-Roadmap

Diese Pirep-Analyse-Page baut auf SimConnect-Daten auf. Reihenfolge:

```
1. OBS-Overlay Phase 1-4   ← aktuell laufend
2. ACARS-Heartbeat-API     ← OBS-Roadmap Phase 8.1
3. ACARS-Client Electron   ← OBS-Roadmap Phase 8.3
4. ACARS schreibt Telemetry ← Voraussetzung für Pirep-Detail-Page
5. Pirep-Detail-Page MVP   ← Phase A (3-4 Tage)
6. Pirep-Detail Premium    ← Phase B (3-4 Tage, mit 3D-Globe)
7. Pirep-Detail Polish     ← Phase C (2-3 Tage)
```

→ **Pirep-Analyse-Page kommt frühestens nach 3-4 Wochen ACARS-Arbeit.**

Aber: Schon jetzt kann man die **Schema-Erweiterungen** vorbereiten und committen, damit der ACARS-Client später direkt darauf schreiben kann.

---

## Referenzen

- [vAMSYS Pegasus Features](https://vamsys.co.uk/)
- [Recharts Documentation](https://recharts.org/)
- [CesiumJS Tutorials](https://cesium.com/learn/)
- [resium React-Wrapper](https://resium.darwineducation.com/)
- [Visx by Airbnb](https://airbnb.io/visx/)
- [Apache ECharts](https://echarts.apache.org/)
- [Three.js + R3F](https://docs.pmnd.rs/react-three-fiber)
- [Framer Motion](https://www.framer.com/motion/)
- [Mapbox 3D Terrain](https://docs.mapbox.com/mapbox-gl-js/api/map/#map-3d)
- [Deck.gl Layer Catalog](https://deck.gl/docs/api-reference/layers)
- [Stable Approach Standard](https://flightsafety.org/asw-article/stabilized-approach/) (FSF Definition)
