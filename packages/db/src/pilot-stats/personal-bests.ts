/**
 * Track 5 #8 — Personal Best Records.
 *
 * Pro pilot die "rekorde" finden: nicht aggregations sondern einzelne
 * PIREPs die als bester/extremster wert herausstechen. Für jeden record
 * returnen wir den PIREP (mit metadata zum verlinken) + den wert.
 *
 * # Welche records?
 *
 * - smoothestLanding:   PIREP mit kleinstem |landingRateFpm| (sanftester touchdown)
 * - hardestLanding:     PIREP mit größtem |landingRateFpm| (boast oder schande,
 *                       je nach perspektive — wir zeigen es trotzdem, "lehrgeld")
 * - longestFlight:      PIREP mit größter route.distanceNm
 * - longestDuration:    PIREP mit größtem flightTimeMin
 * - mostPassengers:     PIREP mit größtem passengerCount
 * - mostFuel:           PIREP mit größtem fuelUsedKg (typisch widebody-flug)
 * - earliestFlight:     PIREP mit kleinstem submittedAt (first-flight-rekord)
 * - latestFlight:       PIREP mit größtem submittedAt (most-recent)
 *
 * # Warum nicht in getPilotCareerStats() bundle'n?
 *
 * Trennung der konzerne:
 *   - Career-stats sind aggregations (counts, sums, averages)
 *   - Personal-bests sind einzelne identifizierbare PIREPs
 *
 * Die UI rendert sie auch unterschiedlich: career-stats als KPI-cards
 * mit zahlen, personal-bests als list mit "→ siehe PIREP NGN901 vom
 * 5. März"-cards. Getrennte helper, getrennte caching-charakteristik
 * (records ändern sich seltener als counts).
 *
 * # Performance
 *
 * 8 parallele queries, jede macht findFirst mit ORDER BY auf indexed
 * column + WHERE clause auf (userId, status='Approved'). Bei einem
 * pilot mit 500 PIREPs ist das alles <50ms.
 */

import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

const APPROVED_FILTER = { status: "Approved" as const };

/**
 * Eine PIREP-summary — alles was die UI braucht um die record-card
 * mit kontext zu rendern (welcher flug, wann, wohin, mit welchem
 * aircraft). User-info nicht included weil der record-helper schon
 * pro-user gefiltert ist.
 */
export type RecordPirepSummary = {
  id: string;
  submittedAt: Date;
  flightNumber: string | null;
  departureIcao: string;
  arrivalIcao: string;
  aircraftRegistration: string | null;
  aircraftType: string | null;
};

/**
 * Ein einzelner record. value ist der "raw"-wert (z.B. 47 für
 * smoothestLanding-fpm), displayValue ist die human-readable form
 * mit unit (z.B. "47 fpm"). pirep ist die identifying PIREP-summary;
 * null wenn kein PIREP qualifiziert (z.B. earlyer career: kein
 * PIREP mit landingRateFpm).
 */
export type PersonalBestRecord = {
  value: number;
  displayValue: string;
  pirep: RecordPirepSummary;
};

export type PilotPersonalBests = {
  smoothestLanding: PersonalBestRecord | null;
  hardestLanding: PersonalBestRecord | null;
  longestFlight: PersonalBestRecord | null;
  longestDuration: PersonalBestRecord | null;
  mostPassengers: PersonalBestRecord | null;
  mostFuel: PersonalBestRecord | null;
  earliestFlight: PersonalBestRecord | null;
  latestFlight: PersonalBestRecord | null;
};

/**
 * Standard-shape für die SELECT-clause aller record-queries.
 * Wir brauchen die relations für die display-cards, daher join'n
 * wir route+departure+arrival+aircraft. Bei einem record-query ist
 * das overhead-trivial weil wir nur 1 row fetchen.
 */
const PIREP_RECORD_SELECT = {
  id: true,
  submittedAt: true,
  flightTimeMin: true,
  fuelUsedKg: true,
  passengerCount: true,
  landingRateFpm: true,
  route: { select: { flightNumber: true, distanceNm: true } },
  departure: { select: { icao: true } },
  arrival: { select: { icao: true } },
  aircraft: { select: { registration: true, type: true } },
} satisfies Prisma.PirepSelect;

// Type derived vom select via GetPayload — exakter match was prisma
// zurückgibt. Hand-rolling wäre brüchig (z.B. wenn die select-shape
// erweitert wird, würde der hand-type drift). Mit satisfies oben
// behalten wir die `as const`-style inference.
type PirepRecordRow = Prisma.PirepGetPayload<{
  select: typeof PIREP_RECORD_SELECT;
}>;

// Helper-cast für die query-results. Der globale prisma-client läuft
// durch `$extends` + `unknown as PrismaClient` (siehe ../index.ts) —
// dadurch geht die select-payload-inference verloren und findFirst
// returnt den raw Pirep-type statt den schlanken PIREP_RECORD_SELECT-
// payload. Wir wissen aber dass jede query oben mit PIREP_RECORD_SELECT
// läuft, also ist der cast laufzeit-safe.
function asRecord(p: unknown): PirepRecordRow {
  return p as PirepRecordRow;
}

function summarize(p: PirepRecordRow): RecordPirepSummary {
  return {
    id: p.id,
    submittedAt: p.submittedAt,
    flightNumber: p.route?.flightNumber ?? null,
    departureIcao: p.departure.icao,
    arrivalIcao: p.arrival.icao,
    aircraftRegistration: p.aircraft?.registration ?? null,
    aircraftType: p.aircraft?.type ?? null,
  };
}

export async function getPilotPersonalBests(
  userId: string,
): Promise<PilotPersonalBests> {
  const baseWhere = { userId, ...APPROVED_FILTER };

  // 8 parallele queries. Prisma hat kein ABS() im order-by, daher für
  // smoothest/hardest landing nehmen wir die zwei extreme der negative-
  // und positive-skalen + vergleichen im post-processing.
  //
  // Smoothest: |fpm| minimal → wir suchen das PIREP mit fpm am nächsten
  // an 0. Two queries: max von fpm<=0 (== negative am nächsten an 0)
  // und min von fpm>=0 (== positive am nächsten an 0), dann compare.
  //
  // Hardest: |fpm| maximal → spiegelbildlich.
  const [
    smoothestNegRaw, // negative-fpm landing am nächsten an 0 (max von negatives)
    smoothestPosRaw, // positive-fpm landing am nächsten an 0 (min von positives)
    hardestNegRaw, // negativester landing (min von fpm)
    hardestPosRaw, // positivster landing (max von fpm)
    longestFlightRaw,
    longestDurationRaw,
    mostPaxRaw,
    mostFuelRaw,
    earliestRaw,
    latestRaw,
  ] = await Promise.all([
    prisma.pirep.findFirst({
      where: { ...baseWhere, landingRateFpm: { lte: 0, not: null } },
      orderBy: { landingRateFpm: "desc" },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: { ...baseWhere, landingRateFpm: { gte: 0, not: null } },
      orderBy: { landingRateFpm: "asc" },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: { ...baseWhere, landingRateFpm: { not: null } },
      orderBy: { landingRateFpm: "asc" },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: { ...baseWhere, landingRateFpm: { not: null } },
      orderBy: { landingRateFpm: "desc" },
      select: PIREP_RECORD_SELECT,
    }),
    // Longest flight: route.distanceNm desc. Wir filter'n nur auf
    // routeId !== null — distanceNm selbst ist im schema non-nullable.
    // Pireps ohne route werden skipped.
    prisma.pirep.findFirst({
      where: { ...baseWhere, routeId: { not: null } },
      orderBy: { route: { distanceNm: "desc" } },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: { ...baseWhere, flightTimeMin: { not: null, gt: 0 } },
      orderBy: { flightTimeMin: "desc" },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: { ...baseWhere, passengerCount: { not: null, gt: 0 } },
      orderBy: { passengerCount: "desc" },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: { ...baseWhere, fuelUsedKg: { not: null, gt: 0 } },
      orderBy: { fuelUsedKg: "desc" },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: baseWhere,
      orderBy: { submittedAt: "asc" },
      select: PIREP_RECORD_SELECT,
    }),
    prisma.pirep.findFirst({
      where: baseWhere,
      orderBy: { submittedAt: "desc" },
      select: PIREP_RECORD_SELECT,
    }),
  ]);

  // Cast die query-results auf den PirepRecordRow-type — siehe asRecord
  // comment oben für die rationale.
  const smoothestNeg = smoothestNegRaw ? asRecord(smoothestNegRaw) : null;
  const smoothestPos = smoothestPosRaw ? asRecord(smoothestPosRaw) : null;
  const hardestNeg = hardestNegRaw ? asRecord(hardestNegRaw) : null;
  const hardestPos = hardestPosRaw ? asRecord(hardestPosRaw) : null;
  const longestFlight = longestFlightRaw ? asRecord(longestFlightRaw) : null;
  const longestDuration = longestDurationRaw
    ? asRecord(longestDurationRaw)
    : null;
  const mostPax = mostPaxRaw ? asRecord(mostPaxRaw) : null;
  const mostFuel = mostFuelRaw ? asRecord(mostFuelRaw) : null;
  const earliest = earliestRaw ? asRecord(earliestRaw) : null;
  const latest = latestRaw ? asRecord(latestRaw) : null;

  // ─── Smoothest landing: post-process das näher-an-0-pair ───
  let smoothestLanding: PersonalBestRecord | null = null;
  const smoothestCandidates: Array<{ pirep: PirepRecordRow; abs: number }> = [];
  if (smoothestNeg && smoothestNeg.landingRateFpm !== null) {
    smoothestCandidates.push({
      pirep: smoothestNeg,
      abs: Math.abs(smoothestNeg.landingRateFpm),
    });
  }
  if (smoothestPos && smoothestPos.landingRateFpm !== null) {
    smoothestCandidates.push({
      pirep: smoothestPos,
      abs: Math.abs(smoothestPos.landingRateFpm),
    });
  }
  if (smoothestCandidates.length > 0) {
    const winner = smoothestCandidates.reduce((best, cur) =>
      cur.abs < best.abs ? cur : best,
    );
    smoothestLanding = {
      value: winner.abs,
      displayValue: `${winner.abs} fpm`,
      pirep: summarize(winner.pirep),
    };
  }

  // ─── Hardest landing: post-process das weiter-von-0-pair ───
  let hardestLanding: PersonalBestRecord | null = null;
  const hardestCandidates: Array<{ pirep: PirepRecordRow; abs: number }> = [];
  if (hardestNeg && hardestNeg.landingRateFpm !== null) {
    hardestCandidates.push({
      pirep: hardestNeg,
      abs: Math.abs(hardestNeg.landingRateFpm),
    });
  }
  if (hardestPos && hardestPos.landingRateFpm !== null) {
    hardestCandidates.push({
      pirep: hardestPos,
      abs: Math.abs(hardestPos.landingRateFpm),
    });
  }
  if (hardestCandidates.length > 0) {
    const winner = hardestCandidates.reduce((best, cur) =>
      cur.abs > best.abs ? cur : best,
    );
    hardestLanding = {
      value: winner.abs,
      displayValue: `${winner.abs} fpm`,
      pirep: summarize(winner.pirep),
    };
  }

  return {
    smoothestLanding,
    hardestLanding,
    longestFlight:
      longestFlight && longestFlight.route?.distanceNm
        ? {
            value: longestFlight.route.distanceNm,
            displayValue: `${longestFlight.route.distanceNm.toLocaleString("de-DE")} nm`,
            pirep: summarize(longestFlight),
          }
        : null,
    longestDuration:
      longestDuration && longestDuration.flightTimeMin
        ? {
            value: longestDuration.flightTimeMin,
            displayValue: formatDuration(longestDuration.flightTimeMin),
            pirep: summarize(longestDuration),
          }
        : null,
    mostPassengers:
      mostPax && mostPax.passengerCount
        ? {
            value: mostPax.passengerCount,
            displayValue: `${mostPax.passengerCount.toLocaleString("de-DE")} Pax`,
            pirep: summarize(mostPax),
          }
        : null,
    mostFuel:
      mostFuel && mostFuel.fuelUsedKg
        ? {
            value: mostFuel.fuelUsedKg,
            displayValue: `${mostFuel.fuelUsedKg.toLocaleString("de-DE")} kg`,
            pirep: summarize(mostFuel),
          }
        : null,
    earliestFlight: earliest
      ? {
          value: earliest.submittedAt.getTime(),
          displayValue: earliest.submittedAt.toLocaleDateString("de-DE"),
          pirep: summarize(earliest),
        }
      : null,
    latestFlight: latest
      ? {
          value: latest.submittedAt.getTime(),
          displayValue: latest.submittedAt.toLocaleDateString("de-DE"),
          pirep: summarize(latest),
        }
      : null,
  };
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
