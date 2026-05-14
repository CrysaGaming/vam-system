'use server';

/**
 * Welle L / L2 — Crew-Pairing server actions.
 *
 * # Permission model
 *
 * Airline-admin-only für create/update/publish/cancel/delete.
 * Assigned-pilot kann seine pairing nicht editieren (nur viewen via
 * /me/pairings). Admin-assignments laufen via separate assignPilot-action.
 *
 * # Lifecycle gates
 *
 *   create   → Draft
 *   addLeg   → Draft only
 *   removeLeg → Draft only
 *   publish  → Draft → Published
 *   assign   → Published → Assigned
 *   unassign → Assigned → Published (rollback)
 *   complete → Assigned/InProgress → Completed
 *   cancel   → any non-terminal → Cancelled
 */

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';

export type PairingActionResult =
  | { ok: true; message?: string; pairingId?: string }
  | { ok: false; error: string };

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

// ─────────────────────────────────────────────────────────────────────
// Helper: recalculate denormalized summary-felder
// ─────────────────────────────────────────────────────────────────────

async function recalculatePairingSummary(pairingId: string): Promise<void> {
  const legs = await prisma.crewPairingLeg.findMany({
    where: { pairingId },
    orderBy: { sequence: 'asc' },
    select: {
      sequence: true,
      scheduledFlight: {
        select: {
          departureTime: true,
          route: { select: { estimatedMinutes: true } },
        },
      },
    },
  });

  if (legs.length === 0) {
    await prisma.crewPairing.update({
      where: { id: pairingId },
      data: {
        legCount: 0,
        totalDurationMin: 0,
        startsAt: null,
        endsAt: null,
      },
    });
    return;
  }

  let totalDurationMin = 0;
  for (const l of legs) {
    totalDurationMin += l.scheduledFlight.route.estimatedMinutes;
  }

  const first = legs[0];
  const last = legs[legs.length - 1];
  const startsAt = first.scheduledFlight.departureTime;
  const endsAt = new Date(
    last.scheduledFlight.departureTime.getTime() +
      last.scheduledFlight.route.estimatedMinutes * 60 * 1000,
  );

  await prisma.crewPairing.update({
    where: { id: pairingId },
    data: {
      legCount: legs.length,
      totalDurationMin,
      startsAt,
      endsAt,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────

export async function createCrewPairingAction(input: {
  name: string;
  description: string;
}): Promise<PairingActionResult> {
  const { user: admin, airlineId } = await requireAirlineManagerWithAirline();

  const name = input.name.trim();
  const description = input.description.trim();

  if (name.length < 3 || name.length > NAME_MAX) {
    return { ok: false, error: `Name 3-${NAME_MAX} chars.` };
  }
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, error: `Beschreibung max ${DESCRIPTION_MAX} chars.` };
  }

  const p = await prisma.crewPairing.create({
    data: {
      airlineId: airlineId,
      name,
      description: description || null,
      createdById: admin.id,
      status: 'Draft',
    },
    select: { id: true },
  });

  revalidatePath('/airline/pairings');
  return { ok: true, pairingId: p.id, message: 'Pairing erstellt.' };
}

// ─────────────────────────────────────────────────────────────────────
// addLeg / removeLeg (Draft-only)
// ─────────────────────────────────────────────────────────────────────

export async function addLegToPairingAction(input: {
  pairingId: string;
  scheduledFlightId: string;
  layoverHoursAfter?: number | null;
}): Promise<PairingActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  const [pairing, flight] = await Promise.all([
    prisma.crewPairing.findUnique({
      where: { id: input.pairingId },
      select: { airlineId: true, status: true },
    }),
    prisma.scheduledFlight.findUnique({
      where: { id: input.scheduledFlightId },
      select: { airlineId: true },
    }),
  ]);

  if (!pairing || pairing.airlineId !== airlineId) {
    return { ok: false, error: 'Pairing nicht gefunden.' };
  }
  if (pairing.status !== 'Draft') {
    return { ok: false, error: 'Legs können nur im Draft-status hinzugefügt werden.' };
  }
  if (!flight || flight.airlineId !== airlineId) {
    return { ok: false, error: 'Scheduled flight nicht gefunden.' };
  }

  // Next sequence-position
  const maxSeq = await prisma.crewPairingLeg.aggregate({
    where: { pairingId: input.pairingId },
    _max: { sequence: true },
  });
  const nextSeq = (maxSeq._max.sequence ?? 0) + 1;

  // Check für duplikat (unique constraint würde es eh fangen, aber wir
  // geben eine schönere fehlermeldung)
  const existing = await prisma.crewPairingLeg.findUnique({
    where: {
      pairingId_scheduledFlightId: {
        pairingId: input.pairingId,
        scheduledFlightId: input.scheduledFlightId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: 'Dieser flight ist schon teil der pairing.' };
  }

  await prisma.crewPairingLeg.create({
    data: {
      pairingId: input.pairingId,
      scheduledFlightId: input.scheduledFlightId,
      sequence: nextSeq,
      layoverHoursAfter:
        input.layoverHoursAfter !== undefined && input.layoverHoursAfter !== null
          ? input.layoverHoursAfter
          : null,
    },
  });

  await recalculatePairingSummary(input.pairingId);

  revalidatePath(`/airline/pairings/${input.pairingId}`);
  revalidatePath('/airline/pairings');
  return { ok: true, message: 'Leg hinzugefügt.' };
}

export async function removeLegFromPairingAction(
  legId: string,
): Promise<PairingActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  const leg = await prisma.crewPairingLeg.findUnique({
    where: { id: legId },
    select: {
      pairingId: true,
      sequence: true,
      pairing: { select: { airlineId: true, status: true } },
    },
  });
  if (!leg || leg.pairing.airlineId !== airlineId) {
    return { ok: false, error: 'Leg nicht gefunden.' };
  }
  if (leg.pairing.status !== 'Draft') {
    return { ok: false, error: 'Legs können nur im Draft-status entfernt werden.' };
  }

  // Transaction: delete + re-sequence
  await prisma.$transaction(async (tx) => {
    await tx.crewPairingLeg.delete({ where: { id: legId } });
    // Alle legs nach der gelöschten position um 1 runter
    const remainingLegs = await tx.crewPairingLeg.findMany({
      where: {
        pairingId: leg.pairingId,
        sequence: { gt: leg.sequence },
      },
      orderBy: { sequence: 'asc' },
      select: { id: true, sequence: true },
    });
    // Update einzeln um unique-constraint-violations zu vermeiden;
    // wir bewegen sie sequentiell von der niedrigsten nach oben.
    for (const r of remainingLegs) {
      await tx.crewPairingLeg.update({
        where: { id: r.id },
        data: { sequence: r.sequence - 1 },
      });
    }
  });

  await recalculatePairingSummary(leg.pairingId);

  revalidatePath(`/airline/pairings/${leg.pairingId}`);
  revalidatePath('/airline/pairings');
  return { ok: true, message: 'Leg entfernt.' };
}

// ─────────────────────────────────────────────────────────────────────
// publish / assign / unassign / complete / cancel
// ─────────────────────────────────────────────────────────────────────

async function requireAdminOwnedPairing(
  pairingId: string,
): Promise<{ status: string; airlineId: string } | null> {
  const { airlineId } = await requireAirlineManagerWithAirline();
  const p = await prisma.crewPairing.findUnique({
    where: { id: pairingId },
    select: { status: true, airlineId: true },
  });
  if (!p || p.airlineId !== airlineId) return null;
  return p;
}

export async function publishPairingAction(
  pairingId: string,
): Promise<PairingActionResult> {
  const p = await requireAdminOwnedPairing(pairingId);
  if (!p) return { ok: false, error: 'Pairing nicht gefunden.' };
  if (p.status !== 'Draft') {
    return { ok: false, error: `Status ${p.status} → kann nicht publisht werden.` };
  }

  // Sanity: braucht mindestens 1 leg
  const legCount = await prisma.crewPairingLeg.count({ where: { pairingId } });
  if (legCount === 0) {
    return { ok: false, error: 'Pairing braucht mindestens 1 leg.' };
  }

  await prisma.crewPairing.update({
    where: { id: pairingId },
    data: { status: 'Published', publishedAt: new Date() },
  });
  revalidatePath(`/airline/pairings/${pairingId}`);
  revalidatePath('/airline/pairings');
  return { ok: true, message: 'Pairing publisht.' };
}

export async function assignPairingAction(input: {
  pairingId: string;
  pilotId: string;
}): Promise<PairingActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();
  const p = await prisma.crewPairing.findUnique({
    where: { id: input.pairingId },
    select: { airlineId: true, status: true },
  });
  if (!p || p.airlineId !== airlineId) {
    return { ok: false, error: 'Pairing nicht gefunden.' };
  }
  if (p.status !== 'Published' && p.status !== 'Assigned') {
    return { ok: false, error: `Status ${p.status} → kann nicht zugewiesen werden.` };
  }

  // Pilot muss in derselben airline sein
  const pilot = await prisma.user.findUnique({
    where: { id: input.pilotId },
    select: { airlineId: true },
  });
  if (!pilot || pilot.airlineId !== airlineId) {
    return { ok: false, error: 'Pilot nicht in dieser airline.' };
  }

  await prisma.crewPairing.update({
    where: { id: input.pairingId },
    data: { assignedPilotId: input.pilotId, status: 'Assigned' },
  });

  revalidatePath(`/airline/pairings/${input.pairingId}`);
  revalidatePath('/airline/pairings');
  revalidatePath('/me/pairings');
  return { ok: true, message: 'Pilot zugewiesen.' };
}

export async function unassignPairingAction(
  pairingId: string,
): Promise<PairingActionResult> {
  const p = await requireAdminOwnedPairing(pairingId);
  if (!p) return { ok: false, error: 'Pairing nicht gefunden.' };
  if (p.status !== 'Assigned') {
    return { ok: false, error: `Status ${p.status} → kann nicht entzogen werden.` };
  }
  await prisma.crewPairing.update({
    where: { id: pairingId },
    data: { assignedPilotId: null, status: 'Published' },
  });
  revalidatePath(`/airline/pairings/${pairingId}`);
  revalidatePath('/airline/pairings');
  revalidatePath('/me/pairings');
  return { ok: true, message: 'Zuweisung entzogen.' };
}

export async function completePairingAction(
  pairingId: string,
): Promise<PairingActionResult> {
  const p = await requireAdminOwnedPairing(pairingId);
  if (!p) return { ok: false, error: 'Pairing nicht gefunden.' };
  if (p.status !== 'Assigned' && p.status !== 'InProgress') {
    return { ok: false, error: `Status ${p.status} → kann nicht abgeschlossen werden.` };
  }
  await prisma.crewPairing.update({
    where: { id: pairingId },
    data: { status: 'Completed', completedAt: new Date() },
  });
  revalidatePath(`/airline/pairings/${pairingId}`);
  revalidatePath('/airline/pairings');
  revalidatePath('/me/pairings');
  return { ok: true, message: 'Pairing abgeschlossen.' };
}

export async function cancelPairingAction(
  pairingId: string,
): Promise<PairingActionResult> {
  const p = await requireAdminOwnedPairing(pairingId);
  if (!p) return { ok: false, error: 'Pairing nicht gefunden.' };
  if (p.status === 'Completed' || p.status === 'Cancelled') {
    return { ok: false, error: `Status ${p.status} → schon terminal.` };
  }
  await prisma.crewPairing.update({
    where: { id: pairingId },
    data: { status: 'Cancelled', cancelledAt: new Date() },
  });
  revalidatePath(`/airline/pairings/${pairingId}`);
  revalidatePath('/airline/pairings');
  revalidatePath('/me/pairings');
  return { ok: true, message: 'Pairing abgesagt.' };
}

export async function deletePairingAction(
  pairingId: string,
): Promise<PairingActionResult> {
  const p = await requireAdminOwnedPairing(pairingId);
  if (!p) return { ok: false, error: 'Pairing nicht gefunden.' };
  if (p.status !== 'Draft') {
    return {
      ok: false,
      error: 'Nur Draft-pairings können gelöscht werden. Sonst → cancel.',
    };
  }
  await prisma.crewPairing.delete({ where: { id: pairingId } });
  revalidatePath('/airline/pairings');
  return { ok: true, message: 'Pairing gelöscht.' };
}
