'use server';

/**
 * Welle L / L3 — Maintenance-Event server actions.
 *
 * # Permission model
 *
 * Airline-admin-only für alle mutations. Aircraft muss in der gleichen
 * airline sein wie der admin.
 *
 * # Lifecycle gates
 *
 *   create    → Scheduled
 *   start     → Scheduled → InProgress + actualStart=now()
 *   complete  → InProgress → Completed + actualEnd=now()
 *   cancel    → Scheduled/InProgress → Cancelled + cancelledAt=now()
 *   update    → nur in Scheduled (sonst manuelle korrektur via cancel+new)
 *   delete    → nur in Scheduled (sonst → cancel)
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';

export type MaintenanceActionResult =
  | { ok: true; message?: string; eventId?: string }
  | { ok: false; error: string };

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;

type MaintenanceTypeStr =
  | 'PreFlightCheck'
  | 'ACheck'
  | 'BCheck'
  | 'CCheck'
  | 'DCheck'
  | 'Repair'
  | 'OilChange'
  | 'TireReplacement'
  | 'EngineWork'
  | 'AvionicsUpdate'
  | 'Other';

const ALLOWED_TYPES: MaintenanceTypeStr[] = [
  'PreFlightCheck',
  'ACheck',
  'BCheck',
  'CCheck',
  'DCheck',
  'Repair',
  'OilChange',
  'TireReplacement',
  'EngineWork',
  'AvionicsUpdate',
  'Other',
];

// ─────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────

export async function createMaintenanceEventAction(input: {
  aircraftId: string;
  type: string;
  title: string;
  description: string;
  scheduledStartIso: string;
  scheduledEndIso: string;
  costVam?: number | null;
  nextDueAtIso?: string | null;
}): Promise<MaintenanceActionResult> {
  const { user: admin, airlineId } = await requireAirlineManagerWithAirline();

  const title = input.title.trim();
  const description = input.description.trim();

  if (title.length < 3 || title.length > TITLE_MAX) {
    return { ok: false, error: `Titel 3-${TITLE_MAX} chars.` };
  }
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, error: `Beschreibung max ${DESCRIPTION_MAX} chars.` };
  }
  if (!ALLOWED_TYPES.includes(input.type as MaintenanceTypeStr)) {
    return { ok: false, error: 'Ungültiger maintenance-typ.' };
  }

  const scheduledStart = new Date(input.scheduledStartIso);
  const scheduledEnd = new Date(input.scheduledEndIso);
  if (isNaN(scheduledStart.getTime()) || isNaN(scheduledEnd.getTime())) {
    return { ok: false, error: 'Ungültige datum/zeit angabe.' };
  }
  if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
    return { ok: false, error: 'End-zeit muss nach start-zeit liegen.' };
  }

  // Aircraft must belong to admin's airline
  const aircraft = await prisma.aircraft.findUnique({
    where: { id: input.aircraftId },
    select: { airlineId: true },
  });
  if (!aircraft || aircraft.airlineId !== airlineId) {
    return { ok: false, error: 'Aircraft nicht gefunden.' };
  }

  let nextDueAt: Date | null = null;
  if (input.nextDueAtIso) {
    nextDueAt = new Date(input.nextDueAtIso);
    if (isNaN(nextDueAt.getTime())) {
      return { ok: false, error: 'Ungültiges nextDueAt-datum.' };
    }
  }

  const event = await prisma.maintenanceEvent.create({
    data: {
      aircraftId: input.aircraftId,
      airlineId: airlineId,
      type: input.type as MaintenanceTypeStr,
      status: 'Scheduled',
      title,
      description: description || null,
      scheduledStart,
      scheduledEnd,
      costVam:
        input.costVam !== undefined && input.costVam !== null
          ? input.costVam
          : null,
      nextDueAt,
      createdById: admin.id,
    },
    select: { id: true },
  });

  revalidatePath('/airline/maintenance');
  revalidatePath(`/airline/aircraft/${input.aircraftId}`);
  return { ok: true, eventId: event.id, message: 'Maintenance-event angelegt.' };
}

// ─────────────────────────────────────────────────────────────────────
// status transitions
// ─────────────────────────────────────────────────────────────────────

async function requireAdminOwnedEvent(
  eventId: string,
): Promise<{ status: string; airlineId: string; aircraftId: string } | null> {
  const { airlineId } = await requireAirlineManagerWithAirline();
  const ev = await prisma.maintenanceEvent.findUnique({
    where: { id: eventId },
    select: { status: true, airlineId: true, aircraftId: true },
  });
  if (!ev || ev.airlineId !== airlineId) return null;
  return ev;
}

export async function startMaintenanceAction(
  eventId: string,
): Promise<MaintenanceActionResult> {
  const ev = await requireAdminOwnedEvent(eventId);
  if (!ev) return { ok: false, error: 'Event nicht gefunden.' };
  if (ev.status !== 'Scheduled') {
    return { ok: false, error: `Status ${ev.status} → kann nicht gestartet werden.` };
  }
  await prisma.maintenanceEvent.update({
    where: { id: eventId },
    data: { status: 'InProgress', actualStart: new Date() },
  });
  revalidatePath(`/airline/maintenance/${eventId}`);
  revalidatePath('/airline/maintenance');
  revalidatePath(`/airline/aircraft/${ev.aircraftId}`);
  return { ok: true, message: 'Maintenance gestartet.' };
}

export async function completeMaintenanceAction(
  eventId: string,
): Promise<MaintenanceActionResult> {
  const ev = await requireAdminOwnedEvent(eventId);
  if (!ev) return { ok: false, error: 'Event nicht gefunden.' };
  if (ev.status !== 'InProgress') {
    return { ok: false, error: `Status ${ev.status} → kann nicht abgeschlossen werden.` };
  }
  await prisma.maintenanceEvent.update({
    where: { id: eventId },
    data: { status: 'Completed', actualEnd: new Date() },
  });
  revalidatePath(`/airline/maintenance/${eventId}`);
  revalidatePath('/airline/maintenance');
  revalidatePath(`/airline/aircraft/${ev.aircraftId}`);
  return { ok: true, message: 'Maintenance abgeschlossen.' };
}

export async function cancelMaintenanceAction(
  eventId: string,
): Promise<MaintenanceActionResult> {
  const ev = await requireAdminOwnedEvent(eventId);
  if (!ev) return { ok: false, error: 'Event nicht gefunden.' };
  if (ev.status === 'Completed' || ev.status === 'Cancelled') {
    return { ok: false, error: `Status ${ev.status} → schon terminal.` };
  }
  await prisma.maintenanceEvent.update({
    where: { id: eventId },
    data: { status: 'Cancelled', cancelledAt: new Date() },
  });
  revalidatePath(`/airline/maintenance/${eventId}`);
  revalidatePath('/airline/maintenance');
  revalidatePath(`/airline/aircraft/${ev.aircraftId}`);
  return { ok: true, message: 'Maintenance abgesagt.' };
}

export async function deleteMaintenanceAction(
  eventId: string,
): Promise<MaintenanceActionResult> {
  const ev = await requireAdminOwnedEvent(eventId);
  if (!ev) return { ok: false, error: 'Event nicht gefunden.' };
  if (ev.status !== 'Scheduled') {
    return {
      ok: false,
      error: 'Nur Scheduled-events können gelöscht werden. Sonst → cancel.',
    };
  }
  await prisma.maintenanceEvent.delete({ where: { id: eventId } });
  revalidatePath('/airline/maintenance');
  revalidatePath(`/airline/aircraft/${ev.aircraftId}`);
  return { ok: true, message: 'Event gelöscht.' };
}
