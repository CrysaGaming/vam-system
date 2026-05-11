'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma, NetworkType, canPilotFlyAircraftStrict } from '@vam/db';
import { requireUserWithAirline } from '@/lib/auth';
import { fetchSimBriefOfp } from '@/lib/simbrief/fetchOfp';
import { fetchSimBriefOfpDirect } from '@/lib/simbrief/fetchOfpDirect';
import { buildSimBriefDispatchUrl } from '@/lib/simbrief/buildDispatchUrl';

/**
 * Welle 13E-7 — Career-mode booking-gate.
 *
 * Helper, gerufen von allen drei booking-creators (createBooking,
 * cloneBooking, createBookingFromScheduledFlight). Prüft via
 * canPilotFlyAircraftStrict ob:
 *   1. Career-mode aktiv ist (dual-flag user.careerEnabled UND airline.
 *      careerEnabled). Wenn nicht: noop, return — booking erlaubt.
 *   2. Wenn enforced: hat der pilot alle required licenses + type-rating
 *      für den aircraft-type der route? Wenn missing: throw mit klarer
 *      deutscher error-message + liste der missing-items.
 *
 * Routes ohne aircraftTypeIcao (älter / generic) werden nicht geblockt —
 * der gate gilt nur für routes mit explizitem type-requirement.
 *
 * Aufruf-pattern: vor dem prisma.booking.create. Wenn dieser helper
 * throws, wird der booking nie erstellt → keine zombie-bookings ohne
 * qualifikation.
 */
async function enforceCareerGateForRoute(
  userId: string,
  airlineId: string,
  aircraftTypeIcao: string | null,
): Promise<void> {
  if (!aircraftTypeIcao) {
    // Generic route ohne type-requirement → kein gate. Career-mode-
    // airlines wollen typischerweise alle routes mit type-requirement
    // pflegen, aber wir blocken nicht hart.
    return;
  }

  const result = await canPilotFlyAircraftStrict({
    userId,
    airlineId,
    aircraftType: aircraftTypeIcao,
  });

  if (!result.enforced) {
    // Career-mode aus → booking immer erlaubt.
    return;
  }

  if (!result.allowed) {
    // Pilot hat nicht alle required licenses / type-rating.
    // Error-message soll dem pilot direkt sagen WAS fehlt — er kann
    // dann zum airline-admin gehen und nachfragen oder zur flight-
    // school zur ausbildung.
    const missingList = result.missing.join(', ');
    const cat = result.requirements.category;
    throw new Error(
      `Career-System: Du hast nicht alle Lizenzen für ${aircraftTypeIcao} ` +
        `(${cat}). Es fehlen: ${missingList}. ` +
        `Wende dich an deinen Airline-Admin oder absolviere die nötige ` +
        `Ausbildung in einer Flight-School.`,
    );
  }
}

const CreateBookingSchema = z.object({
  routeId: z.string().cuid(),
  intendedNetwork: z.nativeEnum(NetworkType).optional(),
  // ISO-8601 UTC datetime — set by client from datetime-local input
  // converted via `new Date(value).toISOString()`. Optional. Keine
  // past-date validation in v1 (User darf "rückwirkend" planen falls
  // training-replay).
  scheduledDeparture: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  // Multi-leg tour support (option #17 UI for the option #12 schema).
  // legCount=1 (default) → legacy single-flight booking, no observable
  // change. legCount>1 → tour-booking that stays in InProgress between
  // each PIREP file until legsCompleted reaches legCount, then flips
  // to Completed.
  //
  // Cap at 10 because (a) UI input becomes unwieldy past 10, (b) longer
  // tours are better split into multiple bookings for navigation, and
  // (c) the same-route-repeat semantics break down at scale (nobody
  // flies EDDF→LEMD twenty times in a row). For real cross-route
  // tours a future v2 would introduce a BookingLeg model with per-leg
  // routeId — see commit message for the design discussion.
  legCount: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1),
});

const CancelBookingSchema = z.object({
  bookingId: z.string().cuid(),
  reason: z.string().trim().max(500).optional(),
});

const RefreshSimBriefOfpSchema = z.object({
  bookingId: z.string().cuid(),
});

// Pattern Z popup callback. ofpId comes from the JS in the popup-output
// redirect, format `<10-digit-timestamp>_<10-char-hash>` per the upstream
// Partner-API. We re-validate the format here (the API route does too)
// so a tampered query parameter cannot reach fetchSimBriefOfpDirect.
const ProcessSimBriefCallbackSchema = z.object({
  bookingId: z.string().cuid(),
  ofpId: z.string().regex(/^[0-9]{10}_[A-Za-z0-9]{10}$/),
});

const PlanSimBriefBookingSchema = z.object({
  bookingId: z.string().cuid(),
});

export async function createBooking(
  input: z.input<typeof CreateBookingSchema>,
) {
  const { routeId, intendedNetwork, scheduledDeparture, legCount } =
    CreateBookingSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const route = await prisma.route.findFirst({
    where: { id: routeId, airlineId },
    select: { id: true, aircraftTypeIcao: true },
  });
  if (!route) {
    throw new Error('Route not found or not in your airline');
  }

  // Welle 13E-7: Career-mode booking-gate. Bei aktiviertem career-system
  // (user.careerEnabled UND airline.careerEnabled) muss der pilot die
  // licenses + type-rating für den route-aircraft-type haben. Helper
  // throws mit deutscher message wenn was fehlt.
  await enforceCareerGateForRoute(userId, airlineId, route.aircraftTypeIcao);

  // Active-booking guard. 'InProgress' (option #12 multi-leg) belongs
  // here too — a tour-booking with legCount>1 sits in InProgress
  // between legs and the pilot must finish (or cancel) it before
  // starting another booking. Without InProgress in this filter the
  // pilot could create a second booking mid-tour and silently abandon
  // the first.
  const existing = await prisma.booking.findFirst({
    where: {
      userId,
      airlineId,
      state: { in: ['Created', 'SimBriefDispatched', 'InProgress'] },
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error('Active booking already exists. Cancel or complete it first.');
  }

  // v1: hardcoded 7d TTL (siehe Booking.expiresAt im Schema)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const booking = await prisma.booking.create({
    data: {
      airlineId,
      userId,
      routeId,
      intendedNetwork,
      scheduledDeparture,
      legCount,
      expiresAt,
    },
    select: { id: true, state: true, expiresAt: true },
  });

  revalidatePath('/bookings');

  return booking;
}

export async function cancelBooking(
  input: z.infer<typeof CancelBookingSchema>,
) {
  const { bookingId, reason } = CancelBookingSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, airlineId, userId },
    select: { id: true, state: true },
  });
  if (!booking) {
    throw new Error('Booking not found or not yours');
  }

  // Cancellable states: anything that's not already in a terminal state.
  // 'InProgress' (option #12 multi-leg) is allowed because a pilot may
  // need to abort a tour mid-leg (illness, sim-crash, change of plans).
  // Cancellation completes any partial-progress without reverting the
  // already-filed PIREPs — those stay as standalone PIREPs. The booking
  // itself just transitions to Cancelled.
  if (
    booking.state !== 'Created' &&
    booking.state !== 'SimBriefDispatched' &&
    booking.state !== 'InProgress'
  ) {
    throw new Error(`Cannot cancel booking in state ${booking.state}`);
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      state: 'Cancelled',
      cancelledAt: new Date(),
      cancellationReason: reason ?? null,
    },
    select: { id: true, state: true, cancelledAt: true },
  });

  revalidatePath('/bookings');

  return updated;
}

export async function refreshSimBriefOfp(
  input: z.infer<typeof RefreshSimBriefOfpSchema>,
): Promise<{
  status: 'plan-found' | 'no-plan';
  ofpId: string | null;
}> {
  const { bookingId } = RefreshSimBriefOfpSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, airlineId, userId },
    select: {
      id: true,
      state: true,
      user: { select: { simBriefUsername: true } },
      flightPlanCache: {
        select: {
          id: true,
          // Track-4 #68: snapshot current cache values before overwrite
          // so we can populate previous*-fields in the update below.
          ofpId: true,
          fuelKg: true,
          blockTimeMin: true,
          routeString: true,
          generatedAt: true,
        },
      },
    },
  });
  if (!booking) {
    throw new Error('Booking not found or not yours');
  }
  if (
    booking.state === 'Cancelled' ||
    booking.state === 'Completed' ||
    booking.state === 'Expired'
  ) {
    throw new Error(`Cannot refresh SimBrief for booking in state ${booking.state}`);
  }
  if (!booking.user.simBriefUsername) {
    throw new Error('Set your SimBrief username in Settings to enable Pattern α refresh');
  }

  const staticId = `vam-${booking.id}`;
  const parsed = await fetchSimBriefOfp(booking.user.simBriefUsername, staticId);

  if (parsed === null) {
    if (booking.flightPlanCache) {
      await prisma.flightPlanCache.delete({
        where: { id: booking.flightPlanCache.id },
      });
      await prisma.booking.update({
        where: { id: bookingId },
        data: { state: 'Created', dispatchedAt: null },
      });
      revalidatePath('/bookings');
    }
    return { status: 'no-plan', ofpId: null };
  }

  const params = parsed.rawResponse.params as
    | Record<string, unknown>
    | undefined;
  const xmlStaticId =
    typeof params?.static_id === 'string' ? params.static_id : null;
  if (xmlStaticId !== staticId) {
    throw new Error(
      `OFP does not match this booking (static_id mismatch: expected ${staticId}, got ${xmlStaticId ?? 'null'})`,
    );
  }

  const cacheTtlMs = 6 * 60 * 60 * 1000;
  const cacheData = {
    airlineId,
    bookingId: booking.id,
    ofpId: parsed.ofpId,
    rawResponse: parsed.rawResponse as Prisma.InputJsonValue,
    routeString: parsed.routeString,
    fuelKg: parsed.fuelKg,
    blockTimeMin: parsed.blockTimeMin,
    expiresAt: new Date(Date.now() + cacheTtlMs),
  };

  if (booking.flightPlanCache) {
    // Track-4 #68: snapshot the values we're about to overwrite into the
    // previous*-fields so the UI can show what changed at refresh time.
    const prev = booking.flightPlanCache;
    await prisma.flightPlanCache.update({
      where: { id: prev.id },
      data: {
        ...cacheData,
        previousOfpId: prev.ofpId,
        previousFuelKg: prev.fuelKg,
        previousBlockTimeMin: prev.blockTimeMin,
        previousRouteString: prev.routeString,
        previousGeneratedAt: prev.generatedAt,
      },
    });
  } else {
    await prisma.flightPlanCache.create({ data: cacheData });
  }

  if (booking.state !== 'SimBriefDispatched') {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { state: 'SimBriefDispatched', dispatchedAt: new Date() },
    });
  }

  revalidatePath('/bookings');
  return { status: 'plan-found', ofpId: parsed.ofpId };
}

export async function planSimBriefBooking(
  input: z.infer<typeof PlanSimBriefBookingSchema>,
): Promise<{ url: string }> {
  const { bookingId } = PlanSimBriefBookingSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, airlineId, userId },
    include: {
      route: {
        include: {
          departure: { select: { icao: true } },
          arrival: { select: { icao: true } },
          aircraft: { select: { type: true, registration: true } },
        },
      },
      airline: { select: { icao: true } },
      user: { select: { name: true } },
    },
  });
  if (!booking) {
    throw new Error('Booking not found or not yours');
  }
  if (!booking.route.aircraft) {
    throw new Error('Route has no aircraft assigned — cannot plan SimBrief');
  }
  if (
    booking.state === 'Cancelled' ||
    booking.state === 'Completed' ||
    booking.state === 'Expired'
  ) {
    throw new Error(`Cannot plan SimBrief for booking in state ${booking.state}`);
  }

  const url = buildSimBriefDispatchUrl({
    bookingId: booking.id,
    airline: { icao: booking.airline.icao },
    route: { flightNumber: booking.route.flightNumber },
    aircraft: {
      type: booking.route.aircraft.type,
      registration: booking.route.aircraft.registration,
    },
    departure: { icao: booking.route.departure.icao },
    arrival: { icao: booking.route.arrival.icao },
    user: { name: booking.user.name },
    scheduledDeparture: booking.scheduledDeparture,
  });

  return { url };
}

/**
 * Pattern Z post-popup callback handler.
 *
 * Triggered when the booking-detail page loads with `?ofp_id=…` in the
 * URL — that query parameter is appended by the JS in the SimBrief popup
 * once it auto-closes (see Redirect_caller in /public/simbrief.apiv1.js).
 * This action fetches the OFP from the SimBrief CDN by ofp_id, verifies
 * the static_id matches `vam-<bookingId>` (preventing a malicious user
 * from grafting somebody else's ofp_id onto their booking), and persists
 * the result to FlightPlanCache exactly the way refreshSimBriefOfp does.
 *
 * The fact that both Pattern α and Pattern Z funnel into the same
 * FlightPlanCache shape is intentional: downstream features (PIREP,
 * tracking, dispatch overlay) don't need to know which path produced the
 * cached OFP.
 *
 * Idempotent: calling this twice with the same ofpId updates the existing
 * cache row rather than creating a duplicate. The page-level handler can
 * therefore safely re-trigger on browser reload without poisoning state.
 */
export async function processSimBriefCallback(
  input: z.infer<typeof ProcessSimBriefCallbackSchema>,
): Promise<{ ofpId: string }> {
  const { bookingId, ofpId } = ProcessSimBriefCallbackSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, airlineId, userId },
    select: {
      id: true,
      state: true,
      flightPlanCache: {
        select: {
          id: true,
          // Track-4 #68: snapshot current cache values before overwrite
          // so we can populate previous*-fields in the update below.
          ofpId: true,
          fuelKg: true,
          blockTimeMin: true,
          routeString: true,
          generatedAt: true,
        },
      },
    },
  });
  if (!booking) {
    throw new Error('Booking not found or not yours');
  }
  if (
    booking.state === 'Cancelled' ||
    booking.state === 'Completed' ||
    booking.state === 'Expired'
  ) {
    throw new Error(
      `Cannot accept SimBrief callback for booking in state ${booking.state}`,
    );
  }

  const parsed = await fetchSimBriefOfpDirect(ofpId);

  // Cross-check: the OFP's static_id must match the one we embedded in the
  // form fields. Without this check, a user could open a booking detail
  // page and append `?ofp_id=` of an OFP they generated for a different
  // booking (or someone else's) to mis-attribute the plan.
  const params = parsed.rawResponse.params as
    | Record<string, unknown>
    | undefined;
  const expectedStaticId = `vam-${booking.id}`;
  const xmlStaticId =
    typeof params?.static_id === 'string' ? params.static_id : null;
  if (xmlStaticId !== expectedStaticId) {
    throw new Error(
      `OFP does not match this booking (static_id mismatch: expected ${expectedStaticId}, got ${xmlStaticId ?? 'null'})`,
    );
  }

  // Same 6h cache TTL as refreshSimBriefOfp — the OFP is a snapshot of
  // weather + AIRAC at generation time and goes stale fast.
  const cacheTtlMs = 6 * 60 * 60 * 1000;
  const cacheData = {
    airlineId,
    bookingId: booking.id,
    ofpId: parsed.ofpId,
    rawResponse: parsed.rawResponse as Prisma.InputJsonValue,
    routeString: parsed.routeString,
    fuelKg: parsed.fuelKg,
    blockTimeMin: parsed.blockTimeMin,
    expiresAt: new Date(Date.now() + cacheTtlMs),
  };

  if (booking.flightPlanCache) {
    // Track-4 #68: snapshot previous values before overwrite — analog
    // zum refreshSimBriefOfp-pfad oben, weil Pattern Z auch ein "refresh"
    // ist wenn der pilot mehrfach via popup-flow neue OFPs erzeugt.
    const prev = booking.flightPlanCache;
    await prisma.flightPlanCache.update({
      where: { id: prev.id },
      data: {
        ...cacheData,
        previousOfpId: prev.ofpId,
        previousFuelKg: prev.fuelKg,
        previousBlockTimeMin: prev.blockTimeMin,
        previousRouteString: prev.routeString,
        previousGeneratedAt: prev.generatedAt,
      },
    });
  } else {
    await prisma.flightPlanCache.create({ data: cacheData });
  }

  if (booking.state !== 'SimBriefDispatched') {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { state: 'SimBriefDispatched', dispatchedAt: new Date() },
    });
  }

  // NOTE: revalidatePath cannot be called here because this action is
  // invoked from the render path of `app/bookings/[id]/page.tsx` (the
  // `if (ofpIdParam)` branch), and Next.js 16 forbids cache-mutating
  // calls during render. The other revalidatePath sites in this file
  // are fine because they're called from `<form action={...}>` which
  // is the proper Server Action context.
  //
  // We don't actually need it here: the page-level handler immediately
  // calls `redirect('/bookings/[id]')` after this action returns, and
  // `redirect()` performs a full navigation that fetches fresh data —
  // the `/bookings` listing also re-fetches on next visit. So the cache
  // invalidation we'd want from revalidatePath happens implicitly via
  // navigation here. Live-verified Day-4-cont Phase A.
  return { ofpId: parsed.ofpId };
}

const CloneBookingSchema = z.object({
  bookingId: z.string().cuid(),
});

/**
 * Clone an existing booking — creates a new Booking with the same route
 * (and indirectly aircraft via route.aircraft), intendedNetwork, but
 * resets transient fields:
 *   - state → Created (default)
 *   - scheduledDeparture → null (user re-decides timing)
 *   - dispatchedAt → null
 *   - cancelledAt/cancellationReason → null
 *   - expiresAt → now + 7d (fresh TTL)
 *
 * Reuses the active-booking-guard from createBooking so the user can't
 * clone while another active flight is pending.
 *
 * Scope: source booking must be owned by current user AND in their
 * airline (defense-in-depth — userId-check alone would suffice but
 * airlineId-mismatch is a corruption-state we want to surface).
 *
 * Returns the new booking id so the caller can redirect to the detail
 * page. Caller is expected to then navigate the user to the new
 * booking's edit-flow (currently just /bookings/[newId]).
 */
export async function cloneBooking(
  input: z.input<typeof CloneBookingSchema>,
) {
  const { bookingId } = CloneBookingSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const source = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      airlineId: true,
      routeId: true,
      intendedNetwork: true,
      route: { select: { aircraftTypeIcao: true } },
    },
  });

  if (!source || source.userId !== userId || source.airlineId !== airlineId) {
    throw new Error('Booking not found');
  }

  // Welle 13E-7: Career-gate auch im clone-flow. Eine alte license-
  // konfiguration (die zum zeitpunkt des original-bookings noch passte)
  // könnte jetzt expired sein — wir re-checken anhand des aktuellen
  // license-state.
  await enforceCareerGateForRoute(
    userId,
    airlineId,
    source.route.aircraftTypeIcao,
  );

  // Same active-booking constraint as createBooking — prevent the user
  // from accumulating multiple in-flight clones. They must cancel/
  // complete the current active one first. 'InProgress' belongs in
  // the filter for the same reason as in createBooking (option #12
  // multi-leg tours).
  const existing = await prisma.booking.findFirst({
    where: {
      userId,
      airlineId,
      state: { in: ['Created', 'SimBriefDispatched', 'InProgress'] },
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      'Du hast bereits ein aktives Booking. Storniere oder beende es zuerst.',
    );
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const booking = await prisma.booking.create({
    data: {
      airlineId,
      userId,
      routeId: source.routeId,
      intendedNetwork: source.intendedNetwork,
      // scheduledDeparture intentionally omitted → null. User picks a
      // new departure time (or none) on the new booking. Cloning
      // typically means "same flight tomorrow", so the original time
      // is rarely relevant.
      expiresAt,
    },
    select: { id: true },
  });

  revalidatePath('/bookings');

  return { id: booking.id };
}
// ─────────────────────────────────────────────────────────────────────────
// Booking from scheduled flight (Welle 7 commit 7C)
// ─────────────────────────────────────────────────────────────────────────

const CreateBookingFromScheduledFlightSchema = z.object({
  scheduledFlightId: z.string().cuid(),
  intendedNetwork: z.nativeEnum(NetworkType).optional(),
});

/**
 * Create a Booking by claiming an existing ScheduledFlight slot.
 *
 * Mirrors createBooking's policy (active-booking-guard, airline-scope,
 * 7d TTL) but inherits route + departure-time from the slot rather than
 * accepting them as input. The user effectively picks a pre-planned
 * timeslot from the airline's published schedule.
 *
 * Race-handling: two pilots tapping the same slot at the same moment
 * could both pass our preliminary checks. The atomic claim is done via
 * `updateMany({ where: { status: 'Planned', bookingId: null } })` —
 * Postgres serializes these and exactly one returns count=1. The loser
 * sees a friendly error and re-renders the slot as taken.
 *
 * Transaction order:
 *   1. Claim the slot (status → Booked, bookingId still null)
 *   2. Create the Booking row (gets new id)
 *   3. Set bookingId on the slot (now safe from race — we own it)
 * If step 2 or 3 throws, the transaction reverts the claim (slot returns
 * to Planned, bookingId still null). User can retry.
 *
 * scheduledDeparture: copied from slot.departureTime (UTC). User does NOT
 * get to override it for scheduled flights — the schedule is the airline's
 * commitment. If they want flexible timing, they use Free Flight.
 *
 * NetworkType: optional, same semantics as createBooking — UI hint, not
 * enforced. Actual network comes from PIREP/LiveSession later.
 */
export async function createBookingFromScheduledFlight(
  input: z.input<typeof CreateBookingFromScheduledFlightSchema>,
) {
  const { scheduledFlightId, intendedNetwork } =
    CreateBookingFromScheduledFlightSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  // Active-booking guard — same constraint as createBooking. Done OUTSIDE
  // the transaction because it's read-only and we want to fail fast before
  // touching the slot. There's a tiny TOCTOU window where the user could
  // create another booking concurrently — but the worst case is they have
  // two active bookings, which is a UX issue, not a data-corruption one.
  const existingActive = await prisma.booking.findFirst({
    where: {
      userId,
      airlineId,
      state: { in: ['Created', 'SimBriefDispatched', 'InProgress'] },
    },
    select: { id: true },
  });
  if (existingActive) {
    throw new Error(
      'Du hast bereits ein aktives Booking. Storniere oder beende es zuerst.',
    );
  }

  // Pre-fetch slot details for routeId + scheduledDeparture. Done outside
  // the transaction for the same reason as above (read-only, fail-fast on
  // not-found / wrong-airline). The actual claim re-checks status + bookingId
  // atomically.
  const slot = await prisma.scheduledFlight.findUnique({
    where: { id: scheduledFlightId },
    select: {
      id: true,
      airlineId: true,
      routeId: true,
      departureTime: true,
      status: true,
      bookingId: true,
      route: { select: { aircraftTypeIcao: true } },
    },
  });
  if (!slot || slot.airlineId !== airlineId) {
    throw new Error('Scheduled flight not found in your airline');
  }
  if (slot.status !== 'Planned' || slot.bookingId !== null) {
    throw new Error('Dieser slot ist bereits vergeben oder cancelled.');
  }

  // Welle 13E-7: Career-gate auch im scheduled-flight-flow. Wenn pilot
  // den slot beansprucht aber nicht qualifiziert ist, wird der claim
  // gar nicht erst versucht — kein zombie-state im transaction-rollback.
  await enforceCareerGateForRoute(
    userId,
    airlineId,
    slot.route.aircraftTypeIcao,
  );

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const booking = await prisma.$transaction(async (tx) => {
    // (1) Atomic claim. updateMany returns count=0 if the WHERE no longer
    // matches (race lost). This is the linearization point for slot
    // ownership.
    const claim = await tx.scheduledFlight.updateMany({
      where: {
        id: scheduledFlightId,
        status: 'Planned',
        bookingId: null,
      },
      data: { status: 'Booked' },
    });
    if (claim.count !== 1) {
      throw new Error('Dieser slot wurde gerade von jemand anderem gebucht.');
    }

    // (2) Create booking. scheduledDeparture comes from the slot — UTC,
    // already aligned with the schedule.
    const created = await tx.booking.create({
      data: {
        airlineId,
        userId,
        routeId: slot.routeId,
        intendedNetwork,
        scheduledDeparture: slot.departureTime,
        expiresAt,
      },
      select: { id: true, state: true, expiresAt: true },
    });

    // (3) Link booking back to slot. Now safe — we hold the claim.
    await tx.scheduledFlight.update({
      where: { id: scheduledFlightId },
      data: { bookingId: created.id },
    });

    return created;
  });

  revalidatePath('/bookings');
  revalidatePath('/airline/schedule/instances');

  return booking;
}

// ============================================================================
// Track-4 Option #67 — Booking-Templates 💾
// ============================================================================

const MAX_TEMPLATES_PER_PILOT = 20;

const SaveBookingTemplateSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Label darf nicht leer sein')
    .max(50, 'Label darf maximal 50 Zeichen lang sein'),
  routeId: z.string().cuid(),
  intendedNetwork: z.nativeEnum(NetworkType).optional(),
  legCount: z.number().int().min(1).max(10).default(1),
});

const DeleteBookingTemplateSchema = z.object({
  templateId: z.string().cuid(),
});

const CreateBookingFromTemplateSchema = z.object({
  templateId: z.string().cuid(),
  // Optional override beim instanziieren — z.B. wenn der pilot heute
  // ausnahmsweise auf POSCON statt VATSIM fliegen will.
  scheduledDeparture: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
});

/**
 * #67 — Speichert eine booking-template für den aktuellen pilot.
 *
 * Validierungen (in dieser reihenfolge):
 *   1. Auth + airline-scope via requireUserWithAirline
 *   2. Label-trim + length (1..50) via zod
 *   3. Route gehört zur gleichen airline
 *   4. Pro-pilot-limit: max 20 templates (MAX_TEMPLATES_PER_PILOT)
 *
 * Liefert die ID der neu erstellten template zurück, falls UI sie
 * direkt highlighten will.
 */
export async function saveBookingTemplate(
  input: z.input<typeof SaveBookingTemplateSchema>,
) {
  const parsed = SaveBookingTemplateSchema.parse(input);
  const { id: userId, airlineId } = await requireUserWithAirline();

  // Route muss zur airline gehören
  const route = await prisma.route.findFirst({
    where: { id: parsed.routeId, airlineId },
    select: { id: true },
  });
  if (!route) {
    throw new Error('Route nicht gefunden oder nicht in deiner Airline.');
  }

  // Pro-pilot-limit
  const count = await prisma.bookingTemplate.count({
    where: { userId, airlineId },
  });
  if (count >= MAX_TEMPLATES_PER_PILOT) {
    throw new Error(
      `Maximal ${MAX_TEMPLATES_PER_PILOT} Vorlagen pro Pilot. Lösche eine alte, ` +
        `um eine neue zu speichern.`,
    );
  }

  const template = await prisma.bookingTemplate.create({
    data: {
      userId,
      airlineId,
      label: parsed.label,
      routeId: parsed.routeId,
      intendedNetwork: parsed.intendedNetwork,
      legCount: parsed.legCount,
    },
    select: { id: true },
  });

  revalidatePath('/bookings/new');
  revalidatePath('/bookings');

  return template;
}

/**
 * #67 — Löscht eine booking-template.
 *
 * Validiert ownership: pilot kann nur seine eigenen templates löschen.
 * Mit airlineId-scope zusätzlich gegen cross-airline-akzidente.
 */
export async function deleteBookingTemplate(
  input: z.input<typeof DeleteBookingTemplateSchema>,
) {
  const { templateId } = DeleteBookingTemplateSchema.parse(input);
  const { id: userId, airlineId } = await requireUserWithAirline();

  // Ownership-check: only owner kann löschen
  const template = await prisma.bookingTemplate.findFirst({
    where: { id: templateId, userId, airlineId },
    select: { id: true },
  });
  if (!template) {
    throw new Error('Vorlage nicht gefunden.');
  }

  await prisma.bookingTemplate.delete({
    where: { id: templateId },
  });

  revalidatePath('/bookings/new');
  revalidatePath('/bookings');
}

/**
 * #67 — Erstellt eine neue booking aus einer template.
 *
 * Wrapper um createBooking-equivalent-logik, der die werte aus der template
 * zieht. Wir replizieren bewusst die wichtigsten checks (active-booking-
 * guard, career-gate, route-airline-scope, expiresAt-TTL) statt createBooking
 * zu callen, weil createBooking die input-schema-zod-validierung erwartet
 * und wir die NetworkType-enum direkt aus der DB übernehmen.
 *
 * Wenn die template-route inzwischen gelöscht wurde, throws.
 */
export async function createBookingFromTemplate(
  input: z.input<typeof CreateBookingFromTemplateSchema>,
) {
  const { templateId, scheduledDeparture } =
    CreateBookingFromTemplateSchema.parse(input);
  const { id: userId, airlineId } = await requireUserWithAirline();

  const template = await prisma.bookingTemplate.findFirst({
    where: { id: templateId, userId, airlineId },
    select: {
      id: true,
      routeId: true,
      intendedNetwork: true,
      legCount: true,
      route: {
        select: { id: true, aircraftTypeIcao: true },
      },
    },
  });
  if (!template) {
    throw new Error('Vorlage nicht gefunden.');
  }
  if (!template.route) {
    throw new Error(
      'Die Route dieser Vorlage existiert nicht mehr. Bitte lösche die Vorlage.',
    );
  }

  // Career-gate analog createBooking
  await enforceCareerGateForRoute(
    userId,
    airlineId,
    template.route.aircraftTypeIcao,
  );

  // Active-booking-guard analog createBooking
  const existing = await prisma.booking.findFirst({
    where: {
      userId,
      airlineId,
      state: { in: ['Created', 'SimBriefDispatched', 'InProgress'] },
    },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      'Aktive Buchung vorhanden. Schließe oder storniere sie zuerst.',
    );
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const booking = await prisma.booking.create({
    data: {
      airlineId,
      userId,
      routeId: template.routeId,
      intendedNetwork: template.intendedNetwork ?? undefined,
      scheduledDeparture,
      legCount: template.legCount,
      expiresAt,
    },
    select: { id: true, state: true },
  });

  revalidatePath('/bookings');
  revalidatePath('/bookings/new');

  return booking;
}
