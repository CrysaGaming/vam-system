import type { LiveSessionPosition, LiveSession } from "@prisma/client";
import { prisma } from "../index.js";

/**
 * Track 1 #5 (Replay-Mode, 9.2.7) — Read-side queries für PIREP-replay.
 *
 * Replays animieren den trail eines abgeschlossenen flugs auf einer
 * mapbox-map. Die per-frame-positions werden während des fluges in
 * LiveSessionPosition gespeichert (vom VATSIM/IVAO/ACARS-tracker im
 * bot). Beim PIREP-replay holen wir die positions der zugehörigen
 * LiveSession und reichen sie als geo-trail durch.
 *
 * # PIREP → LiveSession matching
 *
 * Es gibt zwei pfade:
 *
 * **Pfad 1 — ACARS-auto-trigger (sauber):**
 * Wenn der PIREP von einem ACARS-BLOCK_ON-event auto-erstellt wurde,
 * existiert eine AcarsEvent-row mit triggeredPirepId === pirep.id.
 * Dieser AcarsEvent hat die session-FK, also haben wir direct den
 * exakten match. Kein heuristik, kein guessing.
 *
 * **Pfad 2 — manueller PIREP (heuristik):**
 * Bei VATSIM/IVAO oder hand-eingereichten PIREPs gibt es keine
 * triggering-event. Wir matchen heuristisch:
 *   - Selber userId
 *   - departureIcao + arrivalIcao matchen (über Airport-relation)
 *   - LiveSession.lastUpdatedAt liegt im fenster
 *     [pirep.submittedAt - 24h, pirep.submittedAt + 1h]
 * Das ist nicht perfekt — wenn der user mehrere flüge mit derselben
 * route am selben tag gemacht hat, kriegt er den letzten (meist der
 * richtige weil PIREP gleich nach landing eingereicht wird). Bei
 * ambiguity zeigt die UI einen warning ("approximative match").
 *
 * # Position-shape
 *
 * LiveSessionPosition enthält basics (lat/lng/alt/gs/hdg/onGround) plus
 * optional ACARS-extensions (altitudeAglFt, indicatedAirspeed, vsi,
 * pitch, bank, flapsPercent, gearDown, phase). Wir geben alles durch
 * — die replay-UI kann optionale fields conditional rendern.
 *
 * # Performance
 *
 * Eine 1h-flug-session mit 1Hz-ACARS-positions hat ~3600 datenpunkte.
 * Das ist groß genug dass wir es nicht in die initial-page-render
 * bundeln wollen — der replay-page-loader macht erst einen
 * has-replay-check (cheap), dann lädt die client-component die
 * positions via API-route on-mount. Server-side rendering der page
 * bleibt fast.
 *
 * Bei VATSIM/IVAO 30s-polling sind es nur ~120 positions/h — auch
 * inline tragbar, aber der API-route-pattern bleibt konsistent.
 */

/**
 * Vollständige replay-data für eine PIREP. positions ist sortiert nach
 * recordedAt ascending (chronologisch — anfang fluges zuerst).
 *
 * Departure/arrival-coords kommen aus den Airport-relations des PIREPs
 * (nicht aus den positions) damit wir solide map-anchors haben auch
 * wenn der trail kurz ist.
 *
 * matchType signalisiert dem UI ob der match exact (acars) oder
 * heuristisch war — bei "heuristic" zeigt die UI einen kleinen warning.
 */
export type ReplayData = {
  available: true;
  matchType: "acars" | "heuristic";
  sessionId: string;
  sessionInfo: {
    network: LiveSession["network"];
    callsign: string;
    aircraftType: string | null;
    aircraftRegistration: string | null;
    connectedAt: Date;
    lastUpdatedAt: Date;
  };
  departure: {
    icao: string;
    name: string;
    latitude: number;
    longitude: number;
  };
  arrival: {
    icao: string;
    name: string;
    latitude: number;
    longitude: number;
  };
  positions: LiveSessionPosition[];
};

export type ReplayDataMissing = {
  available: false;
  reason:
    | "pirep-not-found"
    | "no-matching-session"
    | "session-has-no-positions";
};

export type ReplayDataResult = ReplayData | ReplayDataMissing;

/**
 * Findet replay-data für einen PIREP. Try acars-link first, fall back
 * auf heuristic-match. Returns null-shape mit reason wenn nichts
 * matched ODER die matching session keine positions hat.
 */
export async function findReplayDataForPirep(
  pirepId: string,
): Promise<ReplayDataResult> {
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      departure: {
        select: { icao: true, name: true, latitude: true, longitude: true },
      },
      arrival: {
        select: { icao: true, name: true, latitude: true, longitude: true },
      },
      triggeringEvent: {
        select: { sessionId: true },
      },
    },
  });
  if (!pirep) return { available: false, reason: "pirep-not-found" };

  // ─── Pfad 1: ACARS-auto-trigger ─────────────────────────────────
  let session: LiveSession | null = null;
  let matchType: ReplayData["matchType"] = "heuristic";

  if (pirep.triggeringEvent) {
    session = await prisma.liveSession.findUnique({
      where: { id: pirep.triggeringEvent.sessionId },
    });
    if (session) {
      matchType = "acars";
    }
    // Falls die session gelöscht wurde (cascade über AcarsEvent ist
    // SetNull, also kann der lookup leer kommen), fallen wir auf
    // heuristic durch.
  }

  // ─── Pfad 2: heuristic-match ────────────────────────────────────
  if (!session) {
    // Zeitfenster: lastUpdatedAt zwischen [submittedAt - 24h, submittedAt + 1h]
    // Der user reicht meist binnen einer stunde nach landing ein, manchmal
    // später am selben tag wenn er den batch-flow nutzt. 24h backward gibt
    // genug spielraum auch für lazy-submitter.
    const submittedMs = pirep.submittedAt.getTime();
    const minUpdatedAt = new Date(submittedMs - 24 * 60 * 60 * 1000);
    const maxUpdatedAt = new Date(submittedMs + 60 * 60 * 1000);

    session = await prisma.liveSession.findFirst({
      where: {
        userId: pirep.userId,
        departureIcao: pirep.departure.icao,
        arrivalIcao: pirep.arrival.icao,
        lastUpdatedAt: { gte: minUpdatedAt, lte: maxUpdatedAt },
      },
      orderBy: { lastUpdatedAt: "desc" },
    });
  }

  if (!session) {
    return { available: false, reason: "no-matching-session" };
  }

  // Positions laden (sorted asc by recordedAt)
  const positions = await prisma.liveSessionPosition.findMany({
    where: { sessionId: session.id },
    orderBy: { recordedAt: "asc" },
  });

  if (positions.length === 0) {
    return { available: false, reason: "session-has-no-positions" };
  }

  return {
    available: true,
    matchType,
    sessionId: session.id,
    sessionInfo: {
      network: session.network,
      callsign: session.callsign,
      aircraftType: session.aircraftType,
      aircraftRegistration: session.aircraftRegistration,
      connectedAt: session.connectedAt,
      lastUpdatedAt: session.lastUpdatedAt,
    },
    departure: pirep.departure,
    arrival: pirep.arrival,
    positions,
  };
}

/**
 * Cheap-check ob ein PIREP eine replay-data hat, ohne die positions
 * zu materialisieren. Nutze diesen helper im server-component der
 * pirep-detail-page um den "Play Flight"-button conditional zu rendern.
 *
 * Implementiert als slim-version von findReplayDataForPirep: gleicher
 * matching-logic, aber ohne positions-fetch — am ende count check ob
 * positions > 0.
 */
export async function hasReplayDataForPirep(pirepId: string): Promise<boolean> {
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: {
      userId: true,
      submittedAt: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      triggeringEvent: { select: { sessionId: true } },
    },
  });
  if (!pirep) return false;

  let sessionId: string | null = pirep.triggeringEvent?.sessionId ?? null;

  if (!sessionId) {
    const submittedMs = pirep.submittedAt.getTime();
    const minUpdatedAt = new Date(submittedMs - 24 * 60 * 60 * 1000);
    const maxUpdatedAt = new Date(submittedMs + 60 * 60 * 1000);

    const session = await prisma.liveSession.findFirst({
      where: {
        userId: pirep.userId,
        departureIcao: pirep.departure.icao,
        arrivalIcao: pirep.arrival.icao,
        lastUpdatedAt: { gte: minUpdatedAt, lte: maxUpdatedAt },
      },
      orderBy: { lastUpdatedAt: "desc" },
      select: { id: true },
    });
    sessionId = session?.id ?? null;
  }

  if (!sessionId) return false;

  const count = await prisma.liveSessionPosition.count({
    where: { sessionId },
  });
  return count > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Phase-breakdown aggregation (Track 4 #2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Per-phase aggregation eines flights — wie viel zeit wurde in jeder
 * phase verbracht. Used by the PIREP-detail-page Phase-Breakdown-Bar
 * (Track 4 option #2).
 *
 * # Approximation: positionCount × samplerate ≈ time
 *
 * LiveSessionPositions werden in einem (annähernd) konstanten interval
 * gespeichert (ACARS ~1Hz, VATSIM ~30s, IVAO ~30s). Die count-of-
 * positions PRO PHASE ist also direkt proportional zu der zeit in der
 * phase. Wir nutzen das für den breakdown-bar:
 *
 *   percent = phase.positionCount / totalCount × 100
 *
 * Für absolute zeit-anzeige (z.B. "Cruise: 42min") multiplizieren wir
 * den percent mit der gesamt-session-dauer (lastPosition - firstPosition).
 * Das ist eine schätzung — wenn der sample-rate während des fluges
 * variiert (z.B. ACARS-disconnect für 5min), wird die schätzung etwas
 * verzerrt. Für die breakdown-visualisierung gut genug; für audit-
 * accurate stundenzählung nicht geeignet.
 *
 * # Phase=null filtering
 *
 * VATSIM/IVAO-tracker haben für viele early-session positions phase=null
 * (low-fidelity-detector kann erst phase setzen wenn altitude/gs-signal
 * stabil ist). Diese null-positions excluden wir aus dem breakdown —
 * sonst sieht der bar aus wie 90% "Unknown". Side-effect: der percent-
 * total bleibt 100% nur über die KNOWN-phases — interpretiere den bar
 * als "der phasen-anteil unter den klassifizierten positions".
 *
 * # Returns null wenn
 *
 *   - PIREP existiert nicht
 *   - Keine matching session (heuristic-match scheitert)
 *   - Session hat keine positions
 *   - Alle positions haben phase=null
 *
 * Caller renders die UI dann conditional ("zeige bar nur wenn data da").
 */
export type PhaseBreakdown = {
  totalDurationMs: number;
  totalPositionCount: number;
  phases: {
    phase: string;
    positionCount: number;
    /** 0..100, summe aller phases ergibt 100 */
    percent: number;
    /** Schätzung basierend auf percent * totalDurationMs */
    estDurationMs: number;
  }[];
};

/**
 * Canonical phase-ordering — used to sort the breakdown-bar segments.
 * Matches the FlightPhase ordering in @vam/shared/acars/phase-detection.
 * Duplicating the array here statt @vam/shared zu importieren um die
 * @vam/db package-graph clean zu halten (db hat aktuell keine direkte
 * @vam/shared-dependency).
 */
const PHASE_ORDER = [
  "PreFlight",
  "Pushback",
  "Taxi",
  "Takeoff",
  "Climb",
  "Cruise",
  "Descent",
  "Approach",
  "Landing",
  "TaxiIn",
  "BlockOn",
];

export async function getPirepPhaseBreakdown(
  pirepId: string,
): Promise<PhaseBreakdown | null> {
  // Same matching-logic wie hasReplayDataForPirep — ACARS-trigger zuerst,
  // dann heuristic-fallback. Wenn die match-logic je auf einen shared-
  // helper extracted wird, sollte dieser hier auch dieselbe quelle nutzen.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: {
      userId: true,
      submittedAt: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      triggeringEvent: { select: { sessionId: true } },
    },
  });
  if (!pirep) return null;

  let sessionId: string | null = pirep.triggeringEvent?.sessionId ?? null;
  if (!sessionId) {
    const submittedMs = pirep.submittedAt.getTime();
    const minUpdatedAt = new Date(submittedMs - 24 * 60 * 60 * 1000);
    const maxUpdatedAt = new Date(submittedMs + 60 * 60 * 1000);
    const session = await prisma.liveSession.findFirst({
      where: {
        userId: pirep.userId,
        departureIcao: pirep.departure.icao,
        arrivalIcao: pirep.arrival.icao,
        lastUpdatedAt: { gte: minUpdatedAt, lte: maxUpdatedAt },
      },
      orderBy: { lastUpdatedAt: "desc" },
      select: { id: true },
    });
    sessionId = session?.id ?? null;
  }
  if (!sessionId) return null;

  // Two parallel aggregates — group-by-phase + session-boundary.
  // group-by gives uns die phase-counts; aggregate gives die total
  // wall-clock-dauer der session. Daraus berechnen wir die percent
  // und die approximate-duration pro phase.
  const [groups, boundary] = await Promise.all([
    prisma.liveSessionPosition.groupBy({
      by: ["phase"],
      where: { sessionId, phase: { not: null } },
      _count: true,
    }),
    prisma.liveSessionPosition.aggregate({
      where: { sessionId },
      _min: { recordedAt: true },
      _max: { recordedAt: true },
    }),
  ]);

  if (groups.length === 0) return null;

  const totalCount = groups.reduce((a, g) => a + g._count, 0);
  if (totalCount === 0) return null;

  const totalDurationMs =
    boundary._max.recordedAt && boundary._min.recordedAt
      ? boundary._max.recordedAt.getTime() -
        boundary._min.recordedAt.getTime()
      : 0;

  const phases = groups.map((g) => {
    const percent = (g._count / totalCount) * 100;
    return {
      phase: g.phase ?? "Unknown",
      positionCount: g._count,
      percent,
      estDurationMs: totalDurationMs * (percent / 100),
    };
  });

  // Canonical sort — falls ein unknown-phase auftaucht (zukünftige
  // erweiterung der FlightPhase-enum), landet es am ende durch -1
  // indexOf-fallback.
  phases.sort((a, b) => {
    const aIdx = PHASE_ORDER.indexOf(a.phase);
    const bIdx = PHASE_ORDER.indexOf(b.phase);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  return {
    totalDurationMs,
    totalPositionCount: totalCount,
    phases,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Approach-Analysis (Track 4 #5)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Approach-Analysis aggregates die "wie war der approach" metrics aus
 * dem position-trail. Used by the PIREP-detail-page Approach-Analysis-
 * Section (Track 4 option #5).
 *
 * # Drei metrics
 *
 * 1. **iasAt1000ft** — IAS bei der position deren altitudeAglFt am
 *    nächsten zu 1000ft ist (klassischer stabilized-approach gate).
 *    Generic thresholds: typical narrowbody Vapp ~130-150kt, regional
 *    ~110-130kt, widebody ~140-160kt. Wir flaggen NICHT als pass/fail
 *    weil das aircraft-spezifisch ist — der pilot/admin sieht die zahl
 *    und interpretiert selbst.
 *
 * 2. **glideslopeQuality** — % of approach-positions die innerhalb
 *    ±300ft des standard 3° glideslopes lagen. Approach-fenster: alle
 *    positions mit altitudeAglFt zwischen 50ft und 3000ft (= ~10nm bei
 *    3°). Bei jeder position berechnen wir expected_aglFt = distance_nm
 *    × 318ft (3° = tan(3°) × 6076ft/nm ≈ 318ft/nm), vergleichen mit
 *    actual und zählen pass/fail.
 *
 * 3. **stabilizationScore** — % of positions im final-approach-fenster
 *    (1000ft → 50ft AGL) die alle drei stability-criteria gepasst
 *    haben:
 *      - VSI zwischen -1100 und -300 fpm (descending aber nicht crash)
 *      - bank zwischen ±30° (kein excessive maneuvering)
 *      - pitch zwischen ±10° (no excessive pitch up/down)
 *
 * # Distance computation
 *
 * Haversine-formel zwischen position und arrival-airport. flat-earth
 * approximation würde bei 50nm-final ~0.4% off, akzeptabel — aber
 * haversine ist trivial und wir haben die coords parat.
 *
 * # Returns null wenn
 *
 *   - PIREP existiert nicht oder keine session matched
 *   - Keine positions mit altitudeAglFt im approach-fenster
 *   - Keine arrival-coords (sollte nie passieren da arrival required)
 *
 * # Caveat: 3° glideslope assumption
 *
 * Standard-glideslope ist 3° für die meisten ILS-approaches, aber:
 *   - LDA/visual approaches können andere angles haben
 *   - Steep-approach-airports (z.B. EGLC London City: 5.5°) würden
 *     hier "zu hoch" flaggen obwohl der pilot korrekt geflogen ist
 *
 * Future-improvement: per-runway glideslope-angle aus AIP-data oder
 * SimBrief-OFP holen. Für v1 akzeptabel — die meisten flüge sind 3°.
 */
export type ApproachAnalysis = {
  /** IAS in knots bei der position closest to 1000ft AGL. null wenn keine AGL-data. */
  iasAt1000ft: number | null;
  /** Actual AGL altitude der gewählten position (zur transparency). */
  agAtIasMeasurement: number | null;

  /** Glideslope-quality: 0..100 = % positions within ±300ft of 3° slope */
  glideslopeQualityPercent: number | null;
  /** Sample-count behind glideslopeQualityPercent (für caller-confidence). */
  glideslopeSampleCount: number;

  /** Stabilization-score: 0..100 = % of final-1000ft positions that passed all 3 criteria */
  stabilizationScorePercent: number | null;
  /** Sample-count behind stabilizationScorePercent. */
  stabilizationSampleCount: number;
};

/**
 * Haversine-distance in nautical miles.
 *
 * lat/lng inputs in degrees. nm-output (1 nm ≈ 1.852 km, earth-radius
 * 6371 km × 0.539957 nm/km).
 */
function haversineNm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R_NM = 3440.065; // earth radius in nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

export async function getPirepApproachAnalysis(
  pirepId: string,
): Promise<ApproachAnalysis | null> {
  // Match session — selber pattern wie hasReplayDataForPirep + phaseBreakdown
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: {
      userId: true,
      submittedAt: true,
      arrival: {
        select: { icao: true, latitude: true, longitude: true },
      },
      departure: { select: { icao: true } },
      triggeringEvent: { select: { sessionId: true } },
    },
  });
  if (!pirep) return null;

  let sessionId: string | null = pirep.triggeringEvent?.sessionId ?? null;
  if (!sessionId) {
    const submittedMs = pirep.submittedAt.getTime();
    const minUpdatedAt = new Date(submittedMs - 24 * 60 * 60 * 1000);
    const maxUpdatedAt = new Date(submittedMs + 60 * 60 * 1000);
    const session = await prisma.liveSession.findFirst({
      where: {
        userId: pirep.userId,
        departureIcao: pirep.departure.icao,
        arrivalIcao: pirep.arrival.icao,
        lastUpdatedAt: { gte: minUpdatedAt, lte: maxUpdatedAt },
      },
      orderBy: { lastUpdatedAt: "desc" },
      select: { id: true },
    });
    sessionId = session?.id ?? null;
  }
  if (!sessionId) return null;

  // Approach-fenster: positions mit altitudeAglFt ≤ 3000ft. Das deckt
  // sowohl die glideslope-window (50-3000ft AGL) als auch den final-
  // 1000ft-window für stabilization. Cap bei 3000ft damit wir nicht
  // den ganzen descent von cruise-altitude laden.
  //
  // Auch filter on arrival-side: nur positions in den letzten 30min vor
  // session-end. Bei round-trip-flights würde der departure-takeoff
  // sonst auch als "approach" miscount werden (er ist auch < 3000 AGL).
  // 30min ist großzügig genug für lange final-approaches.
  const sessionEnd = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: { lastUpdatedAt: true },
  });
  if (!sessionEnd) return null;
  const approachWindowStart = new Date(
    sessionEnd.lastUpdatedAt.getTime() - 30 * 60 * 1000,
  );

  const approachPositions = await prisma.liveSessionPosition.findMany({
    where: {
      sessionId,
      altitudeAglFt: { not: null, lte: 3000 },
      recordedAt: { gte: approachWindowStart },
    },
    select: {
      latitude: true,
      longitude: true,
      altitudeAglFt: true,
      indicatedAirspeed: true,
      verticalSpeedFpm: true,
      pitch: true,
      bank: true,
    },
    orderBy: { recordedAt: "asc" },
  });

  if (approachPositions.length === 0) return null;

  // ─── Metric 1: IAS @ 1000ft AGL ──────────────────────────────────
  // Position deren altitudeAglFt am nächsten zu 1000 ist.
  let closestTo1000:
    | (typeof approachPositions)[number]
    | null = null;
  let closestDelta = Infinity;
  for (const p of approachPositions) {
    if (p.altitudeAglFt === null) continue;
    const delta = Math.abs(p.altitudeAglFt - 1000);
    if (delta < closestDelta) {
      closestDelta = delta;
      closestTo1000 = p;
    }
  }
  const iasAt1000ft = closestTo1000?.indicatedAirspeed ?? null;
  const agAtIasMeasurement = closestTo1000?.altitudeAglFt ?? null;

  // ─── Metric 2: Glideslope-Quality ────────────────────────────────
  // Für jede position: expected_aglFt = haversine(pos, arrival) × 318.
  // Pass wenn |actual - expected| <= 300ft. % der passenden positions.
  // Window: alle approach-positions mit altitudeAglFt zwischen 50 und 3000.
  let glideslopePass = 0;
  let glideslopeSamples = 0;
  for (const p of approachPositions) {
    if (
      p.altitudeAglFt === null ||
      p.altitudeAglFt < 50 ||
      p.altitudeAglFt > 3000
    )
      continue;
    const distNm = haversineNm(
      p.latitude,
      p.longitude,
      pirep.arrival.latitude,
      pirep.arrival.longitude,
    );
    // Expected AGL on 3° slope: distance_nm × tan(3°) × 6076 ft/nm.
    // tan(3°) × 6076 ≈ 318.5. Wir nutzen 318 als convenient round number.
    const expectedAglFt = distNm * 318;
    if (Math.abs(p.altitudeAglFt - expectedAglFt) <= 300) {
      glideslopePass++;
    }
    glideslopeSamples++;
  }
  const glideslopeQualityPercent =
    glideslopeSamples > 0
      ? (glideslopePass / glideslopeSamples) * 100
      : null;

  // ─── Metric 3: Stabilization-Score ───────────────────────────────
  // Window: 1000ft → 50ft AGL. Pro position: VSI ∈ [-1100,-300],
  // bank ∈ [-30,30], pitch ∈ [-10,10]. Pass nur wenn alle drei.
  let stabilizationPass = 0;
  let stabilizationSamples = 0;
  for (const p of approachPositions) {
    if (
      p.altitudeAglFt === null ||
      p.altitudeAglFt < 50 ||
      p.altitudeAglFt > 1000
    )
      continue;
    if (
      p.verticalSpeedFpm === null ||
      p.bank === null ||
      p.pitch === null
    ) {
      // Skip positions ohne complete data — sample-count bleibt
      // niedriger statt false-failures zu zählen.
      continue;
    }
    const vsiOk =
      p.verticalSpeedFpm >= -1100 && p.verticalSpeedFpm <= -300;
    const bankOk = Math.abs(p.bank) <= 30;
    const pitchOk = Math.abs(p.pitch) <= 10;
    if (vsiOk && bankOk && pitchOk) stabilizationPass++;
    stabilizationSamples++;
  }
  const stabilizationScorePercent =
    stabilizationSamples > 0
      ? (stabilizationPass / stabilizationSamples) * 100
      : null;

  return {
    iasAt1000ft,
    agAtIasMeasurement,
    glideslopeQualityPercent,
    glideslopeSampleCount: glideslopeSamples,
    stabilizationScorePercent,
    stabilizationSampleCount: stabilizationSamples,
  };
}
