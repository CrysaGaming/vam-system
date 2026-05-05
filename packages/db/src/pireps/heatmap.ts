/**
 * Track 1 #4 — PIREP-Heatmap (9.2.6).
 *
 * Aggregiert flight-aktivität in geo-punkte für die mapbox-heatmap-layer
 * auf der live-map. Jeder approved PIREP trägt zwei punkte bei: einen
 * für den departure-airport und einen für den arrival-airport. So wird
 * sowohl die abflug- als auch die ankunfts-frequenz auf der map sichtbar
 * (großer hub = doppelter beitrag pro flug).
 *
 * # Warum airline-scoped statt VA-wide
 *
 * Auf einer multi-airline-instanz wäre VA-wide irreführend (du siehst
 * dann hubs anderer airlines die für dich nicht relevant sind). Auf
 * single-airline-instanzen ist beides identisch. Wir scope'n auf die
 * eigene airline analog zu live-sessions — konsistent mit dem rest
 * der live-map.
 *
 * # Warum departure + arrival statt nur einer
 *
 * Eine reine departure-heatmap würde hubs (z.B. EDDF) als hot zeigen
 * aber spokes-only-airports (kleine destinations) kalt — obwohl da
 * regelmäßig gelandet wird. departures+arrivals gibt eine ehrliche
 * "wo passiert flugbetrieb"-sicht.
 *
 * # Warum approved-only
 *
 * Submitted/Rejected PIREPs sind ungeprüfte selbstauskunft. Heatmap
 * soll "echte" historische aktivität zeigen, nicht falschangaben oder
 * spam. Tradeoff: PIREPs die noch im review sind tauchen erst nach
 * approval auf der heatmap auf — verzögerung von minuten bis stunden,
 * akzeptabel für eine "wo wird geflogen"-langzeit-sicht.
 *
 * # Aggregation: groupBy + count statt findMany + reduce
 *
 * Wir machen zwei groupBy-queries (eine pro endpoint-typ) und mergen
 * dann auf dem app-server pro airport. Alternative wäre prisma.$queryRaw
 * mit UNION ALL — aber groupBy ist composable + typed + wenn wir später
 * filter (z.B. time-window) erweitern wollen, ist das die saubere
 * struktur. Performance: mit ~10k PIREPs sind das zwei sub-100ms
 * queries, wir indexen die FK-spalten ja eh schon implizit über die
 * relations.
 *
 * # Output-shape: {lng, lat, weight}
 *
 * Mapbox heatmap-source erwartet GeoJSON FeatureCollection mit Point-
 * features und einer numeric property die wir als weight nehmen
 * können. Der API-layer baut die GeoJSON-struktur — diese function
 * returnt nur die rohdaten als plain array.
 */

import { prisma } from "../index.js";

export type PirepHeatmapPoint = {
  /** Longitude (-180..180). */
  lng: number;
  /** Latitude (-90..90). */
  lat: number;
  /**
   * Wieviele PIREP-endpoints (departure + arrival) auf diesem airport
   * landen. Höher = mehr aktivität = "heißer" auf der heatmap.
   */
  weight: number;
};

export type GetPirepHeatmapPointsOptions = {
  airlineId: string;
  /**
   * Optional: nur PIREPs ab diesem zeitpunkt (submittedAt). Default: all-
   * time. Bei zukünftigen UI-toggles ("Letzte 30 Tage" / "Letzte 6 Monate")
   * füllt der API-layer das.
   */
  sinceSubmittedAt?: Date;
};

/**
 * Aggregiert approved PIREPs zu geo-punkten mit weight = count of
 * endpoints (dep + arr). Returnt ein array das als heatmap-source
 * verwendet werden kann.
 */
export async function getPirepHeatmapPoints(
  options: GetPirepHeatmapPointsOptions,
): Promise<PirepHeatmapPoint[]> {
  const { airlineId, sinceSubmittedAt } = options;

  const where: {
    airlineId: string;
    status: "Approved";
    submittedAt?: { gte: Date };
  } = {
    airlineId,
    status: "Approved",
  };
  if (sinceSubmittedAt) {
    where.submittedAt = { gte: sinceSubmittedAt };
  }

  // Zwei groupBy-queries parallel: einmal departure-counts, einmal
  // arrival-counts. Promise.all spart ~50% latenz auf der DB-roundtrip.
  const [departureCounts, arrivalCounts] = await Promise.all([
    prisma.pirep.groupBy({
      by: ["departureId"],
      where,
      _count: { _all: true },
    }),
    prisma.pirep.groupBy({
      by: ["arrivalId"],
      where,
      _count: { _all: true },
    }),
  ]);

  // Merge zu einer map: airportId -> totalCount
  const counts = new Map<string, number>();
  for (const row of departureCounts) {
    counts.set(row.departureId, row._count._all);
  }
  for (const row of arrivalCounts) {
    const existing = counts.get(row.arrivalId) ?? 0;
    counts.set(row.arrivalId, existing + row._count._all);
  }

  if (counts.size === 0) {
    return [];
  }

  // Resolve airport-ids zu lat/lng. Eine query mit IN-list — typischerweise
  // ein paar dutzend bis vielleicht ein paar hundert airports, sehr schnell.
  const airportIds = Array.from(counts.keys());
  const airports = await prisma.airport.findMany({
    where: { id: { in: airportIds } },
    select: { id: true, latitude: true, longitude: true },
  });

  // Build output array. Falls ein airport im count steht aber nicht in
  // der airports-table existiert (FK-violation, sollte nicht passieren
  // aber defensiv), skippen wir den punkt statt zu crashen.
  const points: PirepHeatmapPoint[] = [];
  for (const airport of airports) {
    const weight = counts.get(airport.id);
    if (!weight) continue; // unreachable bei FK-integrität, defensiv
    if (airport.latitude == null || airport.longitude == null) continue;
    points.push({
      lng: airport.longitude,
      lat: airport.latitude,
      weight,
    });
  }

  return points;
}
