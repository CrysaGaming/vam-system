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
