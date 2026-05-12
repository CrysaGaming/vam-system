/**
 * Track 5 #19 (Section D) — Airport-Briefing.
 *
 * Pure aggregator über die 3 OurAirports-detail-tabellen (Runway,
 * AirportFrequency, Navaid). Liefert pre-flight info per airport:
 * runways, ATC-frequencies, ILS-approach-aids. Konsumiert von der
 * booking-detail-page als 2-spalten DEP+ARR briefing-card.
 *
 * # Why pivot from "NOTAM-Display"?
 *
 * NOTAMs sind in V1 unpraktisch:
 *   - FAA NOTAM-API: US-only (KICAO prefix), braucht client_id+secret
 *   - EUROCONTROL: paywalled
 *   - DINS / AIP-services: militär-gated oder paywalled
 *   - AVWX/Aviationweather.gov: limited regional coverage
 *
 * Airport-Briefing mit existing OurAirports-daten liefert dafür eine
 * konkretere, immer verfügbare pre-flight info-quelle die echte pilot-
 * value hat (RWY-richtung, ATC-frequencies kennen vor pushback,
 * ILS-frequenz fürs MCDU setup).
 *
 * # Filter-rationale
 *
 *   - Runways: nur closed=false, sortiert lengthFt desc — der pilot
 *     sieht zuerst die längste/wichtigste runway. Cap 6 (mega-hubs
 *     wie KORD haben 8 RWYs; 6 reicht für 99% der ops).
 *   - Frequencies: nur USEFUL_FREQ_TYPES (TWR/GND/APP/DEP/ATIS/CTAF/
 *     CLEARANCE/RADIO). Sortiert nach FLIGHT_PHASE_ORDER (ATIS zuerst
 *     beim startup, dann DEL/GND vor pushback, TWR fürs t/o, APP/DEP
 *     im flight). Cap 10.
 *   - Navaids: nur type='ILS' UND associatedAirportIcao = icao.
 *     V1 fokussiert auf approach-aids — VORs/NDBs sind eher en-route,
 *     standalone-navaids spammen sonst die liste. Cap 8.
 *
 * # Why no DB-schema change?
 *
 * Runway, AirportFrequency, Navaid wurden alle im OurAirports-bulk-
 * import populated. Pure read-only aggregator über die 3 tables mit
 * Promise.all, kein neues state nötig.
 */

import { prisma } from "../index.js";

// ─────────────────────────────────────────────────────────────────────
// Frequency filtering + ordering
// ─────────────────────────────────────────────────────────────────────

/**
 * Frequency-typen die für VATSIM/IVAO-piloten relevant sind. Exkludiert
 * AWOS/ASOS (rein info, kein controller-contact), UNICOM/MULTICOM
 * (USA-uncontrolled-airfields), ARCAL (lighting-control), MISC-noise.
 */
const USEFUL_FREQ_TYPES = new Set([
  "ATIS",
  "CLEARANCE",
  "GND",
  "TWR",
  "APP",
  "DEP",
  "CTAF",
  "RADIO",
  "RADAR",
  "AFIS",
  "FSS",
  "INFO",
]);

/**
 * Sortier-reihenfolge nach flight-phase: ATIS beim startup, dann
 * DELIVERY/CLEARANCE vor pushback, GND fürs taxi, TWR fürs t/o,
 * DEP/APP/RADAR im flight. Sub-order: alphabetisch innerhalb gleicher
 * stufe (z.b. APP vor DEP). Unknown types am ende.
 */
const FLIGHT_PHASE_ORDER: Record<string, number> = {
  ATIS: 0,
  INFO: 1,
  AFIS: 2,
  FSS: 3,
  CLEARANCE: 10,
  GND: 20,
  TWR: 30,
  CTAF: 31,
  RADIO: 32,
  DEP: 40,
  APP: 41,
  RADAR: 42,
};

function freqOrder(type: string): number {
  return FLIGHT_PHASE_ORDER[type] ?? 999;
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type RunwayInfo = {
  /** "09L/27R" — combined low+high ident, oder "09L" wenn nur eines da ist. */
  ident: string;
  lengthFt: number | null;
  widthFt: number | null;
  surface: string | null;
  lighted: boolean;
  /**
   * True heading der low-end. Helpful für ATC-anweisungen ("expect 27" →
   * pilot weiß welche richtung). Null wenn ungesetzt.
   */
  leHeadingDegT: number | null;
};

export type FrequencyInfo = {
  type: string;
  description: string | null;
  frequencyMhz: number;
};

export type NavaidInfo = {
  ident: string;
  name: string;
  type: string;
  /** Frequenz in MHz, abgeleitet von frequencyKhz/1000. Null wenn ungesetzt. */
  frequencyMhz: number | null;
};

export type AirportBriefing = {
  icao: string;
  airportName: string | null;
  city: string | null;
  country: string | null;
  elevationFt: number | null;
  runways: RunwayInfo[];
  frequencies: FrequencyInfo[];
  /** Nur ILS-navaids associated mit diesem airport (V1). */
  ilsNavaids: NavaidInfo[];
};

// ─────────────────────────────────────────────────────────────────────
// Aggregator
// ─────────────────────────────────────────────────────────────────────

/**
 * Liefert die pre-flight-briefing für einen given ICAO. Returns null
 * wenn das airport nicht existiert.
 *
 * # Performance
 *
 * 4 DB-queries in einem Promise.all — airport-base + 3 detail-tables.
 * Alle indexed über airportIcao, total <50ms typisch.
 */
export async function getAirportBriefing(
  icao: string,
): Promise<AirportBriefing | null> {
  const [airport, runwaysRaw, frequenciesRaw, navaidsRaw] = await Promise.all([
    prisma.airport.findUnique({
      where: { icao },
      select: {
        icao: true,
        name: true,
        city: true,
        country: true,
        elevation: true,
      },
    }),
    prisma.runway.findMany({
      where: { airportIcao: icao, closed: false },
      select: {
        leIdent: true,
        heIdent: true,
        lengthFt: true,
        widthFt: true,
        surface: true,
        lighted: true,
        leHeadingDegT: true,
      },
      // Längste runways zuerst — die sind typischerweise primary
      // und am wichtigsten für jets. Null-length sortiert nach unten.
      orderBy: [{ lengthFt: { sort: "desc", nulls: "last" } }],
      take: 6,
    }),
    prisma.airportFrequency.findMany({
      where: {
        airportIcao: icao,
        type: { in: Array.from(USEFUL_FREQ_TYPES) },
      },
      select: {
        type: true,
        description: true,
        frequencyMhz: true,
      },
      take: 20, // Vor JS-sortierung; final cap 10 nach phase-order
    }),
    prisma.navaid.findMany({
      where: {
        associatedAirportIcao: icao,
        type: "ILS",
      },
      select: {
        ident: true,
        name: true,
        type: true,
        frequencyKhz: true,
      },
      orderBy: { ident: "asc" },
      take: 8,
    }),
  ]);

  if (!airport) return null;

  // Runways: combine le+he idents zu "09L/27R" form. Falls eines null ist
  // (kann bei single-direction runways vorkommen), nur das andere zeigen.
  const runways: RunwayInfo[] = runwaysRaw.map((r) => ({
    ident:
      r.leIdent && r.heIdent
        ? `${r.leIdent}/${r.heIdent}`
        : (r.leIdent ?? r.heIdent ?? "?"),
    lengthFt: r.lengthFt,
    widthFt: r.widthFt,
    surface: r.surface,
    lighted: r.lighted,
    leHeadingDegT: r.leHeadingDegT,
  }));

  // Frequencies: sort nach flight-phase order, secondary alphabetisch.
  // Dann cap auf 10.
  const frequencies: FrequencyInfo[] = frequenciesRaw
    .map((f) => ({
      type: f.type,
      description: f.description,
      frequencyMhz: f.frequencyMhz,
    }))
    .sort((a, b) => {
      const oa = freqOrder(a.type);
      const ob = freqOrder(b.type);
      if (oa !== ob) return oa - ob;
      // Same phase: lower freq zuerst (cosmetic, but deterministic).
      return a.frequencyMhz - b.frequencyMhz;
    })
    .slice(0, 10);

  // Navaids: convert kHz → MHz für display. ILS-freqs sind typisch
  // 108.10-111.95 MHz also kHz-storage ist {108100, ..., 111950} mal 1.
  // (OurAirports speichert ILS in kHz statt MHz×1000 — wir vertrauen
  // einfach der DB und teilen durch 1000.)
  const ilsNavaids: NavaidInfo[] = navaidsRaw.map((n) => ({
    ident: n.ident,
    name: n.name,
    type: n.type,
    frequencyMhz:
      n.frequencyKhz !== null && n.frequencyKhz !== undefined
        ? n.frequencyKhz / 1000
        : null,
  }));

  return {
    icao: airport.icao,
    airportName: airport.name,
    city: airport.city,
    country: airport.country,
    elevationFt: airport.elevation,
    runways,
    frequencies,
    ilsNavaids,
  };
}
