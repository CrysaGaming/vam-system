/**
 * Track 5 #29 (Section F) — RosterSwapRequest helpers
 *
 * Pilot↔Pilot swap-flow. Status-transitions sind in der `RosterSwapRequest`
 * model-docstring. Hier sind die DB-helpers + die kritische
 * `acceptSwapRequest` transaction die beide RosterAssignments atomic
 * umrouten muss.
 *
 * # Helpers im überblick
 *
 *   - listIncomingForPilot       — inbox (PENDING + recent history)
 *   - listOutgoingForPilot       — outbox
 *   - listForAirline             — admin overview
 *   - getSwapRequestById         — single fetch (für detail-view)
 *   - createSwapRequest          — validation + create
 *   - acceptSwapRequest          — TX: status=ACCEPTED + swap beide pilots
 *   - rejectSwapRequest          — status=REJECTED + responseMessage
 *   - cancelSwapRequest          — status=CANCELLED (requester only)
 *
 * # Validation in createSwapRequest
 *
 *   1. Beide assignments existieren + selbe airline
 *   2. requester ist pilot der requesterAssignment
 *   3. requesterAssignment != targetAssignment (kein self-swap)
 *   4. Status beider assignments: ASSIGNED oder ACCEPTED (kein swap für
 *      COMPLETED/CANCELLED/SWAPPED/NO_SHOW)
 *   5. Kein bereits PENDING swap für die selbe requesterAssignment
 *      (verhindert dual-pending-races)
 *   6. requester != target-pilot (kann nicht mit sich selbst tauschen)
 *
 * Die check-logik landet hier statt im server-action damit ein future
 * background-job (z.B. auto-swap-bei-no-show) die selbe validation kriegt.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../index.js';

// ─── Reusable select shape ───
// Alle queries return die selbe shape mit pilot+route relations damit UI
// keine N+1-queries braucht.
export const ROSTER_SWAP_REQUEST_SELECT = {
  id: true,
  airlineId: true,
  status: true,
  message: true,
  responseMessage: true,
  respondedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  requesterId: true,
  targetPilotId: true,
  requester: {
    select: {
      id: true,
      name: true,
      image: true,
      rank: { select: { name: true } },
    },
  },
  targetPilot: {
    select: {
      id: true,
      name: true,
      image: true,
      rank: { select: { name: true } },
    },
  },
  requesterAssignment: {
    select: {
      id: true,
      status: true,
      scheduledFlight: {
        select: {
          id: true,
          departureTime: true,
          route: {
            select: {
              flightNumber: true,
              aircraftTypeIcao: true,
              estimatedMinutes: true,
              departure: { select: { icao: true } },
              arrival: { select: { icao: true } },
            },
          },
        },
      },
    },
  },
  targetAssignment: {
    select: {
      id: true,
      status: true,
      scheduledFlight: {
        select: {
          id: true,
          departureTime: true,
          route: {
            select: {
              flightNumber: true,
              aircraftTypeIcao: true,
              estimatedMinutes: true,
              departure: { select: { icao: true } },
              arrival: { select: { icao: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.RosterSwapRequestSelect;

export type RosterSwapRequestWithRelations = Prisma.RosterSwapRequestGetPayload<{
  select: typeof ROSTER_SWAP_REQUEST_SELECT;
}>;

// ─────────────────────────────────────────────────────────────────────
// List-queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Inbox-view für einen pilot: swaps wo ICH der target bin. Default zeigt
 * alle statuses, sortiert by recency (PENDING zuerst über filter im UI).
 *
 * # Lazy-expire
 *
 * Der RosterSwapRequest.expiresAt timestamp wird hier NICHT in DB
 * geupdated — wir liefern lediglich was wir finden. Das UI muss
 * `expiresAt < now() && status === 'PENDING'` als "expired" rendern.
 * Wenn jemand später einen cleanup-cron will, kann der die DB-rows auf
 * EXPIRED setzen, aber für #29 ist lazy-display-only ausreichend.
 */
export async function listIncomingForPilot(input: {
  pilotId: string;
  limit?: number;
}): Promise<RosterSwapRequestWithRelations[]> {
  return prisma.rosterSwapRequest.findMany({
    where: { targetPilotId: input.pilotId },
    select: ROSTER_SWAP_REQUEST_SELECT,
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 50,
  });
}

/** Outbox-view: swaps die ICH initiiert habe. */
export async function listOutgoingForPilot(input: {
  pilotId: string;
  limit?: number;
}): Promise<RosterSwapRequestWithRelations[]> {
  return prisma.rosterSwapRequest.findMany({
    where: { requesterId: input.pilotId },
    select: ROSTER_SWAP_REQUEST_SELECT,
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 50,
  });
}

/** Admin: alle swaps der airline. */
export async function listForAirline(input: {
  airlineId: string;
  statuses?: Array<'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'>;
  limit?: number;
}): Promise<RosterSwapRequestWithRelations[]> {
  return prisma.rosterSwapRequest.findMany({
    where: {
      airlineId: input.airlineId,
      ...(input.statuses ? { status: { in: input.statuses } } : {}),
    },
    select: ROSTER_SWAP_REQUEST_SELECT,
    orderBy: { createdAt: 'desc' },
    take: input.limit ?? 100,
  });
}

export async function getSwapRequestById(
  id: string,
): Promise<RosterSwapRequestWithRelations | null> {
  return prisma.rosterSwapRequest.findUnique({
    where: { id },
    select: ROSTER_SWAP_REQUEST_SELECT,
  });
}

/** Convenience: pending count für badge-anzeige in nav. */
export async function countPendingIncomingForPilot(pilotId: string): Promise<number> {
  return prisma.rosterSwapRequest.count({
    where: {
      targetPilotId: pilotId,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────

export class SwapRequestValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'requester-not-found'
      | 'target-not-found'
      | 'different-airline'
      | 'not-pilot-of-assignment'
      | 'self-swap'
      | 'same-pilot'
      | 'invalid-status'
      | 'already-pending',
  ) {
    super(message);
    this.name = 'SwapRequestValidationError';
  }
}

/**
 * Create-helper. Macht alle 6 validations + persistiert dann. Wirft
 * `SwapRequestValidationError` mit code für UI-render.
 *
 * Default expiresAt: jetzt + 48h. Der caller kann override-en falls
 * future-business-rules andere TTL wollen.
 */
export async function createSwapRequest(input: {
  requesterId: string;
  requesterAssignmentId: string;
  targetAssignmentId: string;
  message?: string | null;
  /** Optional override für expiresAt. Default = jetzt + 48h. */
  expiresAt?: Date;
}): Promise<RosterSwapRequestWithRelations> {
  const [requesterAssignment, targetAssignment] = await Promise.all([
    prisma.rosterAssignment.findUnique({
      where: { id: input.requesterAssignmentId },
      select: { id: true, pilotId: true, airlineId: true, status: true },
    }),
    prisma.rosterAssignment.findUnique({
      where: { id: input.targetAssignmentId },
      select: { id: true, pilotId: true, airlineId: true, status: true },
    }),
  ]);

  if (!requesterAssignment) {
    throw new SwapRequestValidationError(
      'Deine Assignment wurde nicht gefunden.',
      'requester-not-found',
    );
  }
  if (!targetAssignment) {
    throw new SwapRequestValidationError(
      'Die Ziel-Assignment wurde nicht gefunden.',
      'target-not-found',
    );
  }
  if (requesterAssignment.airlineId !== targetAssignment.airlineId) {
    throw new SwapRequestValidationError(
      'Assignments gehören zu unterschiedlichen Airlines.',
      'different-airline',
    );
  }
  if (requesterAssignment.pilotId !== input.requesterId) {
    throw new SwapRequestValidationError(
      'Du bist nicht der Pilot dieser Assignment.',
      'not-pilot-of-assignment',
    );
  }
  if (requesterAssignment.id === targetAssignment.id) {
    throw new SwapRequestValidationError(
      'Kein Self-Swap möglich.',
      'self-swap',
    );
  }
  if (requesterAssignment.pilotId === targetAssignment.pilotId) {
    throw new SwapRequestValidationError(
      'Beide Assignments gehören dem selben Piloten.',
      'same-pilot',
    );
  }
  const validStatuses = ['ASSIGNED', 'ACCEPTED'];
  if (
    !validStatuses.includes(requesterAssignment.status) ||
    !validStatuses.includes(targetAssignment.status)
  ) {
    throw new SwapRequestValidationError(
      'Swap nur möglich für Assignments im Status Zugewiesen oder Akzeptiert.',
      'invalid-status',
    );
  }

  // Check: keine doppel-pending für selbe requester-assignment
  const existingPending = await prisma.rosterSwapRequest.findFirst({
    where: {
      requesterAssignmentId: requesterAssignment.id,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (existingPending) {
    throw new SwapRequestValidationError(
      'Für deine Assignment läuft bereits eine offene Swap-Anfrage.',
      'already-pending',
    );
  }

  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + 48 * 60 * 60_000);

  return prisma.rosterSwapRequest.create({
    data: {
      airlineId: requesterAssignment.airlineId,
      requesterId: input.requesterId,
      targetPilotId: targetAssignment.pilotId,
      requesterAssignmentId: requesterAssignment.id,
      targetAssignmentId: targetAssignment.id,
      message: input.message ?? null,
      expiresAt,
    },
    select: ROSTER_SWAP_REQUEST_SELECT,
  });
}

/**
 * Accept-flow. KRITISCH: muss in TRANSACTION laufen weil wir 3 writes
 * machen müssen die alle gemeinsam succeeden oder rollback:
 *   1. SwapRequest → status=ACCEPTED, respondedAt, responseMessage
 *   2. requesterAssignment → pilotId=originalTarget, status=ASSIGNED
 *      (reset, der neue pilot muss erneut akzeptieren)
 *   3. targetAssignment → pilotId=originalRequester, status=ASSIGNED
 *
 * # Warum nicht assignments auf SWAPPED setzen?
 *
 * Erst hatte ich überlegt beide assignments auf SWAPPED zu setzen und
 * dann NEUE assignments für die getauschten pilots zu erstellen. Aber:
 *   - @@unique([pilotId, scheduledFlightId]) würde dann beim insert
 *     blocken (alte assignment für den-pilot existiert noch).
 *   - audit-trail wäre confusing (zwei alte + zwei neue).
 *   - PIREP-completion-link würde verloren bei einem swap nach langem
 *     warten.
 * Stattdessen: wir UPDATEN beide assignments in-place — der pilot wird
 * einfach getauscht, status zurück auf ASSIGNED damit der neue pilot
 * sein eigenes ACCEPTED-flag setzen kann. Pirep-link bleibt erhalten
 * falls schon einer existiert (sehr unwahrscheinlich bei pre-completion-
 * swaps, aber safe).
 *
 * # Stale-status-handling
 *
 * Wir prüfen IN der transaction ob beide assignments noch in einem
 * swap-fähigen status sind. Sonst werfen wir und der caller kriegt
 * einen verständlichen error.
 */
export async function acceptSwapRequest(input: {
  swapRequestId: string;
  /** Wer accepted — muss = targetPilotId sein. Server-action validiert auth. */
  acceptingUserId: string;
  responseMessage?: string | null;
}): Promise<RosterSwapRequestWithRelations> {
  return prisma.$transaction(async (tx) => {
    const swap = await tx.rosterSwapRequest.findUnique({
      where: { id: input.swapRequestId },
      select: {
        id: true,
        status: true,
        targetPilotId: true,
        requesterId: true,
        requesterAssignmentId: true,
        targetAssignmentId: true,
        expiresAt: true,
      },
    });
    if (!swap) {
      throw new SwapRequestValidationError('Swap-Anfrage nicht gefunden.', 'target-not-found');
    }
    if (swap.status !== 'PENDING') {
      throw new SwapRequestValidationError(
        `Swap-Anfrage ist nicht mehr offen (Status: ${swap.status}).`,
        'invalid-status',
      );
    }
    if (swap.expiresAt < new Date()) {
      throw new SwapRequestValidationError(
        'Swap-Anfrage ist abgelaufen.',
        'invalid-status',
      );
    }
    if (swap.targetPilotId !== input.acceptingUserId) {
      throw new SwapRequestValidationError(
        'Du bist nicht der Empfänger dieser Anfrage.',
        'not-pilot-of-assignment',
      );
    }

    // Re-fetch beide assignments in der TX um stale status zu vermeiden
    const [requesterAssignment, targetAssignment] = await Promise.all([
      tx.rosterAssignment.findUnique({
        where: { id: swap.requesterAssignmentId },
        select: { id: true, status: true, pilotId: true },
      }),
      tx.rosterAssignment.findUnique({
        where: { id: swap.targetAssignmentId },
        select: { id: true, status: true, pilotId: true },
      }),
    ]);
    if (!requesterAssignment || !targetAssignment) {
      throw new SwapRequestValidationError(
        'Eine der Assignments existiert nicht mehr.',
        'target-not-found',
      );
    }
    const validStatuses = ['ASSIGNED', 'ACCEPTED'];
    if (
      !validStatuses.includes(requesterAssignment.status) ||
      !validStatuses.includes(targetAssignment.status)
    ) {
      throw new SwapRequestValidationError(
        'Eine der Assignments ist nicht mehr im swap-fähigen Status.',
        'invalid-status',
      );
    }

    // Doppel-update: tausche pilotIds, reset status auf ASSIGNED.
    // Der neue pilot muss explicitly akzeptieren wenn das pattern strict
    // sein soll. (Für #29 MVP ist das eh nur eine kosmetische
    // distinction.)
    await tx.rosterAssignment.update({
      where: { id: requesterAssignment.id },
      data: {
        pilotId: targetAssignment.pilotId,
        status: 'ASSIGNED',
        acceptedAt: null,
      },
    });
    await tx.rosterAssignment.update({
      where: { id: targetAssignment.id },
      data: {
        pilotId: requesterAssignment.pilotId,
        status: 'ASSIGNED',
        acceptedAt: null,
      },
    });

    return tx.rosterSwapRequest.update({
      where: { id: swap.id },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
        responseMessage: input.responseMessage ?? null,
      },
      select: ROSTER_SWAP_REQUEST_SELECT,
    });
  });
}

/**
 * Reject-flow. Idempotent: wenn schon REJECTED, no-op return; wenn
 * andere status (CANCELLED, ACCEPTED, EXPIRED), wirft.
 */
export async function rejectSwapRequest(input: {
  swapRequestId: string;
  acceptingUserId: string;
  responseMessage?: string | null;
}): Promise<RosterSwapRequestWithRelations> {
  const swap = await prisma.rosterSwapRequest.findUnique({
    where: { id: input.swapRequestId },
    select: { id: true, status: true, targetPilotId: true },
  });
  if (!swap) {
    throw new SwapRequestValidationError('Swap-Anfrage nicht gefunden.', 'target-not-found');
  }
  if (swap.targetPilotId !== input.acceptingUserId) {
    throw new SwapRequestValidationError(
      'Du bist nicht der Empfänger dieser Anfrage.',
      'not-pilot-of-assignment',
    );
  }
  if (swap.status === 'REJECTED') {
    return getSwapRequestById(swap.id) as Promise<RosterSwapRequestWithRelations>;
  }
  if (swap.status !== 'PENDING') {
    throw new SwapRequestValidationError(
      `Swap-Anfrage ist nicht mehr offen (Status: ${swap.status}).`,
      'invalid-status',
    );
  }

  return prisma.rosterSwapRequest.update({
    where: { id: swap.id },
    data: {
      status: 'REJECTED',
      respondedAt: new Date(),
      responseMessage: input.responseMessage ?? null,
    },
    select: ROSTER_SWAP_REQUEST_SELECT,
  });
}

/** Cancel by requester. Nur für PENDING swaps. */
export async function cancelSwapRequest(input: {
  swapRequestId: string;
  cancellingUserId: string;
}): Promise<RosterSwapRequestWithRelations> {
  const swap = await prisma.rosterSwapRequest.findUnique({
    where: { id: input.swapRequestId },
    select: { id: true, status: true, requesterId: true },
  });
  if (!swap) {
    throw new SwapRequestValidationError('Swap-Anfrage nicht gefunden.', 'target-not-found');
  }
  if (swap.requesterId !== input.cancellingUserId) {
    throw new SwapRequestValidationError(
      'Du bist nicht der Ersteller dieser Anfrage.',
      'not-pilot-of-assignment',
    );
  }
  if (swap.status === 'CANCELLED') {
    return getSwapRequestById(swap.id) as Promise<RosterSwapRequestWithRelations>;
  }
  if (swap.status !== 'PENDING') {
    throw new SwapRequestValidationError(
      `Nur offene Anfragen können storniert werden (aktueller Status: ${swap.status}).`,
      'invalid-status',
    );
  }

  return prisma.rosterSwapRequest.update({
    where: { id: swap.id },
    data: { status: 'CANCELLED', respondedAt: new Date() },
    select: ROSTER_SWAP_REQUEST_SELECT,
  });
}
