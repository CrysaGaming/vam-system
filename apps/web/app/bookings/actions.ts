'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma, NetworkType } from '@vam/db';
import { requireUserWithAirline } from '@/lib/auth';
import { fetchSimBriefOfp } from '@/lib/simbrief/fetchOfp';
import { fetchSimBriefOfpDirect } from '@/lib/simbrief/fetchOfpDirect';
import { buildSimBriefDispatchUrl } from '@/lib/simbrief/buildDispatchUrl';

const CreateBookingSchema = z.object({
  routeId: z.string().cuid(),
  intendedNetwork: z.nativeEnum(NetworkType).optional(),
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
  input: z.infer<typeof CreateBookingSchema>,
) {
  const { routeId, intendedNetwork } = CreateBookingSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const route = await prisma.route.findFirst({
    where: { id: routeId, airlineId },
    select: { id: true },
  });
  if (!route) {
    throw new Error('Route not found or not in your airline');
  }

  const existing = await prisma.booking.findFirst({
    where: {
      userId,
      airlineId,
      state: { in: ['Created', 'SimBriefDispatched'] },
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

  if (booking.state !== 'Created' && booking.state !== 'SimBriefDispatched') {
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
      flightPlanCache: { select: { id: true } },
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
    await prisma.flightPlanCache.update({
      where: { id: booking.flightPlanCache.id },
      data: cacheData,
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
      flightPlanCache: { select: { id: true } },
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
    await prisma.flightPlanCache.update({
      where: { id: booking.flightPlanCache.id },
      data: cacheData,
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
