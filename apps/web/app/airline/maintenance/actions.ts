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

import {
  prisma,
  recordTransaction,
  getOrCreateWallet,
  getSystemWallet,
  InsufficientFundsError,
} from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';

export type MaintenanceActionResult =
  | { ok: true; message?: string; eventId?: string; debitedVam?: number }
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
  const { airlineId } = await requireAirlineManagerWithAirline();

  // Holen die volle event-row inkl. cost + aircraft-context, weil wir
  // beim complete bei costVam-set einen wallet-debit anhängen wollen
  // (Welle M / M2 — automatic maintenance-cost debit).
  const ev = await prisma.maintenanceEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      status: true,
      airlineId: true,
      aircraftId: true,
      title: true,
      type: true,
      costVam: true,
      aircraft: { select: { registration: true } },
    },
  });
  if (!ev || ev.airlineId !== airlineId) {
    return { ok: false, error: 'Event nicht gefunden.' };
  }
  if (ev.status !== 'InProgress') {
    return { ok: false, error: `Status ${ev.status} → kann nicht abgeschlossen werden.` };
  }

  const cost =
    ev.costVam !== null && ev.costVam !== undefined
      ? parseFloat(ev.costVam.toString())
      : 0;
  const shouldDebit = cost > 0;

  // Wenn kein cost → einfacher update ohne wallet-touch.
  if (!shouldDebit) {
    await prisma.maintenanceEvent.update({
      where: { id: eventId },
      data: { status: 'Completed', actualEnd: new Date() },
    });
    revalidatePath(`/airline/maintenance/${eventId}`);
    revalidatePath('/airline/maintenance');
    revalidatePath(`/airline/aircraft/${ev.aircraftId}`);
    return { ok: true, message: 'Maintenance abgeschlossen (kein cost).' };
  }

  // Mit cost: status-update + wallet-debit atomic in einem $transaction-
  // block. Falls wallet zu leer ist (InsufficientFundsError), bleibt der
  // status InProgress (rollback) und admin kriegt eine fehlermeldung —
  // er kann das wallet auffüllen und erneut completen.
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Status auf Completed setzen
      await tx.maintenanceEvent.update({
        where: { id: eventId },
        data: { status: 'Completed', actualEnd: new Date() },
      });

      // 2. Airline wallet (primary) + system wallet als counterparty
      const airlineWallet = await getOrCreateWallet({
        ownerType: 'AIRLINE',
        ownerAirlineId: airlineId,
        db: tx,
      });
      const systemWallet = await getSystemWallet('primary', tx);

      // 3. Negative amount = outflow
      await recordTransaction({
        walletId: airlineWallet.id,
        amount: -cost,
        type: 'EXPENSE_MAINTENANCE',
        category: `maintenance-${ev.type.toLowerCase()}`,
        description: `Maintenance: ${ev.title} (${ev.aircraft.registration})`,
        counterpartyWalletId: systemWallet.id,
        metadata: {
          maintenanceEventId: ev.id,
          aircraftId: ev.aircraftId,
          aircraftRegistration: ev.aircraft.registration,
          maintenanceType: ev.type,
        },
        db: tx,
      });
    });
  } catch (e) {
    if (e instanceof InsufficientFundsError) {
      return {
        ok: false,
        error: `Airline-wallet zu leer für ${cost.toFixed(2)} VAM$ maintenance-cost. Verfügbar: ${e.available.toFixed(2)} VAM$. Wallet auffüllen und erneut versuchen.`,
      };
    }
    throw e;
  }

  revalidatePath(`/airline/maintenance/${eventId}`);
  revalidatePath('/airline/maintenance');
  revalidatePath(`/airline/aircraft/${ev.aircraftId}`);
  revalidatePath('/airline/finance');
  return {
    ok: true,
    message: `Maintenance abgeschlossen. ${cost.toLocaleString('de-DE')} VAM$ vom airline-wallet abgebucht.`,
    debitedVam: cost,
  };
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
