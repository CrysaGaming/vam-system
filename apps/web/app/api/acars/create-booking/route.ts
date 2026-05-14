import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, canPilotFlyAircraftStrict } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';

/**
 * POST /api/acars/create-booking — Welle B / B5 server phase.
 *
 * Creates a Booking for the paired user against a Route from their own
 * airline. Triggered from the ACARS desktop-client's OFP-import flow:
 * when the pilot pastes a SimBrief OFP that matches a route in their
 * airline's catalogue, the tray surfaces a "Buchung erstellen" button
 * that POSTs here.
 *
 * # Why a separate endpoint rather than reusing /bookings/actions.ts
 *
 * The existing `createBooking` server-action lives in apps/web/app/
 * bookings/actions.ts and depends on `requireUserWithAirline()` which
 * walks NextAuth's session cookie. The ACARS-client doesn't have a
 * session cookie — it authenticates via the DPAPI-encrypted bearer
 * token (acarsToken). Reusing the server-action would require a
 * synthetic NextAuth session, which is both more code and a worse
 * security model. A dedicated endpoint with explicit auth keeps the
 * boundary clean.
 *
 * # Policy parity with createBooking
 *
 * Mirrors the policy enforced by /bookings/actions.ts:createBooking:
 *   1. Route must belong to the user's airline (no cross-airline
 *      booking-creation).
 *   2. Active-booking-guard: at most one booking in states
 *      Created / SimBriefDispatched / InProgress per user at a time.
 *   3. Career-mode gate: if user.careerEnabled AND airline.careerEnabled,
 *      pilot must have the licenses + type-rating for the route's
 *      aircraftTypeIcao. Routes without an explicit type-requirement
 *      pass the gate unconditionally.
 *   4. expiresAt = now + 7d (hardcoded in v1, same as createBooking).
 *
 * Deliberately NOT included:
 *   - scheduledDeparture: the OFP-import path doesn't capture this.
 *     Pilot can edit the booking from the web UI later if they want
 *     to time-lock it.
 *   - legCount: V1 always 1 (default). Multi-leg tours come from a
 *     deliberate admin/pilot decision, not from an OFP-paste.
 *   - intendedNetwork: the OFP-import parser doesn't extract network
 *     (SimBrief/FlightAware OFPs don't tag it). Tray-client's
 *     NetworkBox is the source-of-truth at Verbinden-time anyway.
 *
 * # Why no idempotency token
 *
 * The active-booking-guard IS the idempotency guarantee for this
 * endpoint: a second POST while a booking is already active returns
 * 409 with the existing booking's ID, not a duplicate row. The client
 * can safely retry; double-clicks at worst surface a "you already have
 * an active booking" hint, never two bookings.
 *
 * # Response shape
 *
 * 200 on success:
 *   {
 *     booking: {
 *       id: string,
 *       flightNumber: string,
 *       departureIcao: string,
 *       arrivalIcao: string,
 *     }
 *   }
 *
 * 4xx on policy failure:
 *   - 400 invalid body (zod parse failure)
 *   - 401 missing/invalid bearer token (handled by authenticateAcarsRequest)
 *   - 404 route not found in user's airline
 *   - 409 active booking already exists OR career-gate blocked
 *   Body: { error: "<machine-readable-code>", message: "<human-readable-de>" }
 *
 * Status codes were picked to match what the tray-client expects to
 * surface to the pilot:
 *   - 404 → "Diese Route existiert nicht in deiner Airline" (admin
 *     deleted it between OFP-cache and Buchung-Klick)
 *   - 409 → human-readable explanation (active booking, missing
 *     licenses, etc.) — the client just shows the `message` field.
 */

const CreateBookingSchema = z.object({
  routeId: z.string().min(1).max(64),
});

export async function POST(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  // User.airlineId is nullable — solo pilots can pair the ACARS client
  // for free-flight use but cannot create airline-bookings (there's no
  // airline to attach the booking to). 409 with a clear message so the
  // client can surface "you're not in an airline" rather than the
  // generic policy-error fallback.
  if (!auth.user.airlineId) {
    return NextResponse.json(
      {
        error: 'no-airline',
        message:
          'Du bist keiner Airline zugeordnet. Booking-Erstellung über die ACARS-Schnittstelle erfordert eine Airline-Mitgliedschaft.',
      },
      { status: 409 },
    );
  }
  const airlineId = auth.user.airlineId;

  // Body-parse. We don't try/catch JSON.parse separately — Next's
  // req.json() throws on malformed input and the try/catch below
  // converts that into a 400.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid-json', message: 'Request body ist kein gültiges JSON.' },
      { status: 400 },
    );
  }

  const parsed = CreateBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid-body',
        message: 'routeId fehlt oder hat ein ungültiges Format.',
      },
      { status: 400 },
    );
  }
  const { routeId } = parsed.data;

  // ─── Step 1: route lookup with airline-scope guard ─────────────────
  //
  // `findFirst` with airlineId in the WHERE clause prevents cross-airline
  // booking-creation even if the client cooked a routeId from another
  // airline. Same defense-in-depth as createBooking in actions.ts.
  const route = await prisma.route.findFirst({
    where: {
      id: routeId,
      airlineId,
      active: true,
    },
    select: { id: true, flightNumber: true, aircraftTypeIcao: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } } },
  });
  if (!route) {
    return NextResponse.json(
      {
        error: 'route-not-found',
        message: 'Diese Route existiert nicht in deiner Airline oder ist deaktiviert.',
      },
      { status: 404 },
    );
  }

  // ─── Step 2: career-mode gate ──────────────────────────────────────
  //
  // If the airline + user both have career-mode enabled, the pilot
  // needs licenses + type-rating for the route's aircraftTypeIcao.
  // canPilotFlyAircraftStrict returns { enforced: false } when career-
  // mode is off (most setups) — passes through without a license check.
  //
  // Routes without aircraftTypeIcao (generic/charter routes) skip the
  // gate entirely: canPilotFlyAircraftStrict still runs but the underlying
  // requirements lookup returns an empty `missing` array.
  //
  // We do this BEFORE the active-booking guard so a pilot with no
  // licenses sees "missing licenses" rather than "active booking
  // exists" — career-gate is the more actionable feedback.
  if (route.aircraftTypeIcao) {
    const careerCheck = await canPilotFlyAircraftStrict({
      userId: auth.user.id,
      airlineId,
      aircraftType: route.aircraftTypeIcao,
    });
    if (careerCheck.enforced && !careerCheck.allowed) {
      // Human-readable list of missing items so the client can surface
      // exactly what the pilot is short on. Matches the error-message
      // format from enforceCareerGateForRoute in actions.ts so future
      // UI patterns can share copy.
      const missingList = careerCheck.missing.join(', ');
      return NextResponse.json(
        {
          error: 'career-gate-blocked',
          message:
            `Career-System: Du hast nicht alle Lizenzen für ${route.aircraftTypeIcao}. ` +
            `Es fehlen: ${missingList}. ` +
            `Wende dich an deinen Airline-Admin oder absolviere die nötige Ausbildung in einer Flight-School.`,
        },
        { status: 409 },
      );
    }
  }

  // ─── Step 3: active-booking guard ──────────────────────────────────
  //
  // Same triple-state filter as createBooking/actions.ts and as the
  // active-booking endpoint. Returns 409 with the existing booking-id
  // so the client can offer "switch to existing booking" UX in the
  // future. For now the tray just shows the friendly message.
  const existing = await prisma.booking.findFirst({
    where: {
      userId: auth.user.id,
      airlineId,
      state: { in: ['Created', 'SimBriefDispatched', 'InProgress'] },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: 'active-booking-exists',
        message:
          'Du hast bereits eine aktive Buchung. Storniere oder beende sie zuerst, bevor du eine neue erstellst.',
        existingBookingId: existing.id,
      },
      { status: 409 },
    );
  }

  // ─── Step 4: create the booking ────────────────────────────────────
  //
  // Same shape as createBooking/actions.ts:
  //   - state: defaults to 'Created' via @default in schema
  //   - legCount: defaults to 1
  //   - intendedNetwork: null (we don't take it from the body in v1)
  //   - scheduledDeparture: null (V1 limitation; pilot can edit later)
  //   - expiresAt: now + 7d (hardcoded v1, same as actions.ts)
  //
  // No transaction needed — the only write is this single insert.
  // The active-booking guard above is read-then-write, so there's a
  // theoretical TOCTOU window where two simultaneous POSTs could both
  // pass the guard and create two bookings. Acceptable: (a) the
  // double-booking would just sit as state=Created and the pilot can
  // cancel one from the web UI, (b) the ACARS-client only ever calls
  // this from a user button-click, (c) the race window is sub-ms.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const booking = await prisma.booking.create({
    data: {
      airlineId,
      userId: auth.user.id,
      routeId: route.id,
      expiresAt,
    },
    select: { id: true },
  });

  return NextResponse.json({
    booking: {
      id: booking.id,
      flightNumber: route.flightNumber,
      departureIcao: route.departure.icao,
      arrivalIcao: route.arrival.icao,
    },
  });
}
