# SimConnect Datenkatalog für VAM-System

> Vollständiger Katalog aller relevanten SimConnect-Datenpunkte (MSFS 2024 SDK)
> für die Verwendung im eigenen ACARS-Client. Gruppiert nach Verwendungszweck.

**Quellen:**
- [MSFS 2024 SDK — Simulation Variables](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variables.htm)
- [vAMSYS Pegasus Feature-Set](https://vamsys.co.uk/) (Inspiration)
- [vmsACARS Plugin SDK](https://github.com/phpvms/acars-pdk) (Phase-Detection-Logic)

**Stand:** April 2026

---

## Konzepte vorab

### Was ist eine SimVar?

Eine **SimVar** (Simulation Variable) ist ein einzelner Datenpunkt aus dem Sim. Beispiele:

- `PLANE LATITUDE` — Breitengrad des Flugzeugs in Grad
- `INDICATED AIRSPEED` — IAS in Knots
- `ENG N1 RPM:1` — N1 von Engine 1 in Prozent

Über **SimConnect** liest dein ACARS-Client diese Variablen aus, typischerweise mehrmals pro Sekunde.

### Datentypen

SimConnect unterstützt:
- **FLOAT64** — Most Common (Position, Speed, Altitude)
- **FLOAT32** — Wenn Präzision egal ist
- **INT32 / INT64** — Counters, Flags
- **STRING** — Aircraft Title, ATC Type
- **BOOL** existiert NICHT — verwende INT (0=false, anything>0=true)

### Index-Notation

Manche SimVars haben mehrere Werte (z.B. pro Engine). Notation: `ENG N1 RPM:1` für Engine 1, `ENG N1 RPM:2` für Engine 2, etc.

### Cross-Sim-Kompatibilität

| Simulator | Native API | Bridge zum ACARS möglich |
|---|---|---|
| MSFS 2020 / 2024 | SimConnect | ✅ direkt via SimConnect |
| Prepar3D | SimConnect | ✅ direkt via SimConnect |
| X-Plane 11/12 | XPLM (datarefs) | ⚠️ via XPUIPC oder eigener Plugin |
| Aerofly FS | proprietär | ❌ nicht praktikabel |

**Empfehlung:** MSFS+P3D zuerst (gleiche API), X-Plane als 2. Phase mit eigenem XPLM-Plugin.

---

## 1. Position & Navigation

**Verwendung:** Live-Tracking-Position, Trail-Visualisierung, Map-Anzeige im Overlay.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `PLANE LATITUDE` | degrees | FLOAT64 | 50.0379 | Live-Tracking |
| `PLANE LONGITUDE` | degrees | FLOAT64 | 8.5622 | Live-Tracking |
| `PLANE ALTITUDE` | feet | FLOAT64 | 35000 | Live-Tracking |
| `GROUND ALTITUDE` | feet | FLOAT64 | 364 | Phase-Detection |
| `RADIO HEIGHT` | feet | FLOAT64 | 50 | Approach-Analyse |
| `PLANE HEADING DEGREES TRUE` | degrees | FLOAT64 | 095 | Map-Rotation |
| `PLANE HEADING DEGREES MAGNETIC` | degrees | FLOAT64 | 097 | ATC-Reports |
| `PLANE PITCH DEGREES` | degrees | FLOAT64 | 2.5 | Flight-Profile |
| `PLANE BANK DEGREES` | degrees | FLOAT64 | -15.2 | Approach-Analyse |
| `MAGVAR` | degrees | FLOAT64 | 2.0 | Wind-Berechnung |

**Heartbeat-Frequenz:** 1 Hz für Live-Tracking, 5 Hz für PIREP-Recording.

---

## 2. Speed & Performance

**Verwendung:** PIREP-Statistiken, Approach-Stability-Score, Speed-Limit-Violations.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `AIRSPEED INDICATED` | knots | FLOAT64 | 280 | Live + PIREP |
| `AIRSPEED TRUE` | knots | FLOAT64 | 460 | PIREP |
| `GROUND VELOCITY` | knots | FLOAT64 | 450 | Live-Tracking |
| `AIRSPEED MACH` | mach | FLOAT64 | 0.78 | Cruise-Phase |
| `VERTICAL SPEED` | feet per minute | FLOAT64 | -1500 | Phase-Detection |
| `STALL WARNING` | bool | INT32 | 0 | Incident-Detection |
| `OVERSPEED WARNING` | bool | INT32 | 0 | Incident-Detection |
| `G FORCE` | gforce | FLOAT64 | 1.05 | Hard-Maneuver-Detection |
| `ACCELERATION BODY X` | feet/s² | FLOAT64 | 0.5 | Power-Analyse |
| `ACCELERATION BODY Y` | feet/s² | FLOAT64 | 0.0 | Lateral-G |
| `ACCELERATION BODY Z` | feet/s² | FLOAT64 | -0.2 | Vertical-G |

**Wichtig:** `G FORCE` ist DER Wert für Hard-Landing-Detection. Wert ~1.0 = ruhig, >1.5 = grobe Landung, >2.0 = harte Landung, >3.0 = Aircraft-Damage-Schwelle.

---

## 3. Aircraft State (Flaps, Gear, Spoilers, Lights)

**Verwendung:** Phase-Detection (z.B. Gear-Down → Approach), Pirep-Rule-Checks ("Gear bei 250kt extended").

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `FLAPS HANDLE INDEX` | enum | INT32 | 3 | Phase-Detection |
| `FLAPS HANDLE PERCENT` | percent | FLOAT64 | 75 | UI-Display |
| `TRAILING EDGE FLAPS LEFT PERCENT` | percent | FLOAT64 | 75 | Detail |
| `GEAR HANDLE POSITION` | bool | INT32 | 0 | Phase-Detection |
| `GEAR POSITION:0` | enum | INT32 | 1 | Live-State |
| `GEAR TOTAL PCT EXTENDED` | percent | FLOAT64 | 100 | UI-Display |
| `BRAKE PARKING POSITION` | bool | INT32 | 1 | Block-On-Detection |
| `BRAKE LEFT POSITION` | percent | FLOAT64 | 0 | Touchdown-Analyse |
| `BRAKE RIGHT POSITION` | percent | FLOAT64 | 0 | Touchdown-Analyse |
| `SPOILERS HANDLE POSITION` | percent | FLOAT64 | 0 | Approach-Detection |
| `SPOILERS ARMED` | bool | INT32 | 1 | Auto-Brake-Setup |
| `SIM ON GROUND` | bool | INT32 | 0 | Phase-Detection (kritisch) |
| `LIGHT BEACON` | bool | INT32 | 1 | Pre-Flight-Check |
| `LIGHT LANDING` | bool | INT32 | 0 | Approach-Detection |
| `LIGHT TAXI` | bool | INT32 | 1 | Taxi-Phase |
| `LIGHT NAV` | bool | INT32 | 1 | Pre-Flight-Check |
| `LIGHT STROBE` | bool | INT32 | 1 | Takeoff/Approach |

**Phase-Detection-Beispiel:**
```
Wenn SIM ON GROUND = 0 UND VERTICAL SPEED < -300 fpm UND GEAR DOWN
  → Phase = Approach

Wenn SIM ON GROUND = 1 UND BRAKE PARKING = 1 UND ENGINES OFF
  → Phase = Block-On (PIREP-Generation triggern!)
```

---

## 4. Engine Data

**Verwendung:** Engine-Performance-Analyse, Fuel-Burn-Statistiken, Engine-Failure-Detection.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `NUMBER OF ENGINES` | number | INT32 | 2 | Aircraft-Type |
| `ENG COMBUSTION:1` | bool | INT32 | 1 | Engine-On-Detection |
| `ENG COMBUSTION:2` | bool | INT32 | 1 | Engine-On-Detection |
| `ENG N1 RPM:1` | percent | FLOAT64 | 95.4 | Performance |
| `ENG N2 RPM:1` | percent | FLOAT64 | 98.1 | Performance |
| `ENG FUEL FLOW PPH:1` | pounds per hour | FLOAT64 | 4500 | Fuel-Burn |
| `ENG FUEL FLOW GPH:1` | gallons per hour | FLOAT64 | 670 | Fuel-Burn |
| `ENG OIL PRESSURE:1` | psi | FLOAT64 | 60 | Health-Monitoring |
| `ENG OIL TEMPERATURE:1` | celsius | FLOAT64 | 95 | Health-Monitoring |
| `ENG EGT:1` | celsius | FLOAT64 | 720 | Cruise-Optimization |
| `ENG VIBRATION:1` | number | FLOAT64 | 0.2 | Damage-Detection |
| `GENERAL ENG THROTTLE LEVER POSITION:1` | percent | FLOAT64 | 85 | Power-Analyse |
| `GENERAL ENG REVERSE THRUST ENGAGED:1` | bool | INT32 | 0 | Landing-Phase |

**Per-Engine:** Alle SimVars mit `:N` Notation funktionieren für Engine 1, 2, 3, 4.

---

## 5. Fuel

**Verwendung:** Fuel-Burn-Statistik im PIREP, Fuel-Reserve-Warnung, Block-Fuel-Berechnung.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `FUEL TOTAL QUANTITY` | gallons | FLOAT64 | 5000 | PIREP |
| `FUEL TOTAL QUANTITY WEIGHT` | pounds | FLOAT64 | 33500 | PIREP |
| `FUEL TANK LEFT MAIN QUANTITY` | gallons | FLOAT64 | 1500 | Detail |
| `FUEL TANK RIGHT MAIN QUANTITY` | gallons | FLOAT64 | 1500 | Detail |
| `FUEL TANK CENTER QUANTITY` | gallons | FLOAT64 | 2000 | Detail |
| `TOTAL FUEL FLOW` | pounds per hour | FLOAT64 | 9000 | Live-Display |

**Block-Fuel-Berechnung:** `Block-Fuel = (Fuel-At-Pushback) - (Fuel-At-Block-On)` in kg/lbs.

---

## 6. Autopilot

**Verwendung:** Phase-Detection (AP-On meist nach Cruise-Climb), Pilot-Skill-Score (manuelles Fliegen vs. AP).

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `AUTOPILOT MASTER` | bool | INT32 | 1 | Phase-Detection |
| `AUTOPILOT FLIGHT DIRECTOR ACTIVE` | bool | INT32 | 1 | Pre-AP |
| `AUTOPILOT NAV1 LOCK` | bool | INT32 | 1 | Cruise-Phase |
| `AUTOPILOT HEADING LOCK` | bool | INT32 | 0 | Phase-Indikator |
| `AUTOPILOT ALTITUDE LOCK` | bool | INT32 | 1 | Cruise-Phase |
| `AUTOPILOT VERTICAL HOLD` | bool | INT32 | 0 | Climb/Descent |
| `AUTOPILOT VERTICAL HOLD VAR` | feet/min | FLOAT64 | 1500 | Set V/S |
| `AUTOPILOT ALTITUDE LOCK VAR` | feet | FLOAT64 | 35000 | Target-Alt |
| `AUTOPILOT HEADING LOCK DIR` | degrees | FLOAT64 | 270 | Set HDG |
| `AUTOPILOT AIRSPEED HOLD VAR` | knots | FLOAT64 | 280 | Set Speed |
| `AUTOPILOT MACH HOLD VAR` | mach | FLOAT64 | 0.78 | Cruise-Speed |
| `AUTOPILOT APPROACH HOLD` | bool | INT32 | 1 | Approach-Phase |

---

## 7. Environment & Wind

**Verwendung:** Wetter-Anzeige im Overlay, Wind-Korrektur-Berechnung, Crosswind-Landing-Score.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `AMBIENT TEMPERATURE` | celsius | FLOAT64 | -55 | Cruise-Anzeige |
| `AMBIENT PRESSURE` | inhg | FLOAT64 | 5.5 | Performance |
| `AMBIENT WIND VELOCITY` | knots | FLOAT64 | 45 | Wind-Anzeige |
| `AMBIENT WIND DIRECTION` | degrees | FLOAT64 | 270 | Wind-Anzeige |
| `AMBIENT VISIBILITY` | meters | FLOAT64 | 10000 | Approach-Difficulty |
| `BAROMETER PRESSURE` | millibars | FLOAT64 | 1013 | QNH |
| `KOHLSMAN SETTING HG` | inhg | FLOAT64 | 29.92 | Pilot-Setting |
| `SEA LEVEL PRESSURE` | millibars | FLOAT64 | 1013 | Calc-Reference |

**Crosswind-Berechnung:** `Crosswind = WindSpeed * sin(WindDirection - RunwayHeading)`

---

## 8. Surface & Approach

**Verwendung:** Stable-Approach-Score, Touchdown-Quality, Runway-Detection.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `SURFACE TYPE` | enum | INT32 | 0 (concrete) | Runway-Type |
| `ON ANY RUNWAY` | bool | INT32 | 1 | Approach-Detection |
| `RUNWAY DISTANCE FROM START` | feet | FLOAT64 | 5000 | Touchdown-Position |
| `NAV GLIDE SLOPE` | degrees | FLOAT64 | 3.0 | ILS-Glide-Slope |
| `NAV LOCALIZER` | degrees | FLOAT64 | 0.5 | Lateral-Deviation |
| `NAV GS ERROR` | degrees | FLOAT64 | 0.1 | Glide-Slope-Error |
| `NAV GLIDE SLOPE ERROR` | degrees | FLOAT64 | 0.1 | Approach-Stability |

**Stable-Approach-Definition (Industry-Standard):**

Bei 1000 ft AGL muss das Flugzeug:
1. On glide slope sein (±1 dot deviation)
2. On localizer sein (±1 dot deviation)
3. Korrekte Geschwindigkeit haben (Vref +5/-0 kts)
4. Konfiguriert sein für Landing (Flaps + Gear)
5. Power-Setting stable sein
6. Vertical Speed < 1000 fpm

→ Score-Berechnung im PIREP basiert darauf.

---

## 9. Aircraft Identification

**Verwendung:** Aircraft-Type-Logging, Livery-Recognition, Pirep-Aircraft-Match.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `TITLE` | string | STRING256 | "Asobo A320 Lufthansa" | Logging |
| `ATC TYPE` | string | STRING32 | "Airbus" | PIREP |
| `ATC MODEL` | string | STRING32 | "A320" | PIREP |
| `ATC ID` | string | STRING32 | "D-AIZA" | Tail-Number |
| `ATC AIRLINE` | string | STRING32 | "Lufthansa" | Airline |
| `ATC FLIGHT NUMBER` | string | STRING8 | "LH123" | Callsign |
| `ATC HEAVY` | bool | INT32 | 1 | Wake-Turbulence |

---

## 10. Time & System

**Verwendung:** Sim-Time-Logging (vs. Real-Time), Flight-Replay, Anti-Time-Acceleration.

| SimVar | Einheit | Typ | Beispiel | Verwendung |
|---|---|---|---|---|
| `LOCAL TIME` | seconds | FLOAT64 | 43200 | Block-Time |
| `ZULU TIME` | seconds | FLOAT64 | 39600 | UTC |
| `SIMULATION RATE` | number | FLOAT64 | 1.0 | Cheating-Detection |
| `IS PAUSED` | bool | INT32 | 0 | PIREP-Quality |

**Time-Acceleration-Detection:** Wenn `SIMULATION RATE > 1.0` während Flight → PIREP-Flag (manche VAs lehnen ab).

---

## 11. Phase Detection (kombinierte Logic)

**Industry-Standard Phasen** (aus vmsACARS PDK):

```
PIREP-States:
  Pushback        — Beacon on, Engines off, on Ground, moving backwards
  Taxi            — Engines on, on Ground, moving forward
  Takeoff         — On runway, throttle > 60%, accelerating
  Climb           — In air, vertical speed > 500 fpm
  Cruise          — Stable altitude, AP altitude lock
  Descent         — In air, vertical speed < -500 fpm
  Approach        — Within 30nm of arrival, gear down or flaps > 0
  Landing         — Touchdown detected (on ground after airborne)
  Taxi-In         — On ground, engines on, moving forward, after landing
  Block-On        — Parking brake set, engines off
```

### Detection-Algorithmus (Pseudo-Code)

```typescript
function detectPhase(prev: Phase, telemetry: SimData): Phase {
  // Block-On hat höchste Priorität
  if (telemetry.parkingBrake && !telemetry.engineOn && telemetry.onGround) {
    return 'Block-On';
  }
  
  // On-Ground-Logic
  if (telemetry.onGround) {
    if (!telemetry.engineOn) return prev === 'Taxi-In' ? 'Block-On' : 'Pre-Flight';
    if (telemetry.groundSpeed < 5) {
      return prev === 'Landing' ? 'Taxi-In' : 'Pushback';
    }
    if (telemetry.throttlePercent > 60) return 'Takeoff';
    return prev === 'Touchdown' ? 'Taxi-In' : 'Taxi';
  }
  
  // Airborne-Logic
  if (telemetry.verticalSpeed > 500) return 'Climb';
  if (telemetry.verticalSpeed < -500) {
    if (telemetry.distanceToArrival < 30 && (telemetry.gearDown || telemetry.flapsPercent > 10)) {
      return 'Approach';
    }
    return 'Descent';
  }
  
  // Cruise: stabil, AP-locked
  if (telemetry.autopilotAltLock && Math.abs(telemetry.verticalSpeed) < 200) {
    return 'Cruise';
  }
  
  return prev; // Keep previous phase
}
```

### Phase-Transition-Events

Bei jedem Phase-Wechsel: Event loggen mit Timestamp + Position. Diese Events sind später die **Marker** im Vertical-Profile-Diagram.

---

## 12. X-Plane Equivalents (XPLM Datarefs)

Für X-Plane-Support: gleiche Konzepte, andere API. Mapping-Tabelle für die wichtigsten:

| SimConnect (MSFS/P3D) | XPLM Dataref (X-Plane) |
|---|---|
| `PLANE LATITUDE` | `sim/flightmodel/position/latitude` |
| `PLANE LONGITUDE` | `sim/flightmodel/position/longitude` |
| `PLANE ALTITUDE` | `sim/flightmodel/position/elevation` |
| `AIRSPEED INDICATED` | `sim/flightmodel/position/indicated_airspeed` |
| `GROUND VELOCITY` | `sim/flightmodel/position/groundspeed` |
| `VERTICAL SPEED` | `sim/flightmodel/position/vh_ind_fpm` |
| `PLANE HEADING DEGREES TRUE` | `sim/flightmodel/position/true_psi` |
| `SIM ON GROUND` | `sim/flightmodel/failures/onground_any` |
| `ENG N1 RPM:1` | `sim/cockpit2/engine/indicators/N1_percent[0]` |
| `FUEL TOTAL QUANTITY` | `sim/flightmodel/weight/m_fuel_total` |
| `FLAPS HANDLE INDEX` | `sim/flightmodel/controls/flaprat` |
| `GEAR POSITION:0` | `sim/cockpit2/controls/gear_handle_down` |
| `AUTOPILOT MASTER` | `sim/cockpit2/autopilot/autopilot_mode` |

**Implementation:** Eigener X-Plane-Plugin (XPLM-DLL/SO) der diese Datarefs liest und an dieselbe ACARS-API schickt wie der MSFS-Client. Output-Schema bleibt identisch.

---

## 13. Empfehlungen für VAM

### Must-Have (für aktuelles Live-Tracking)

Die **Minimum-Set** die das aktuelle System schon nutzt — ACARS muss diese liefern damit kompatibel:

```
Position:        latitude, longitude, altitude, heading
Speed:           groundSpeed (in knots)
State:           onGround
Identification:  callsign, aircraftType, registration
Flight-Plan:     departureIcao, arrivalIcao, alternate, cruiseAlt
```

→ Reicht für Live-Map und OBS-Overlay-Phase 3.

### Should-Have (für PIREP-Analyse-Page)

Zusätzliche Felder die richtig coole Pirep-Analyse-Visualisierung erlauben:

```
Speed:           indicatedAirspeed, mach, verticalSpeed
Engine:          n1Percent (avg), fuelFlowPPH
Fuel:            totalFuelKg
Aircraft:        flapsPercent, gearPosition, parkingBrake
Approach:        glideSlopeError, localizerError, radioHeight
G-Force:         gForce (für Hard-Landing)
Attitude:        pitch, bank
Phase:           currentPhase (computed)
Wind:            windSpeed, windDirection
Misc:            simRate (für Cheat-Detection), autopilotMaster
```

→ Reicht für vAMSYS-Pegasus-äquivalente Pirep-Pages.

### Nice-to-Have (Power-Features)

Für Premium-Streamer-Features oder detaillierte Debriefs:

```
Engine-Detail:   per Engine N1, N2, EGT, Oil-Temp, Fuel-Flow
Lights:          alle Light-States (für Pre-Flight-Check)
Spoilers:        spoilerPercent, spoilerArmed
ATC:             flightNumber, atcModel
Environment:     ambientTemp, ambientPressure
System:          accelerationBodyX/Y/Z (für Smoothness-Score)
NAV:             navFreq, comFreq (für ATC-Integration)
```

→ Erlaubt Realismus-Score, ATC-Integration, Premium-Debriefs.

---

## 14. Empfohlenes Heartbeat-Payload

### Frequenz

| Phase | Heartbeat-Rate | Begründung |
|---|---|---|
| Pre-Flight / Block-On | 10s | Wenig passiert |
| Taxi / Pushback | 2s | User-Wahrnehmung |
| Takeoff / Landing | 1s | Critical Phase, Smooth Trail |
| Climb / Cruise / Descent | 2s | Standard |
| Approach | 1s | Critical Phase |

**Adaptiv:** Client bestimmt selbst basierend auf Phase, schickt mit jedem Heartbeat die aktuelle Frequenz mit.

### Payload-Struktur (JSON, ~3-5 KB pro Heartbeat)

```typescript
interface AcarsHeartbeat {
  // Meta
  timestamp: string;              // ISO 8601 UTC
  clientVersion: string;          // "vam-acars-1.0.0"
  simulator: 'MSFS' | 'P3D' | 'XPLANE';
  sessionId: string;              // UUID, eindeutig pro Flight
  
  // Phase
  phase: 'PreFlight' | 'Pushback' | 'Taxi' | 'Takeoff' | 
         'Climb' | 'Cruise' | 'Descent' | 'Approach' | 
         'Landing' | 'TaxiIn' | 'BlockOn';
  phaseTransition: boolean;       // True wenn Phase grad gewechselt
  
  // Position
  position: {
    latitude: number;             // degrees
    longitude: number;            // degrees
    altitudeFt: number;           // feet MSL
    altitudeAglFt: number;        // feet AGL (Radio-Height bei <2500ft)
    headingTrue: number;          // degrees
    headingMagnetic: number;      // degrees
    pitch: number;                // degrees
    bank: number;                 // degrees
  };
  
  // Speed
  speed: {
    indicatedKts: number;         // IAS
    trueKts: number;              // TAS
    groundKts: number;            // Ground Speed
    mach: number;                 // 0.0-1.0
    verticalFpm: number;          // ft/min
  };
  
  // Aircraft State
  state: {
    onGround: boolean;
    parkingBrake: boolean;
    flapsPercent: number;         // 0-100
    gearDown: boolean;
    spoilersDeployed: boolean;
    spoilersArmed: boolean;
    autopilotMaster: boolean;
    stallWarning: boolean;
    overspeedWarning: boolean;
  };
  
  // Engines (Array, eine Entry pro Engine)
  engines: Array<{
    running: boolean;
    n1Percent: number;
    n2Percent: number;
    fuelFlowPph: number;
    egtCelsius: number;
    throttlePercent: number;
    reverseThrust: boolean;
  }>;
  
  // Fuel
  fuel: {
    totalLbs: number;
    totalKg: number;              // Convenience
    flowPph: number;              // Total
  };
  
  // Forces
  forces: {
    gForce: number;               // 1.0 = stable
    accelerationX: number;
    accelerationY: number;
    accelerationZ: number;
  };
  
  // Environment
  environment: {
    ambientTempC: number;
    ambientPressureMb: number;
    windSpeedKts: number;
    windDirection: number;
    visibilityM: number;
  };
  
  // Approach (nur wenn relevant)
  approach?: {
    glideSlopeErrorDeg: number;
    localizerErrorDeg: number;
    onGlideSlope: boolean;        // ±1 dot
    onLocalizer: boolean;         // ±1 dot
  };
  
  // Aircraft Identification (1× initial, dann nicht mehr)
  aircraft?: {
    title: string;                // "Asobo A320 Lufthansa"
    type: string;                 // "Airbus"
    model: string;                // "A320"
    registration: string;         // "D-AIZA"
    flightNumber: string;         // "LH123"
  };
  
  // Misc
  simRate: number;                // 1.0 = real-time, 2.0 = 2x speed (Cheat-Flag)
  paused: boolean;
}
```

### Touchdown-Event (separater Payload)

Bei detektiertem Touchdown (`SIM ON GROUND` von 0 auf 1 wechselt) zusätzliches Event:

```typescript
interface TouchdownEvent {
  timestamp: string;
  position: { latitude, longitude };
  airport: string;                // ICAO falls auf Runway
  runway: string;                 // "07L" falls erkannt
  
  // Touchdown-Quality
  verticalSpeedFpm: number;       // -200 = sanft, -800 = hart, -1500 = damage
  gForceAtTouchdown: number;
  pitchAtTouchdown: number;
  bankAtTouchdown: number;
  groundSpeedKts: number;
  
  // Approach-Stability (gemessen über letzten 30s)
  approachStable: boolean;
  glideSlopeDeviation: number;    // Average
  localizerDeviation: number;     // Average
}
```

### Block-On-Event (PIREP-Trigger)

Bei detektiertem Block-On (Engines off + Parking-Brake set):

```typescript
interface BlockOnEvent {
  timestamp: string;
  position: { latitude, longitude };
  airport: string;
  
  // Flight Summary
  blockTime: number;              // minutes (Pushback → Block-On)
  flightTime: number;             // minutes (Takeoff → Touchdown)
  taxiOutTime: number;            // minutes
  taxiInTime: number;             // minutes
  
  // Stats
  fuelBurnedKg: number;
  maxAltitudeFt: number;
  cruiseAltitudeFt: number;
  totalDistanceNm: number;
  
  // Quality
  maxGForce: number;
  hardLandings: number;           // count of touchdowns >800fpm
  overspeedEvents: number;
  stallEvents: number;
  
  // Phase-Markers (für Pirep-Visualisierung)
  phaseMarkers: Array<{
    phase: string;
    enteredAt: string;            // timestamp
    durationSec: number;
  }>;
}
```

→ Bei diesem Event: Server generiert PIREP automatisch (User reviewt vor Submit).

---

## 15. Anti-Cheat-Detection

vAMSYS Pegasus und vmsACARS haben Mechanismen gegen Cheaten. Was wir auch implementieren sollten:

```
Time-Acceleration-Check:    SIMULATION RATE > 1.0 = flag PIREP
Pause-Time-Tracking:        IS PAUSED = 1 → Pause-Counter erhöhen
                            (>10% Pause-Zeit = Reject)
Position-Jump-Detection:    Plötzlicher Sprung > 50nm in <30s = Slewing
Replay-Detection:           Aircraft-Title contains "Replay" oder Telemetrie 
                            wiederholt sich exakt
Realistic-Times:            Block-Time muss > Flight-Time sein
                            Taxi-Out + Taxi-In < 60min für meiste Flughäfen
Network-Online-Check:       VATSIM/IVAO-Datafeed checken: war Pilot wirklich
                            online während des Fluges? (Match auf vatsimCid)
```

---

## 16. Zukunfts-Erweiterungen

### Phase 9+ Ideen die SimConnect-Daten ermöglichen

```
Stable Approach Score
  → Berechnet aus Glide-Slope + Localizer + Speed-Stability + Configuration
  → 0-100 Score
  → Anzeige im PIREP-Detail
  
Smooth Pilot Score
  → Berechnet aus G-Force-Variation + Bank-Variation + Pitch-Variation
  → "Wie ruhig fliegt der Pilot"
  → 0-100 Score, vergleichbar mit anderen Pilots
  
Fuel Efficiency Score
  → Berechnet aus Actual-Fuel-Burn vs. SimBrief-Planned
  → Anzeige: "5% effizienter als geplant"
  
Realism Score
  → Engine-Start-Sequence korrekt? (APU before Engine, etc.)
  → Lights in richtiger Reihenfolge?
  → Flaps in correct positions per phase?
  → "Realismus 87/100"
  
Heatmap aller Pilots
  → Aggregation aller PIREPs: wo wird am meisten geflogen?
  → Aggregation aller Touchdown-Spots: welche Runways
  
ATC-Integration
  → SimConnect liefert COM/NAV-Frequenzen
  → Match gegen VATSIM-ATC-Stationen
  → "Du warst auf 119.0 mit FRA_TWR"
```

---

## Notizen für Implementation

### Polling-Strategy

```
Statt jeden Heartbeat alle 30+ Variablen neu zu requesten:
  → SimConnect "Data Definition" einmal definieren
  → "RequestDataOnSimObject" einmal mit DEFINITION_FREQUENCY_VISUAL_FRAME
  → SimConnect pushed automatisch bei jedem Frame
  → Effizienter als Polling
```

### Caching

```
Aircraft-Identifikation (Title, Model, etc.) ändert sich NICHT während Flight:
  → 1× am Anfang lesen, dann cachen
  → Spart Network-Bandbreite
```

### Reconnect-Logic

```
Wenn SimConnect-Verbindung verloren:
  → Erkennen via Timeout (kein Frame > 5s)
  → ACARS-Client wartet, versucht Reconnect alle 10s
  → Server-Side: LiveSession bleibt 60s aktiv, dann auto-inactive
  → User-Notification: "Verbindung verloren, Auto-Reconnect..."
```

### Crash-Recovery

```
Sim crashed mitten im Flight:
  → ACARS-Client merkt: kein Frame mehr
  → Lokale Flight-Data ist gespeichert (SQLite)
  → Bei Sim-Neustart: User wird gefragt "Flight fortsetzen?"
  → Wenn ja: Heartbeats senden mit Resume-Flag
  → Server: LiveSession reaktivieren oder neue erstellen
```

---

## Open Questions

- [ ] Soll SimConnect-Polling auf 5 Hz limitiert werden (für Server-Last), oder dynamisch je Phase?
- [ ] Welche Engine-Details kommen ins Live-Overlay (sichtbar) vs. nur ins Pirep (gespeichert)?
- [ ] Soll der ACARS-Client eine lokale SQLite-DB für Crash-Recovery haben?
- [ ] Wie identifizieren wir die Runway beim Touchdown? (`RUNWAY DISTANCE FROM START` braucht ATC-Data)
- [ ] X-Plane-Support: eigener Plugin oder XPUIPC-Bridge?
- [ ] Welche Datenpunkte sind kritisch für Anti-Cheat?

→ Diese Fragen klären sich beim ACARS-Implementation-Start (Phase 8).

---

## Referenzen

- [MSFS 2024 SimVars Index](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Simulation_Variables.htm)
- [SimConnect API Reference](https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimConnect/SimConnect_API_Reference.htm)
- [node-simconnect (npm)](https://www.npmjs.com/package/node-simconnect)
- [vmsACARS Plugin SDK](https://github.com/phpvms/acars-pdk)
- [FsConnect (C#)](https://github.com/c-true/FsConnect)
- [X-Plane Datarefs Reference](https://developer.x-plane.com/datarefs/)
- [DisposableBasic phpVMS Module](https://github.com/FatihKoz/DisposableBasic) (Pirep-Score-Inspiration)
