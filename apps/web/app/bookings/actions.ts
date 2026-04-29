'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma, NetworkType } from '@vam/db';
import { requireUserWithAirline } from '@/lib/auth';
import { fetchSimBriefOfp } from '@/lib/simbrief/fetchOfp';
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
