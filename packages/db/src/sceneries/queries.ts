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
 *
 * # Track 4 #17 — owned-filter
 *
 * - `owned`: "mine" (nur sceneries die der user besitzt) | "none" (nur die
 *   er NICHT besitzt) | undefined (alle, default).
 * - `forUserId`: required wenn owned-filter gesetzt ist. Sonst kann der
 *   helper nicht wissen wessen ownership relevant ist.
 *
 * Wenn `owned` ohne `forUserId` gesetzt wird, ignoriert der helper den
 * filter (defensive — verhindert ungewollte cross-user-leaks bei tipp-
 * fehlern im caller).
 */
export type SceneryFilter = {
  airlineId?: "all" | "global" | string;
  airportIcao?: string;
  provider?: string;
  priceTier?: "free" | "paid";
  owned?: "mine" | "none";
  forUserId?: string;
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
  const where: Record<string, unknown> = {
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

  // Track 4 #17: owned-filter via existence/non-existence check auf
  // UserScenery. Defensive: nur greifen wenn forUserId gesetzt ist
  // (sonst würde "owned=mine" ohne user-id z.B. einen empty-result
  // liefern was sich wie ein bug anfühlt).
  if (filter.owned && filter.forUserId) {
    if (filter.owned === "mine") {
      where.userSceneries = { some: { userId: filter.forUserId } };
    } else if (filter.owned === "none") {
      where.userSceneries = { none: { userId: filter.forUserId } };
    }
  }

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

/**
 * Track 4 #17 — Liefert die ownership-set des users als Set<string> für
 * O(1) hat-er-die-scenery-checks beim card-rendering.
 *
 * Statt N+1 queries ("für jede card: hat user X scenery Y?") fetched
 * der caller einmal das ownership-set und macht dann lookups in JS.
 *
 * Returns ein leeres Set wenn der user noch keine sceneries gemarked
 * hat (oder nicht existiert) — kein null/undefined, damit caller-side
 * keine null-checks pro lookup.
 */
export async function getUserOwnedSceneryIds(
  userId: string,
): Promise<Set<string>> {
  const rows = await prisma.userScenery.findMany({
    where: { userId },
    select: { sceneryId: true },
  });
  return new Set(rows.map((r) => r.sceneryId));
}

/**
 * Track 4 #17 — Toggle ownership für (user, scenery). Wenn der record
 * existiert: löschen (= "habe ich nicht mehr"). Wenn nicht: erstellen
 * (= "habe ich jetzt"). Idempotent gegen race-conditions via
 * upsert-style logik im transaction-block.
 *
 * Returns `{ owned: boolean }` — der NEUE state nach der toggle-action.
 * UI nutzt das für die optimistic-update-correction wenn die optimistic
 * prediction abweicht (sollte nie passieren bei single-toggle-clicks,
 * aber defensive bei concurrent-tabs).
 *
 * Atomicity: prisma's $transaction garantiert dass das delete-or-create
 * als single unit ausgeführt wird. Bei concurrent toggles auf das
 * gleiche pair gewinnt der letzte committer — die andere transaction
 * sieht einen unique-violation oder einen leeren delete-result.
 */
export async function toggleUserScenery(
  userId: string,
  sceneryId: string,
): Promise<{ owned: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.userScenery.findUnique({
      where: { userId_sceneryId: { userId, sceneryId } },
      select: { id: true },
    });

    if (existing) {
      await tx.userScenery.delete({
        where: { userId_sceneryId: { userId, sceneryId } },
      });
      return { owned: false };
    }

    await tx.userScenery.create({
      data: { userId, sceneryId },
    });
    return { owned: true };
  });
}
