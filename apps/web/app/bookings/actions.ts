'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma, NetworkType } from '@vam/db';
import { requireUserWithAirline } from '@/lib/auth';

const CreateBookingSchema = z.object({
  routeId: z.string().cuid(),
  intendedNetwork: z.nativeEnum(NetworkType).optional(),
});

const CancelBookingSchema = z.object({
  bookingId: z.string().cuid(),
  reason: z.string().trim().max(500).optional(),
});

const DispatchSimBriefSchema = z.object({
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

export async function dispatchSimBrief(
  input: z.infer<typeof DispatchSimBriefSchema>,
): Promise<{
  source: 'cache' | 'new-dispatch' | 'idempotent';
  ofpId: string | null;
  redirectUrl: string | null;
}> {
  const { bookingId } = DispatchSimBriefSchema.parse(input);

  const { id: userId, airlineId } = await requireUserWithAirline();

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, airlineId, userId },
    include: {
      route: {
        include: {
          departure: true,
          arrival: true,
          aircraft: true,
          airline: true,
        },
      },
    },
  });
  if (!booking) {
    throw new Error('Booking not found or not yours');
  }
  if (!booking.route.aircraft) {
    throw new Error('Route has no aircraft assigned — cannot dispatch SimBrief');
  }

  if (
    booking.state === 'Cancelled' ||
    booking.state === 'Completed' ||
    booking.state === 'Expired'
  ) {
    throw new Error(`Cannot dispatch booking in state ${booking.state}`);
  }

  if (booking.state === 'SimBriefDispatched') {
    if (booking.simBriefOfpId) {
      return {
        source: 'idempotent',
        ofpId: booking.simBriefOfpId,
        redirectUrl: null,
      };
    }
    const redirectUrl = buildSimBriefDispatchUrl({
      airline: booking.route.airline.icao,
      fltnum: booking.route.flightNumber,
      orig: booking.route.departure.icao,
      dest: booking.route.arrival.icao,
      type: booking.route.aircraft.type,
      staticId: booking.simBriefStaticId ?? `vam-${booking.id}`,
    });
    return { source: 'idempotent', ofpId: null, redirectUrl };
  }

  // booking.state === 'Created' from here on (state guards above)
  const cache = await prisma.flightPlanCache.findFirst({
    where: {
      routeId: booking.routeId,
      aircraftType: booking.route.aircraft.type,
      expiresAt: { gt: new Date() },
      airlineId,
    },
    orderBy: { generatedAt: 'desc' },
    select: { id: true, ofpId: true },
  });

  // Optimistic concurrency: state must still be 'Created'. If a concurrent
  // dispatch flipped it to 'SimBriefDispatched' between our read and write,
  // P2025 fires; we recurse, which re-loads the booking and lands in the
  // idempotent branch above.
  if (cache) {
    try {
      await prisma.booking.update({
        where: { id: bookingId, state: 'Created' },
        data: {
          state: 'SimBriefDispatched',
          flightPlanCacheId: cache.id,
          simBriefOfpId: cache.ofpId,
          dispatchedAt: new Date(),
        },
      });
    } catch (error) {
      if (isPrismaRecordNotFound(error)) {
        return dispatchSimBrief({ bookingId });
      }
      throw error;
    }
    revalidatePath('/bookings');
    return { source: 'cache', ofpId: cache.ofpId, redirectUrl: null };
  }

  const staticId = `vam-${bookingId}`;
  const redirectUrl = buildSimBriefDispatchUrl({
    airline: booking.route.airline.icao,
    fltnum: booking.route.flightNumber,
    orig: booking.route.departure.icao,
    dest: booking.route.arrival.icao,
    type: booking.route.aircraft.type,
    staticId,
  });

  try {
    await prisma.booking.update({
      where: { id: bookingId, state: 'Created' },
      data: {
        state: 'SimBriefDispatched',
        simBriefStaticId: staticId,
        dispatchedAt: new Date(),
      },
    });
  } catch (error) {
    if (isPrismaRecordNotFound(error)) {
      return dispatchSimBrief({ bookingId });
    }
    throw error;
  }
  revalidatePath('/bookings');
  return { source: 'new-dispatch', ofpId: null, redirectUrl };
}

function buildSimBriefDispatchUrl(params: {
  airline: string;
  fltnum: string;
  orig: string;
  dest: string;
  type: string;
  staticId: string;
}): string {
  const url = new URL('https://dispatch.simbrief.com/options/custom');
  url.searchParams.set('airline', params.airline);
  url.searchParams.set('fltnum', params.fltnum);
  url.searchParams.set('orig', params.orig);
  url.searchParams.set('dest', params.dest);
  url.searchParams.set('type', params.type);
  url.searchParams.set('static_id', params.staticId);
  return url.toString();
}

function isPrismaRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2025'
  );
}
