'use server';

/**
 * Welle K / K5 — Inter-Airline-Trip server actions.
 *
 * # Permission-model
 *
 * - Create: any pilot mit airline-zugehörigkeit (airline-admin-flag
 *   nicht required V1; manche pilots werden inoffizielle event-organisers
 *   sein, das wollen wir nicht künstlich beschränken).
 * - Join/Leave: any authenticated pilot, egal welche airline
 *   (cross-airline-flow ist der ganze sinn).
 * - Confirm/Complete/Cancel: nur der organizerUserId.
 *
 * # Lifecycle gates
 *
 *   create  → status=Proposed
 *   join    → only while Proposed or Confirmed
 *   leave   → only while NOT Completed/Cancelled
 *   confirm → Proposed → Confirmed (organizer)
 *   complete → Confirmed → Completed (organizer)
 *   cancel  → Proposed/Confirmed → Cancelled (organizer)
 */

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';

export type TripActionResult =
  | { ok: true; message?: string; tripId?: string }
  | { ok: false; error: string };

async function requireSessionUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Nicht eingeloggt.');
  return session.user.id;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;
const ICAO_MAX = 10;
const NOTES_MAX = 500;

// ─────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────

export async function createInterAirlineTripAction(input: {
  title: string;
  description: string;
  departureIcao: string;
  arrivalIcao: string;
  scheduledAtIso: string;
  maxParticipants: number;
}): Promise<TripActionResult> {
  const userId = await requireSessionUser();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { airlineId: true },
  });
  if (!user?.airlineId) {
    return { ok: false, error: 'Du brauchst eine airline-zugehörigkeit zum erstellen.' };
  }

  const title = input.title.trim();
  const description = input.description.trim();
  const departureIcao = input.departureIcao.trim().toUpperCase();
  const arrivalIcao = input.arrivalIcao.trim().toUpperCase();

  if (title.length < 5 || title.length > TITLE_MAX) {
    return { ok: false, error: `Title 5-${TITLE_MAX} chars.` };
  }
  if (description.length < 10 || description.length > DESCRIPTION_MAX) {
    return { ok: false, error: `Description 10-${DESCRIPTION_MAX} chars.` };
  }
  if (
    departureIcao.length < 3 ||
    departureIcao.length > ICAO_MAX ||
    arrivalIcao.length < 3 ||
    arrivalIcao.length > ICAO_MAX
  ) {
    return { ok: false, error: 'ICAO codes müssen 3-10 chars sein.' };
  }

  const scheduledAt = new Date(input.scheduledAtIso);
  if (isNaN(scheduledAt.getTime())) {
    return { ok: false, error: 'Ungültiges datum.' };
  }
  if (scheduledAt.getTime() < Date.now() - 1000 * 60 * 60) {
    return { ok: false, error: 'Scheduled-at darf nicht in der vergangenheit liegen.' };
  }

  const max = Math.max(0, Math.min(99, Math.floor(input.maxParticipants)));

  const trip = await prisma.interAirlineTrip.create({
    data: {
      organizerAirlineId: user.airlineId,
      organizerUserId: userId,
      title,
      description,
      departureIcao,
      arrivalIcao,
      scheduledAt,
      maxParticipants: max,
      status: 'Proposed',
      // Organizer als auto-participant
      participants: {
        create: { userId, notes: null },
      },
    },
    select: { id: true },
  });

  revalidatePath('/trips');
  revalidatePath('/me/trips');
  return { ok: true, tripId: trip.id, message: 'Trip erstellt.' };
}

// ─────────────────────────────────────────────────────────────────────
// join / leave
// ─────────────────────────────────────────────────────────────────────

export async function joinInterAirlineTripAction(input: {
  tripId: string;
  notes: string;
}): Promise<TripActionResult> {
  const userId = await requireSessionUser();

  const trip = await prisma.interAirlineTrip.findUnique({
    where: { id: input.tripId },
    select: {
      id: true,
      status: true,
      maxParticipants: true,
      _count: { select: { participants: true } },
    },
  });
  if (!trip) return { ok: false, error: 'Trip nicht gefunden.' };
  if (trip.status !== 'Proposed' && trip.status !== 'Confirmed') {
    return { ok: false, error: `Trip-status ${trip.status} erlaubt keine neuen joins.` };
  }
  if (trip.maxParticipants > 0 && trip._count.participants >= trip.maxParticipants) {
    return { ok: false, error: 'Trip ist voll.' };
  }

  const existing = await prisma.interAirlineTripParticipant.findUnique({
    where: { tripId_userId: { tripId: input.tripId, userId } },
  });
  if (existing) return { ok: true, message: 'Du bist bereits dabei.' };

  const notes = input.notes.trim().slice(0, NOTES_MAX) || null;

  await prisma.interAirlineTripParticipant.create({
    data: { tripId: input.tripId, userId, notes },
  });

  revalidatePath(`/trips/${input.tripId}`);
  revalidatePath('/me/trips');
  return { ok: true, message: 'Beigetreten.' };
}

export async function leaveInterAirlineTripAction(
  tripId: string,
): Promise<TripActionResult> {
  const userId = await requireSessionUser();

  const trip = await prisma.interAirlineTrip.findUnique({
    where: { id: tripId },
    select: { status: true, organizerUserId: true },
  });
  if (!trip) return { ok: false, error: 'Trip nicht gefunden.' };
  if (trip.organizerUserId === userId) {
    return {
      ok: false,
      error: 'Organizer kann nicht leaven — cancel den trip wenn nötig.',
    };
  }
  if (trip.status === 'Completed' || trip.status === 'Cancelled') {
    return { ok: false, error: 'Trip ist bereits abgeschlossen.' };
  }

  await prisma.interAirlineTripParticipant.deleteMany({
    where: { tripId, userId },
  });

  revalidatePath(`/trips/${tripId}`);
  revalidatePath('/me/trips');
  return { ok: true, message: 'Verlassen.' };
}

// ─────────────────────────────────────────────────────────────────────
// status-transitions (organizer only)
// ─────────────────────────────────────────────────────────────────────

async function requireOrganizer(
  tripId: string,
  userId: string,
): Promise<{ status: string } | null> {
  const trip = await prisma.interAirlineTrip.findUnique({
    where: { id: tripId },
    select: { organizerUserId: true, status: true },
  });
  if (!trip) return null;
  if (trip.organizerUserId !== userId) return null;
  return { status: trip.status };
}

export async function confirmTripAction(
  tripId: string,
): Promise<TripActionResult> {
  const userId = await requireSessionUser();
  const t = await requireOrganizer(tripId, userId);
  if (!t) return { ok: false, error: 'Trip nicht gefunden / kein organizer.' };
  if (t.status !== 'Proposed') {
    return { ok: false, error: `Status ${t.status} → kann nicht confirmt werden.` };
  }
  await prisma.interAirlineTrip.update({
    where: { id: tripId },
    data: { status: 'Confirmed' },
  });
  revalidatePath(`/trips/${tripId}`);
  revalidatePath('/trips');
  return { ok: true, message: 'Trip bestätigt.' };
}

export async function completeTripAction(
  tripId: string,
): Promise<TripActionResult> {
  const userId = await requireSessionUser();
  const t = await requireOrganizer(tripId, userId);
  if (!t) return { ok: false, error: 'Trip nicht gefunden / kein organizer.' };
  if (t.status !== 'Confirmed') {
    return { ok: false, error: `Status ${t.status} → kann nicht completed werden.` };
  }
  await prisma.interAirlineTrip.update({
    where: { id: tripId },
    data: { status: 'Completed', completedAt: new Date() },
  });
  revalidatePath(`/trips/${tripId}`);
  revalidatePath('/trips');
  return { ok: true, message: 'Trip als abgeschlossen markiert.' };
}

export async function cancelTripAction(
  tripId: string,
): Promise<TripActionResult> {
  const userId = await requireSessionUser();
  const t = await requireOrganizer(tripId, userId);
  if (!t) return { ok: false, error: 'Trip nicht gefunden / kein organizer.' };
  if (t.status === 'Completed' || t.status === 'Cancelled') {
    return { ok: false, error: `Status ${t.status} → kann nicht abgesagt werden.` };
  }
  await prisma.interAirlineTrip.update({
    where: { id: tripId },
    data: { status: 'Cancelled', cancelledAt: new Date() },
  });
  revalidatePath(`/trips/${tripId}`);
  revalidatePath('/trips');
  return { ok: true, message: 'Trip abgesagt.' };
}
