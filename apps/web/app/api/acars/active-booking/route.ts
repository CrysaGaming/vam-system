import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * GET /api/acars/active-booking — Welle B / B4 phase 1.
 *
 * Returns the user's currently-active Booking (states Created /
 * SimBriefDispatched / InProgress) with the route + booked aircraft
 * details the ACARS client needs to compare against the sim-loaded
 * aircraft. Used by the tray app's pre-connect "aircraft mismatch"
 * checklist.
 *
 * Why a separate endpoint rather than bundling into /status:
 *   - /status is called periodically (every ~1min) as a health-check.
 *     The booking lookup involves a join (Booking → Route → Aircraft)
 *     and we don't want to do that on every health-check.
 *   - The pre-connect probe is a single one-shot at the start of a
 *     flight, after the user clicks "Sim-Probe" but before "Verbinden".
 *     A dedicated endpoint matches the lifecycle of that decision.
 *   - Future booking-aware features (B5 route-suggestions, weather
 *     pre-cache) can reuse this endpoint without bloating /status.
 *
 * Response shape on success:
 *   {
 *     booking: {
 *       id: string,
 *       state: BookingState,
 *       flightNumber: string,         // from Route.flightNumber
 *       departureIcao: string,
 *       arrivalIcao: string,
 *       aircraft: {
 *         id: string,
 *         type: string,               // ICAO designator (A20N, B738, ...)
 *         registration: string,
 *       } | null
 *     } | null
 *   }
 *
 * When the pilot has no active booking, returns `{ booking: null }`
 * rather than 404 — the tray treats "no booking" as a valid state
 * (free flight) and just skips the mismatch dialog. 404 would force
 * the tray into an error-handling branch for a normal scenario.
 *
 * Active-booking definition: Created | SimBriefDispatched | InProgress.
 * Same triple used by generate-pirep.ts when it looks for a Booking
 * to attach a PIREP to — kept consistent so the tray and server agree
 * on what counts as "the booking that's about to fly".
 *
 * Multi-leg tours: a booking in InProgress (legCount > 1, partially
 * completed) is still the active booking for subsequent legs. We
 * return it as-is; the tray's mismatch check is against the booked
 * AIRCRAFT, which doesn't change across legs of the same tour, so
 * the logic is unchanged.
 *
 * Aircraft nullability: Route.aircraftId is optional in the schema —
 * routes can exist without a specific aircraft assignment (charter,
 * type-flexible routes). When booking.route.aircraft is null, the
 * tray should skip the mismatch dialog: there's nothing to compare
 * against. The response field is `aircraft: null` in that case.
 *
 * Sort-order: `orderBy: { createdAt: 'desc' }` so the most recently-
 * created booking wins if a user somehow has multiple active. In
 * normal flow there's at most one per user (the booking-create flow
 * doesn't enforce a unique-constraint, but practice is one-at-a-time).
 */

export async function GET(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  const booking = await prisma.booking.findFirst({
    where: {
      userId: auth.user.id,
      // Same active-states triple as generate-pirep.ts. Excludes
      // Completed/Cancelled/Expired which are historical / dead.
      state: { in: ['Created', 'SimBriefDispatched', 'InProgress'] },
    },
    select: {
      id: true,
      state: true,
      route: {
        select: {
          flightNumber: true,
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
          aircraft: {
            select: {
              id: true,
              type: true,
              registration: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!booking) {
    return NextResponse.json({ booking: null });
  }

  return NextResponse.json({
    booking: {
      id: booking.id,
      state: booking.state,
      flightNumber: booking.route.flightNumber,
      departureIcao: booking.route.departure.icao,
      arrivalIcao: booking.route.arrival.icao,
      aircraft: booking.route.aircraft
        ? {
            id: booking.route.aircraft.id,
            type: booking.route.aircraft.type,
            registration: booking.route.aircraft.registration,
          }
        : null,
    },
  });
}
