/**
 * Track 5 #11 (Section C) — Public-Profile data fetching.
 *
 * Eine helper-funktion die einen scrubbed-public view auf den pilot
 * returnt. Throws "not-found" wenn der user nicht existiert ODER
 * sein isProfilePublic-flag false ist — das ist intentional, weil
 * die page-route /p/[id] in beiden fällen ein 404 returnen soll
 * (nicht "user existiert aber hat sein profile privat gemacht" weil
 * das die existenz des accounts leakt).
 *
 * # Was ist im public-view?
 *
 *   - Identity: id, name, image, bio
 *   - Affiliation: rank-name, airline-icao + name + logoUrl
 *   - Career-aggregates: total flights, total hours, member-since
 *   - Recent flights: letzte 5 approved PIREPs (dep/arr/flight/date)
 *   - Aircraft-types: top 3 (für "fliegt meist...")
 *
 * # Was ist NICHT im public-view?
 *
 *   - Email, discordId, phone, address
 *   - notificationPrefs, economy-data, wallet-balance
 *   - Booking-history, draft PIREPs
 *   - Birthday (unless birthdayPublic, but we skip entirely V1)
 *   - User-awards (V2 — opt-in pro award)
 *   - Active LiveSession / current position (V2 — eigener public-flag)
 *
 * # Performance
 *
 * 1 user-query + 1 pireps-findMany + 1 aircraft-groupBy = 3 queries
 * parallel via Promise.all. Bei einem pilot mit 500 PIREPs: <100ms.
 *
 * # Caching
 *
 * V1 keine ETag/Cache-Control — Next.js renders fresh pro request.
 * Bei nennenswertem traffic könnte man "60s revalidate" setzen aber
 * "letzte 5 PIREPs" ist eine zahl die sich nicht so oft ändert.
 */

import { prisma } from "../index.js";
import type { Prisma } from "@prisma/client";

// SELECT-shape für die User-public-query. Erst `satisfies` für die
// const-inference, dann `GetPayload<{select:...}>` als row-type — der
// extended prisma-client (via $extends) verliert downstream die
// select-payload-inference (siehe ../pilot-stats/personal-bests.ts
// asRecord-comment für details), daher casten wir den returnten user
// mit dem korrekten payload-type.
const USER_PUBLIC_SELECT = {
  id: true,
  name: true,
  image: true,
  bio: true,
  createdAt: true,
  isProfilePublic: true,
  rank: { select: { name: true } },
  airline: { select: { icao: true, name: true, logoUrl: true } },
} satisfies Prisma.UserSelect;

type UserPublicRow = Prisma.UserGetPayload<{
  select: typeof USER_PUBLIC_SELECT;
}>;

export class PublicProfileNotFoundError extends Error {
  constructor() {
    super("Profile nicht gefunden oder nicht öffentlich.");
    this.name = "PublicProfileNotFoundError";
  }
}

export type PublicProfileRecentFlight = {
  id: string;
  submittedAt: Date;
  flightNumber: string | null;
  departureIcao: string;
  arrivalIcao: string;
  aircraftType: string | null;
  flightTimeMin: number | null;
};

export type PublicProfileAircraftStat = {
  type: string;
  flights: number;
};

export type PublicProfile = {
  id: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  rankName: string | null;
  airline: {
    icao: string;
    name: string;
    logoUrl: string | null;
  } | null;
  memberSince: Date;
  totalFlights: number;
  totalHours: number;
  recentFlights: PublicProfileRecentFlight[];
  topAircraft: PublicProfileAircraftStat[];
};

/**
 * Returns scrubbed-public profile data for a user.
 * Throws PublicProfileNotFoundError if user doesn't exist or hasn't
 * opted in.
 */
export async function getPublicProfile(userId: string): Promise<PublicProfile> {
  const userRaw = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_PUBLIC_SELECT,
  });

  if (!userRaw) {
    throw new PublicProfileNotFoundError();
  }
  // Cast — see USER_PUBLIC_SELECT comment für rationale.
  const user = userRaw as UserPublicRow;
  if (!user.isProfilePublic) {
    throw new PublicProfileNotFoundError();
  }

  // Parallel-fetch der aggregates die wir noch brauchen
  const [recentRaw, aggregates, aircraftCounts] = await Promise.all([
    prisma.pirep.findMany({
      where: { userId, status: "Approved" },
      orderBy: { submittedAt: "desc" },
      take: 5,
      select: {
        id: true,
        submittedAt: true,
        flightTimeMin: true,
        route: { select: { flightNumber: true } },
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
        aircraft: { select: { type: true } },
      },
    }),
    prisma.pirep.aggregate({
      where: { userId, status: "Approved" },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),
    prisma.pirep.groupBy({
      by: ["aircraftId"],
      where: {
        userId,
        status: "Approved",
        aircraftId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 3,
    }),
  ]);

  // Aircraft-types resolvent — von aircraftId zu type-string
  const aircraftIds = aircraftCounts
    .map((c) => c.aircraftId)
    .filter((id): id is string => id !== null);
  const aircraftMap = new Map<string, string>();
  if (aircraftIds.length > 0) {
    const aircraft = await prisma.aircraft.findMany({
      where: { id: { in: aircraftIds } },
      select: { id: true, type: true },
    });
    for (const a of aircraft) aircraftMap.set(a.id, a.type);
  }

  // Mehrere aircraft des selben types aggregieren (z.B. zwei A320-
  // registrations zählen als ein "A320")
  const typeAggregate = new Map<string, number>();
  for (const c of aircraftCounts) {
    if (!c.aircraftId) continue;
    const type = aircraftMap.get(c.aircraftId);
    if (!type) continue;
    typeAggregate.set(type, (typeAggregate.get(type) ?? 0) + c._count._all);
  }
  const topAircraft: PublicProfileAircraftStat[] = Array.from(
    typeAggregate.entries(),
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([type, flights]) => ({ type, flights }));

  const recentFlights: PublicProfileRecentFlight[] = recentRaw.map((p) => ({
    id: p.id,
    submittedAt: p.submittedAt,
    flightNumber: p.route?.flightNumber ?? null,
    departureIcao: p.departure.icao,
    arrivalIcao: p.arrival.icao,
    aircraftType: p.aircraft?.type ?? null,
    flightTimeMin: p.flightTimeMin,
  }));

  return {
    id: user.id,
    name: user.name,
    image: user.image,
    bio: user.bio,
    rankName: user.rank?.name ?? null,
    airline: user.airline,
    memberSince: user.createdAt,
    totalFlights: aggregates._count._all,
    totalHours: Math.round(((aggregates._sum.flightTimeMin ?? 0) / 60) * 10) / 10,
    recentFlights,
    topAircraft,
  };
}
