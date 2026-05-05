import type { Scenery, Airline } from "@prisma/client";
import { prisma } from "../index.js";

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Read-side queries für den
 * scenery-catalog.
 *
 * Sceneries sind kuratierte add-on-empfehlungen für die routen die in
 * der VA geflogen werden. Admins pflegen den katalog manuell ein —
 * "diese flughäfen haben gute add-ons, hier sind die links". Pilots
 * können dann durch den catalog browsen, filtern, und entweder
 * kostenlose downloads holen oder bezahlte produkte kaufen
 * (provider-link führt zum store).
 *
 * # Datenmodell (existing schema, schmal halten)
 *
 * - `Scenery.name` — der titel im catalog
 * - `Scenery.airportIcao` — optional, ICAO des hauptflughafens
 *   (manche sceneries decken mehrere airports ab → null)
 * - `Scenery.provider` — z.B. "Inibuilds", "Orbx", "Flightbeam"
 * - `Scenery.url` — store-link oder direkt-download
 * - `Scenery.free` — flag für "kostenlos vs paid"
 * - `Scenery.airlineId` — wenn nicht-null, ist die scenery
 *   airline-spezifisch (z.B. ein homebase-pack der eigenen VA);
 *   sonst global verfügbar
 *
 * # MVP-scope-decisions
 *
 * Description, image, simulator-tags, compatibleAircraft sind
 * intentional NICHT im MVP — schema-erweiterung wäre eine separate
 * welle. Catalog ist im MVP ein dünner aber funktionaler katalog
 * mit name + airport + provider + free/paid + url. Detail-page zeigt
 * einfach diese felder schöner formatiert mit metadata (created-at,
 * airline-affiliation).
 *
 * Owned-tracking (UserScenery-relation) ist auch nicht im MVP —
 * das wäre ein "ich besitze das"-checkmark feature und verlangt
 * eigenes model. Spätere welle.
 */

/**
 * Scenery + airline-context für card-display. Airline ist optional,
 * meistens null (globale sceneries).
 */
export type SceneryWithAirline = Scenery & {
  airline: Pick<Airline, "id" | "name" | "iata" | "icao"> | null;
};

/**
 * Filter-options für den catalog. Alle filter sind optional und kombinieren
 * mit AND-semantik im prisma-where.
 *
 * - `airlineId`: "all" (default — globals + alle airlines) | "global"
 *   (nur airlineId IS NULL) | string (specific airline-id)
 * - `airportIcao`: substring-match (case-insensitive) auf airportIcao —
 *   ermöglicht eingaben wie "ED" für deutsche flughäfen oder "EDDF" für
 *   einen specific airport
 * - `provider`: substring-match (case-insensitive) auf provider
 * - `priceTier`: undefined (alle) | "free" (free=true) | "paid" (free=false)
 */
export type SceneryFilter = {
  airlineId?: "all" | "global" | string;
  airportIcao?: string;
  provider?: string;
  priceTier?: "free" | "paid";
};

/**
 * Liste sceneries mit airline-context, sortiert nach airport-icao
 * dann name. Sort-rationale: piloten suchen typischerweise per region
 * (ICAO-prefix-cluster), nicht per name — nach airport sortiert
 * fühlen sich gleichregionale entries als gruppe an.
 *
 * Fehlende airportIcao-werte werden ans ende sortiert (NULLS LAST in
 * postgres' default für ASC). Innerhalb des gleichen airports nach
 * name aufsteigend.
 */
export async function listSceneries(
  filter: SceneryFilter = {},
): Promise<SceneryWithAirline[]> {
  // Airline-filter: drei modi für verschiedene UI-cases
  const airlineWhere: { airlineId?: string | null } = {};
  if (filter.airlineId === "global") {
    airlineWhere.airlineId = null;
  } else if (filter.airlineId && filter.airlineId !== "all") {
    airlineWhere.airlineId = filter.airlineId;
  }
  // "all" oder undefined → kein airline-filter

  // Substring-filter für airportIcao + provider mit case-insensitive
  // mode. Empty-string-guard im caller — leere strings würden als
  // "matches everything" interpretiert was die UI verwirrt.
  const where = {
    ...airlineWhere,
    ...(filter.airportIcao
      ? { airportIcao: { contains: filter.airportIcao, mode: "insensitive" as const } }
      : {}),
    ...(filter.provider
      ? { provider: { contains: filter.provider, mode: "insensitive" as const } }
      : {}),
    ...(filter.priceTier === "free"
      ? { free: true }
      : filter.priceTier === "paid"
        ? { free: false }
        : {}),
  };

  return prisma.scenery.findMany({
    where,
    orderBy: [{ airportIcao: "asc" }, { name: "asc" }],
    include: {
      airline: {
        select: { id: true, name: true, iata: true, icao: true },
      },
    },
  });
}

/**
 * Single scenery by id mit airline-context. Returns null wenn nicht
 * gefunden — caller (page.tsx) macht notFound().
 */
export async function getSceneryById(
  id: string,
): Promise<SceneryWithAirline | null> {
  return prisma.scenery.findUnique({
    where: { id },
    include: {
      airline: {
        select: { id: true, name: true, iata: true, icao: true },
      },
    },
  });
}

/**
 * Convenience helper für die catalog-page: liste von distinct providern
 * (gefiltert auf non-null) sortiert alphabetisch. Wird in der filter-UI
 * als dropdown-options gerendert.
 *
 * Performance: Scenery-table ist klein (catalog wird kuratiert, max
 * dutzende-bis-hunderte rows). Distinct-query ist O(n) aber n ist trivial.
 */
export async function listDistinctProviders(): Promise<string[]> {
  const rows = await prisma.scenery.findMany({
    where: { provider: { not: null } },
    select: { provider: true },
    distinct: ["provider"],
    orderBy: { provider: "asc" },
  });
  // Filter null-safety (provider: { not: null } sollte das schon
  // garantieren, aber TS' nullable-prop bleibt im typ).
  return rows
    .map((r) => r.provider)
    .filter((p): p is string => p !== null);
}

/**
 * Counts nach price-tier für den catalog-summary. Ein info-row "X free
 * / Y paid sceneries" gibt usern eine quick-überblick ohne durch alle
 * cards scrollen zu müssen.
 */
export async function getSceneryCounts(): Promise<{
  total: number;
  free: number;
  paid: number;
}> {
  const [total, free] = await Promise.all([
    prisma.scenery.count(),
    prisma.scenery.count({ where: { free: true } }),
  ]);
  return { total, free, paid: total - free };
}
