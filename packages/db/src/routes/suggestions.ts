/**
 * Track 5 #17 (Section D) — Route-Suggester.
 *
 * Smart "wo flieg ich als nächstes hin"-suggestions basierend auf der
 * aktuellen position des piloten. Pure aggregator über Route + Aircraft
 * + Pirep, kein neues schema.
 *
 * # Algorithm
 *
 *   1. Pilot-location bestimmen (3-step fallback):
 *      a. User.currentLocationIcao  — wo der pilot grade ist (Welle 4,
 *         updated nach jedem PIREP-approval)
 *      b. User.baseIcao             — pilot-eigener hub innerhalb der
 *         airline (falls noch nie geflogen)
 *      c. Airline primary hub       — falls baseIcao auch null
 *
 *   2. Routes finden die von diesem ICAO abgehen (Route.airlineId AND
 *      active AND departure.icao = fromIcao). Cap 100 — defensive für
 *      mega-hubs, in der praxis hat eine airline selten >50 routes pro
 *      airport.
 *
 *   3. Pro route zwei score-signale berechnen:
 *      - aircraftAtAirport: Aircraft.currentLocationIcao === fromIcao
 *        (mit fallback auf homeIcao wenn kein current set ist).
 *        Bedeutet: "das flugzeug steht hier, kein repositioning nötig".
 *      - pilotFlightCount: anzahl PIREPs des piloten auf dieser route
 *        (Submitted+Approved). Bedeutet: "schon vertraut mit dem flug".
 *
 *   4. Sort: aircraftAtAirport desc → pilotFlightCount desc →
 *      distanceNm asc. Reasoning:
 *      - Aircraft-am-standort beats alles andere (real-world-relevanz)
 *      - Familiar routes danach (lower friction)
 *      - Kürzere routen zuerst als tie-breaker (mehr fly-options pro tag)
 *
 * # Why no DB-schema-change?
 *
 * Die Welle-4-position-tracking-infrastruktur (User.currentLocationIcao
 * + Aircraft.currentLocationIcao) macht V1 trivial. Wir mergen 3 existing
 * tabellen in einer aggregator-funktion, kein neues persistent state nötig.
 */

import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────
// Pilot location
// ─────────────────────────────────────────────────────────────────────

export type PilotLocation = {
  icao: string;
  airportName: string | null;
  airportCity: string | null;
  /**
   * Source of truth for this location:
   *   - 'currentLocation': pilot actually flew here (most reliable)
   *   - 'baseIcao':        pilot's airline-hub assignment (no flights yet)
   *   - 'airlineHub':      airline's primary hub (no baseIcao either)
   */
  source: "currentLocation" | "baseIcao" | "airlineHub";
  /** Wann der currentLocationIcao zuletzt gesetzt wurde. Null für baseIcao/airlineHub. */
  updatedAt: Date | null;
};

/**
 * Bestimmt die aktuelle position eines piloten via 3-step fallback.
 * Returns null wenn der user nicht existiert ODER keinen sinnvollen
 * fallback finden konnte (kein currentLocation, kein baseIcao, airline
 * hat keinen primary hub).
 */
export async function getPilotLocation(
  userId: string,
): Promise<PilotLocation | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      currentLocationIcao: true,
      currentLocationAt: true,
      baseIcao: true,
      airlineId: true,
    },
  });
  if (!user) return null;

  let icao: string | null = null;
  let source: PilotLocation["source"] | null = null;
  let updatedAt: Date | null = null;

  if (user.currentLocationIcao) {
    icao = user.currentLocationIcao;
    source = "currentLocation";
    updatedAt = user.currentLocationAt;
  } else if (user.baseIcao) {
    icao = user.baseIcao;
    source = "baseIcao";
  } else if (user.airlineId) {
    const hub = await prisma.airlineHub.findFirst({
      where: { airlineId: user.airlineId, isPrimary: true },
      select: { airportIcao: true },
    });
    if (hub) {
      icao = hub.airportIcao;
      source = "airlineHub";
    }
  }

  if (!icao || !source) return null;

  // Airport-details für display (name + city). Separate query weil
  // currentLocationIcao ein plain string ist (kein FK auf Airport).
  // Defensive: airport row könnte fehlen wenn der ICAO einen typo hat
  // oder das airport gelöscht wurde — wir returnen trotzdem den ICAO
  // damit das UI "EDDM" zeigen kann auch ohne name.
  const airport = await prisma.airport.findUnique({
    where: { icao },
    select: { name: true, city: true },
  });
  return {
    icao,
    airportName: airport?.name ?? null,
    airportCity: airport?.city ?? null,
    source,
    updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Route suggestions
// ─────────────────────────────────────────────────────────────────────

const ROUTE_SUGGESTION_SELECT = {
  id: true,
  flightNumber: true,
  distanceNm: true,
  departure: { select: { icao: true, name: true } },
  arrival: { select: { icao: true, name: true, city: true } },
  aircraft: {
    select: {
      type: true,
      registration: true,
      homeIcao: true,
      currentLocationIcao: true,
    },
  },
} satisfies Prisma.RouteSelect;

type RouteRow = Prisma.RouteGetPayload<{
  select: typeof ROUTE_SUGGESTION_SELECT;
}>;

export type RouteSuggestion = {
  routeId: string;
  flightNumber: string;
  distanceNm: number;
  departure: { icao: string; name: string };
  arrival: { icao: string; name: string; city: string | null };
  aircraft: {
    type: string;
    registration: string;
    homeIcao: string | null;
    currentLocationIcao: string | null;
  } | null;
  /** Aircraft.currentLocationIcao === fromIcao (mit homeIcao-fallback). */
  aircraftAtAirport: boolean;
  /** Pilot hat diese route schon N mal geflogen (Submitted+Approved). */
  pilotFlightCount: number;
};

/**
 * Listet die N besten route-vorschläge ab dem given fromIcao für den
 * piloten, gescored nach aircraft-availability + familiarity.
 *
 * Bei `routes.length === 0` zurück [] — caller-side conditional rendert
 * dann z.B. ein hint "keine routes ab diesem airport".
 *
 * # Performance
 *
 *   - findMany auf route: O(routes-from-icao), indexed via departureId
 *   - groupBy auf pirep: 1 query für alle routes auf einmal,
 *     indexed via @@index([userId, submittedAt])
 *   - Total: 2 DB-roundtrips, bounded durch route-count.
 */
export async function getRouteSuggestions(params: {
  userId: string;
  airlineId: string;
  fromIcao: string;
  limit?: number;
}): Promise<RouteSuggestion[]> {
  const { userId, airlineId, fromIcao, limit = 5 } = params;

  const routesRaw = await prisma.route.findMany({
    where: {
      airlineId,
      active: true,
      departure: { icao: fromIcao },
    },
    select: ROUTE_SUGGESTION_SELECT,
    // Defensive cap. Mega-hubs könnten theoretisch >50 routes haben, aber
    // wir scoren eh nur die top 5/10 — beyond 100 ist die selection
    // arbitrary, da gibt's bessere UX-tools (browse-page mit filter).
    take: 100,
  });
  const routes = routesRaw as unknown as RouteRow[];

  if (routes.length === 0) return [];

  // Bulk pilot-PIREP-counts pro route. Single groupBy beats N findMany().
  // Null routeIds (standalone-PIREPs ohne route-FK) sind automatisch raus
  // weil wir mit routeId IN (...) filtern.
  const routeIds = routes.map((r) => r.id);
  const countsRaw = await prisma.pirep.groupBy({
    by: ["routeId"],
    where: {
      userId,
      status: { in: ["Submitted", "Approved"] },
      routeId: { in: routeIds },
    },
    _count: { _all: true },
  });
  const countsByRoute = new Map<string, number>();
  for (const row of countsRaw) {
    if (row.routeId) countsByRoute.set(row.routeId, row._count._all);
  }

  const suggestions: RouteSuggestion[] = routes.map((r) => {
    // aircraftAtAirport-logic: bevorzuge currentLocationIcao (echte
    // position). Falls null (aircraft hat noch nie einen PIREP gehabt),
    // fall back auf homeIcao. Beides null → false.
    const currentLoc = r.aircraft?.currentLocationIcao ?? null;
    const homeLoc = r.aircraft?.homeIcao ?? null;
    const acAt =
      currentLoc !== null
        ? currentLoc === fromIcao
        : homeLoc !== null
          ? homeLoc === fromIcao
          : false;

    return {
      routeId: r.id,
      flightNumber: r.flightNumber,
      distanceNm: r.distanceNm,
      departure: r.departure,
      arrival: {
        icao: r.arrival.icao,
        name: r.arrival.name,
        city: r.arrival.city,
      },
      aircraft: r.aircraft,
      aircraftAtAirport: acAt,
      pilotFlightCount: countsByRoute.get(r.id) ?? 0,
    };
  });

  suggestions.sort((a, b) => {
    if (a.aircraftAtAirport !== b.aircraftAtAirport) {
      return a.aircraftAtAirport ? -1 : 1;
    }
    if (a.pilotFlightCount !== b.pilotFlightCount) {
      return b.pilotFlightCount - a.pilotFlightCount;
    }
    return a.distanceNm - b.distanceNm;
  });

  return suggestions.slice(0, limit);
}
