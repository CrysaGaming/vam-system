/**
 * Track 5 #18 (Section D) — Alternate-Picker.
 *
 * Pure geo-aggregator über die Airport-tabelle. Liefert die nächsten N
 * commercially-served airports innerhalb [minNm, maxNm] um einen given
 * arrival-ICAO — gedacht für booking-detail-page als "backup-airports
 * falls EDDM zumacht".
 *
 * # Algorithm
 *
 *   1. Lat/lon des arrival-airports holen.
 *   2. Bounding-box berechnen: 1° latitude ≈ 60nm, 1° longitude ≈
 *      60·cos(lat) nm. Mit 20% buffer auf maxDistanceNm.
 *   3. SQL-prefilter: active + scheduledService + within bounding-box +
 *      exclude DEP/ARR. Liefert typischerweise <100 rows.
 *   4. Exact great-circle distance + initial bearing in JS für jeden
 *      candidate. Haversine-formel mit earth radius = 3440.065 nm.
 *   5. Final filter: minDistanceNm ≤ d ≤ maxDistanceNm.
 *   6. Sort ascending nach distance, take limit.
 *
 * # Why bounding box?
 *
 * Airport-table hat ~80k rows nach dem OurAirports.com bulk-import.
 * Naive findMany + JS-filter würde alle rows pro request scannen. SQL
 * bounding-box mit lat/lon indizes drosselt das auf <500 rows für ein
 * 200nm-radius — JS-side exact-distance über die ist trivial.
 *
 * # Why scheduledService als filter?
 *
 * OurAirports' `scheduledService=true` markiert airports mit regelmäßigem
 * kommerziellen verkehr. Filtert heliports, balloonports, abandoned strips,
 * winzige privatpisten raus — die wären für eine VA als alternate nicht
 * sinnvoll. Trade-off: einige große GA-airports ohne scheduled service
 * werden auch ausgefiltert (z.B. EDDB-Brandenburg flugschule), aber für
 * V1 ist das der sauberste "operational" signal.
 *
 * # Why no DB-schema change?
 *
 * Lat/lon + scheduledService + active sind alle schon im OurAirports.com-
 * Bulk-Import vorhanden. Pure read-only aggregator.
 */

import { prisma } from "../index.js";

// Earth radius in nautical miles. Mean-radius approximation — exakt
// genug für alternate-distances (200nm error ist <0.1%).
const EARTH_RADIUS_NM = 3440.065;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Haversine great-circle distance in nautical miles. Standard formula —
 * accurate to ±0.5% bei kurzen distanzen (< 1000nm), perfekt für alternates.
 */
function greatCircleDistanceNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

/**
 * Initial bearing (rhumb-line at origin) in degrees, 0=N, 90=E.
 * Spherical-trig formula. For visual "where is this alternate?" labels
 * (N/NE/E/SE/...) das reicht — final bearings divergieren über >100nm
 * von der initial, aber pilots interessiert nur die richtung ab arrival.
 */
function initialBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export type Compass8 =
  | "N"
  | "NE"
  | "E"
  | "SE"
  | "S"
  | "SW"
  | "W"
  | "NW";

const COMPASS_8: Compass8[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** 0-360° → 8-way compass label. */
function compass8(bearingDeg: number): Compass8 {
  return COMPASS_8[Math.round(bearingDeg / 45) % 8] ?? "N";
}

export type AlternateOption = {
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string;
  latitude: number;
  longitude: number;
  /** OurAirports type: large_airport, medium_airport, small_airport, etc. */
  type: string | null;
  /** Great-circle distance from arrival in nautical miles, rounded to int. */
  distanceNm: number;
  /** Initial bearing in degrees, 0-360, rounded to int. */
  bearingDeg: number;
  /** 8-way compass direction (N/NE/E/SE/S/SW/W/NW) — for UI labels. */
  bearing8: Compass8;
};

/**
 * Listet airports die als alternate für den given arrival-ICAO geeignet
 * sind, sortiert nach distance asc.
 *
 * Defaults: 30nm ≤ d ≤ 200nm (real-world FAA/EASA alternate-range), limit 8.
 *
 * Returns [] wenn der arrival-ICAO nicht existiert oder keine alternates
 * in range gefunden wurden.
 */
export async function getAlternates(params: {
  arrivalIcao: string;
  limit?: number;
  minDistanceNm?: number;
  maxDistanceNm?: number;
  /** ICAOs die ausgeschlossen werden sollen (zusätzlich zu arrivalIcao). */
  excludeIcaos?: string[];
}): Promise<AlternateOption[]> {
  const {
    arrivalIcao,
    limit = 8,
    minDistanceNm = 30,
    maxDistanceNm = 200,
  } = params;
  const excludeSet = new Set<string>([
    arrivalIcao.toUpperCase(),
    ...(params.excludeIcaos ?? []).map((s) => s.toUpperCase()),
  ]);

  const arrival = await prisma.airport.findUnique({
    where: { icao: arrivalIcao },
    select: { latitude: true, longitude: true },
  });
  if (!arrival) return [];

  // Bounding-box mit 20% buffer auf maxDistanceNm. Buffer fängt die
  // unterschätzung an den ecken des rechtecks (lat/lon-grid ist nicht
  // wirklich rechteckig auf der kugel).
  const buffer = maxDistanceNm * 1.2;
  const dLat = buffer / 60;
  const cosLat = Math.cos(toRad(arrival.latitude));
  // An den polen wird cosLat tiny → dLon wäre absurd. Cap auf 180°
  // (= weltweite longitude-range) für polare arrivals.
  const dLon = cosLat > 0.01 ? buffer / (60 * cosLat) : 180;

  const minLat = arrival.latitude - dLat;
  const maxLat = arrival.latitude + dLat;
  const minLon = arrival.longitude - dLon;
  const maxLon = arrival.longitude + dLon;

  const candidates = await prisma.airport.findMany({
    where: {
      active: true,
      scheduledService: true,
      latitude: { gte: minLat, lte: maxLat },
      longitude: { gte: minLon, lte: maxLon },
      icao: { notIn: Array.from(excludeSet) },
    },
    select: {
      icao: true,
      iata: true,
      name: true,
      city: true,
      country: true,
      latitude: true,
      longitude: true,
      type: true,
    },
    // Defensive cap. Bounding-box sollte typischerweise <100 zurück-
    // geben (selbst in dichten regionen wie europa). 500 ist worst-
    // case bei mega-hub-clustern (NYC, Tokyo) wo bounding-box overlap
    // mehr ergibt.
    take: 500,
  });

  // Exact distance + bearing, dann filter + sort.
  const withDistance: AlternateOption[] = candidates
    .map((a) => {
      const distance = greatCircleDistanceNm(
        arrival.latitude,
        arrival.longitude,
        a.latitude,
        a.longitude,
      );
      const bearing = initialBearingDeg(
        arrival.latitude,
        arrival.longitude,
        a.latitude,
        a.longitude,
      );
      return {
        icao: a.icao,
        iata: a.iata,
        name: a.name,
        city: a.city,
        country: a.country,
        latitude: a.latitude,
        longitude: a.longitude,
        type: a.type,
        distanceNm: Math.round(distance),
        bearingDeg: Math.round(bearing),
        bearing8: compass8(bearing),
      };
    })
    .filter(
      (a) =>
        a.distanceNm >= minDistanceNm && a.distanceNm <= maxDistanceNm,
    );

  withDistance.sort((a, b) => a.distanceNm - b.distanceNm);
  return withDistance.slice(0, limit);
}
