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
