import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * GET /api/acars/airline-routes — Welle B / B5 server phase.
 *
 * Returns the list of active routes for the paired user's airline.
 * The ACARS desktop-client fetches this once (lazily on App.OnStartup
 * after pairing) and caches the result in-memory. The OFP-import flow
 * (option #12) then compares the parsed callsign against this list to
 * decide whether the pasted OFP corresponds to a route the airline
 * actually flies.
 *
 * # Why a separate endpoint rather than bundling
 *
 * The active-booking endpoint already exists for the pre-connect probe,
 * but it only returns the user's CURRENT booking. Route-suggestions
 * need the FULL catalogue: a pilot pastes an OFP for any of their
 * airline's destinations, not just whatever's already booked. The
 * lookup is also fundamentally different (read-once-cache vs per-
 * connect probe), so a dedicated endpoint matches the lifecycle.
 *
 * # Filtering
 *
 * - `airlineId: auth.user.airlineId` — only the pilot's own airline.
 *   No cross-airline leakage even if the pilot is somehow associated
 *   with multiple in the future (today User has a single airlineId
 *   FK; defense-in-depth for tomorrow).
 * - `active: true` — soft-deleted / paused routes don't show up.
 *   Admins use Route.active to retire a route without losing the
 *   PIREP history attached to it; for OFP-import we treat them as
 *   gone.
 *
 * # Response shape
 *
 *   {
 *     routes: [
 *       {
 *         id: string,                      // cuid, for create-booking POST
 *         flightNumber: string,            // "NGN901"
 *         departureIcao: string,           // "EDDK"
 *         arrivalIcao: string,             // "EDDS"
 *         aircraftTypeIcao: string | null, // "A20N" or null for generic
 *       },
 *       ...
 *     ]
 *   }
 *
 * Aircraft-registration is intentionally omitted — Route.aircraftId
 * is an optional pointer to a SPECIFIC airframe (livery preference,
 * tail-number reservation) but most routes only specify the TYPE.
 * The OFP-import matcher works on flightNumber alone; aircraft is
 * just metadata for the create-booking decision and the existing
 * active-booking probe surfaces it later. Keeping this payload lean
 * matters because medium airlines have 500+ routes — 500 rows × ~80
 * bytes each is ~40KB raw, which fits comfortably in a single
 * response but doesn't need extra cargo.
 *
 * # Pagination
 *
 * Not implemented. The expected scale is a few hundred routes per
 * airline, well under 1 MB serialized. If a future airline grows
 * past ~5000 routes, the right move is a delta-fetch protocol
 * (server returns version + diff since last sync) rather than
 * paginated GETs — single full-list refresh is the right fit for
 * the cache-and-compare client.
 *
 * # Sort order
 *
 * `flightNumber asc` so the client can binary-search if it ever
 * needs to, and so the JSON is deterministic for cache-equality
 * comparisons. The client currently does a linear scan on every
 * OFP-import, which is fine at this scale.
 */

export async function GET(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  // User.airlineId is nullable in the schema — solo pilots have no
  // airline. They can still pair the ACARS client (free-flight use
  // case), but they have no airline-routes catalogue to fetch. We
  // return an empty list rather than 4xx so the client treats this
  // as "no suggestions available" without a special error path.
  if (!auth.user.airlineId) {
    return NextResponse.json({ routes: [] });
  }
  const airlineId = auth.user.airlineId;

  const routes = await prisma.route.findMany({
    where: {
      airlineId,
      active: true,
    },
    select: {
      id: true,
      flightNumber: true,
      aircraftTypeIcao: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
    },
    orderBy: { flightNumber: 'asc' },
  });

  return NextResponse.json({
    routes: routes.map((r) => ({
      id: r.id,
      flightNumber: r.flightNumber,
      departureIcao: r.departure.icao,
      arrivalIcao: r.arrival.icao,
      aircraftTypeIcao: r.aircraftTypeIcao,
    })),
  });
}
