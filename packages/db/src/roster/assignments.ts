/**
 * Track 5 #26 (Section F) — Roster-Assignment CRUD helpers
 *
 * DB-layer für RosterAssignment. Pure aggregator/CRUD-functions —
 * business-logic (eligibility-check, swap-flow, auto-rotation) lebt in
 * apps/web/lib/roster/ und ruft diese helpers via @vam/db.
 *
 * # Was hier drin ist
 *
 *   - listAssignmentsForAirline / -ForPilot / -ForFlight
 *   - getAssignmentById
 *   - createAssignment (admin manuelle erstellung — wird von #27 + #28 genutzt)
 *   - updateAssignmentStatus (state-machine transitions)
 *   - completeAssignmentWithPirep (vom approve-PIREP-flow callable)
 *   - cancelAssignment (admin abbruch)
 *   - countActiveAssignmentsForPilot (UI-badge "du hast N aktive assignments")
 *
 * # Was NICHT hier drin ist
 *
 *   - Eligibility-check (rank+type-rating). Wird in apps/web/lib/roster/
 *     eligibility.ts gemacht weil's app-level business-rules sind, kein
 *     pure-DB-lookup.
 *   - Auto-rotation-algorithm — feature #28
 *   - Swap-request-flow — feature #29 (eigenes model wahrscheinlich)
 *   - No-show-detection — feature #30 (cron-job, ruft updateAssignmentStatus)
 */

import { prisma } from '../index.js';
import type { Prisma, RosterAssignmentStatus } from '@prisma/client';

/**
 * Reusable select-shape mit allen relations die die UI typisch braucht.
 * Wird in den list/get-helpers verwendet damit alle callers konsistent
 * den selben payload kriegen (kein N+1 wenn UI nach pilot.name etc fragt).
 */
export const ROSTER_ASSIGNMENT_SELECT = {
  id: true,
  airlineId: true,
  pilotId: true,
  scheduledFlightId: true,
  status: true,
  assignedAircraftId: true,
  assignedById: true,
  note: true,
  pirepId: true,
  acceptedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  pilot: {
    select: {
      id: true,
      name: true,
      image: true,
      rank: { select: { name: true } },
    },
  },
  assignedBy: {
    select: {
      id: true,
      name: true,
    },
  },
  scheduledFlight: {
    select: {
      id: true,
      departureTime: true,
      route: {
        select: {
          id: true,
          flightNumber: true,
          aircraftTypeIcao: true,
          estimatedMinutes: true,
          distanceNm: true,
          departure: { select: { icao: true, name: true } },
          arrival: { select: { icao: true, name: true } },
        },
      },
    },
  },
  assignedAircraft: {
    select: {
      id: true,
      registration: true,
      type: true,
    },
  },
} satisfies Prisma.RosterAssignmentSelect;

export type RosterAssignmentWithRelations = Prisma.RosterAssignmentGetPayload<{
  select: typeof ROSTER_ASSIGNMENT_SELECT;
}>;

/**
 * List alle roster-assignments einer airline. Default sortiert by
 * scheduledFlight.departureTime asc — admin sieht zuerst was als nächstes
 * fliegt. Optional status-filter für "nur ASSIGNED" oder "nur NO_SHOW"
 * tabs in der UI.
 */
export async function listAssignmentsForAirline(params: {
  airlineId: string;
  statuses?: RosterAssignmentStatus[];
  /** Optional from-date (inclusive). Default: keine date-filter. */
  fromDate?: Date;
  /** Optional to-date (exclusive). Default: keine date-filter. */
  toDate?: Date;
  limit?: number;
}): Promise<RosterAssignmentWithRelations[]> {
  const { airlineId, statuses, fromDate, toDate, limit = 200 } = params;

  const where: Prisma.RosterAssignmentWhereInput = {
    airlineId,
    ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(fromDate || toDate
      ? {
          scheduledFlight: {
            departureTime: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lt: toDate } : {}),
            },
          },
        }
      : {}),
  };

  return prisma.rosterAssignment.findMany({
    where,
    select: ROSTER_ASSIGNMENT_SELECT,
    orderBy: { scheduledFlight: { departureTime: 'asc' } },
    take: limit,
  });
}

/**
 * List assignments für einen einzelnen pilot. Sortiert: upcoming first
 * (departureTime asc), past-completed unten. Default exkludiert
 * COMPLETED/CANCELLED damit der pilot-dashboard nur das relevante zeigt;
 * `includeFinished=true` für eine history-view.
 */
export async function listAssignmentsForPilot(params: {
  pilotId: string;
  includeFinished?: boolean;
  limit?: number;
}): Promise<RosterAssignmentWithRelations[]> {
  const { pilotId, includeFinished = false, limit = 50 } = params;

  const statusFilter: RosterAssignmentStatus[] = includeFinished
    ? ['ASSIGNED', 'ACCEPTED', 'COMPLETED', 'SWAPPED', 'CANCELLED', 'NO_SHOW']
    : ['ASSIGNED', 'ACCEPTED'];

  return prisma.rosterAssignment.findMany({
    where: {
      pilotId,
      status: { in: statusFilter },
    },
    select: ROSTER_ASSIGNMENT_SELECT,
    orderBy: { scheduledFlight: { departureTime: 'asc' } },
    take: limit,
  });
}

/**
 * Get one assignment with full relations. Returns null wenn nicht
 * existent oder dem caller-context nicht zugehörig (caller muss vor-
 * filtern via airlineId match in der calling-action).
 */
export async function getAssignmentById(
  id: string,
): Promise<RosterAssignmentWithRelations | null> {
  return prisma.rosterAssignment.findUnique({
    where: { id },
    select: ROSTER_ASSIGNMENT_SELECT,
  });
}

/**
 * Create eine neue assignment. Idempotent via @@unique([pilotId,
 * scheduledFlightId]) — wenn die kombo schon existiert, throwt Prisma
 * mit P2002 (caller sollte das fangen + als "already assigned" reporten).
 *
 * status defaultet auf ASSIGNED. Optional kann der caller direkt mit
 * ACCEPTED erstellen (z.B. wenn der pilot SELF-assigned hat via einer
 * volunteer-UI — out-of-scope für #26 aber das schema erlaubt's).
 */
export async function createAssignment(params: {
  airlineId: string;
  pilotId: string;
  scheduledFlightId: string;
  assignedAircraftId?: string | null;
  assignedById?: string | null;
  note?: string | null;
  initialStatus?: RosterAssignmentStatus;
}): Promise<RosterAssignmentWithRelations> {
  const {
    airlineId,
    pilotId,
    scheduledFlightId,
    assignedAircraftId,
    assignedById,
    note,
    initialStatus = 'ASSIGNED',
  } = params;

  return prisma.rosterAssignment.create({
    data: {
      airlineId,
      pilotId,
      scheduledFlightId,
      assignedAircraftId: assignedAircraftId ?? null,
      assignedById: assignedById ?? null,
      note: note ? note.slice(0, 500) : null,
      status: initialStatus,
      // acceptedAt setzen wenn direkt mit ACCEPTED erstellt
      ...(initialStatus === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
    },
    select: ROSTER_ASSIGNMENT_SELECT,
  });
}

/**
 * Transition status mit den entsprechenden side-effects:
 *   - ACCEPTED setzt acceptedAt = now
 *   - COMPLETED setzt completedAt = now (aber: completeAssignmentWithPirep
 *     ist der besser-typed entry-point für completion mit PIREP-link)
 *   - andere stati nur setzen ohne timestamp-effects
 *
 * Idempotent: wenn der aktuelle status === neuer status, ist's no-op
 * (kein extra updatedAt-bump, kein log-spam).
 */
export async function updateAssignmentStatus(params: {
  id: string;
  status: RosterAssignmentStatus;
}): Promise<RosterAssignmentWithRelations | null> {
  const { id, status } = params;

  const current = await prisma.rosterAssignment.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!current) return null;
  if (current.status === status) {
    // idempotent: caller bekommt aktuellen state ohne updatedAt-bump
    return getAssignmentById(id);
  }

  const extraData: Prisma.RosterAssignmentUpdateInput = {};
  if (status === 'ACCEPTED') extraData.acceptedAt = new Date();
  if (status === 'COMPLETED') extraData.completedAt = new Date();

  return prisma.rosterAssignment.update({
    where: { id },
    data: { status, ...extraData },
    select: ROSTER_ASSIGNMENT_SELECT,
  });
}

/**
 * Completion-handler: setzt pirepId + status=COMPLETED + completedAt.
 * Wird vom PIREP-approve-flow gecallt (in #26 only foundation — der
 * actual wire-up zum approve-flow kommt im follow-up). Idempotent:
 * wenn schon COMPLETED, no-op.
 */
export async function completeAssignmentWithPirep(params: {
  assignmentId: string;
  pirepId: string;
}): Promise<RosterAssignmentWithRelations | null> {
  const { assignmentId, pirepId } = params;

  const current = await prisma.rosterAssignment.findUnique({
    where: { id: assignmentId },
    select: { status: true, pirepId: true },
  });
  if (!current) return null;
  if (current.status === 'COMPLETED' && current.pirepId === pirepId) {
    return getAssignmentById(assignmentId); // idempotent
  }

  return prisma.rosterAssignment.update({
    where: { id: assignmentId },
    data: {
      status: 'COMPLETED',
      pirepId,
      completedAt: new Date(),
    },
    select: ROSTER_ASSIGNMENT_SELECT,
  });
}

/**
 * Hard cancel — admin abort einer assignment. Status → CANCELLED.
 * Idempotent.
 */
export async function cancelAssignment(params: {
  id: string;
}): Promise<RosterAssignmentWithRelations | null> {
  return updateAssignmentStatus({ id: params.id, status: 'CANCELLED' });
}

/**
 * Count active (ASSIGNED + ACCEPTED) assignments für einen pilot.
 * Cheap (läuft auf [pilotId, status] index). Verwendet vom dashboard-
 * widget als badge "Du hast N geplante flüge".
 */
export async function countActiveAssignmentsForPilot(
  pilotId: string,
): Promise<number> {
  return prisma.rosterAssignment.count({
    where: {
      pilotId,
      status: { in: ['ASSIGNED', 'ACCEPTED'] },
    },
  });
}
