'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import {
  updateAssignmentStatus,
  logAdminAction,
  prisma,
} from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { sendPushToUser, isPushConfigured } from '@/lib/push/vapid';

/**
 * Track 5 #30 (Section F) — No-Show server-actions
 *
 * Admin-only mutations. Drei actions:
 *   - markAssignmentAsNoShow — single, mit optional reason
 *   - markAssignmentsAsNoShow — bulk variant (für review-queue)
 *   - dismissNoShowCandidate — alias für updateAssignmentStatus zu
 *     COMPLETED (admin entscheidet "war doch kein no-show, der pilot
 *     hat einfach vergessen PIREP zu submitten"). Im MVP fixed-status
 *     COMPLETED — eine zukunfts-version könnte zwischen "PIREP-fehlt-
 *     aber-okay" und "completed" unterscheiden.
 *
 * # Push-notification policy
 *
 * NO_SHOW-mark sendet eine push an den betroffenen pilot ("Ein no-show
 * wurde für deinen Flug X registriert"). Das ist eine wichtige
 * information für den pilot, sowohl für transparenz als auch damit er
 * widersprechen kann ("hey, ich war doch da, hab nur die PIREP
 * vergessen"). Tag: 'vam-roster-noshow'.
 *
 * # Audit-trail
 *
 * Pro mark/dismiss ein logAdminAction. Action-codes:
 *   - roster.assignment.no_show.marked
 *   - roster.assignment.no_show.dismissed
 *
 * Metadata enthält den hoursOverdue zum mark-zeitpunkt und optional
 * reason, falls admin einen text-grund eingegeben hat. Das hilft beim
 * späteren "wer hat wann wen warum als no-show markiert" trouble-
 * shooting.
 */

const MarkSingleSchema = z.object({
  assignmentId: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
  /** Soll push-notification gesendet werden? Default ON. */
  notifyPilot: z.boolean().optional().default(true),
});

const MarkBulkSchema = z.object({
  assignmentIds: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().max(500).nullable().optional(),
  notifyPilot: z.boolean().optional().default(true),
});

const DismissSchema = z.object({
  assignmentId: z.string().min(1),
});

export type NoShowActionResult = {
  ok: boolean;
  marked?: number;
  skipped?: Array<{ assignmentId: string; reason: string }>;
  pushSent?: number;
  error?: string;
};

/**
 * Markiert eine einzelne assignment als NO_SHOW. Setzt status,
 * sendet push (wenn enabled + configured), und audit-loggt.
 *
 * Wir checken NICHT ob der pilot tatsächlich eligible-no-show ist
 * (also ob graceDeadline < now). Admin-diskretion: vielleicht weiß
 * der admin schon mid-flight dass es ein no-show wird (z.B. pilot
 * sagt im Discord "kann doch nicht") — dann kann er sofort marken
 * ohne 4h zu warten.
 */
export async function markAssignmentAsNoShow(
  input: z.input<typeof MarkSingleSchema>,
): Promise<NoShowActionResult> {
  try {
    const { user, airlineId } = await requireAirlineManagerWithAirline();
    const parsed = MarkSingleSchema.parse(input);

    // Validate ownership: assignment must belong to admin's airline
    const assignment = await prisma.rosterAssignment.findUnique({
      where: { id: parsed.assignmentId },
      select: {
        id: true,
        airlineId: true,
        pilotId: true,
        status: true,
        scheduledFlight: {
          select: {
            departureTime: true,
            route: {
              select: {
                flightNumber: true,
                estimatedMinutes: true,
              },
            },
          },
        },
      },
    });
    if (!assignment) {
      return { ok: false, error: 'Assignment nicht gefunden.' };
    }
    if (assignment.airlineId !== airlineId) {
      return { ok: false, error: 'Assignment gehört nicht zu deiner Airline.' };
    }
    if (!['ASSIGNED', 'ACCEPTED'].includes(assignment.status)) {
      return {
        ok: false,
        error: `Status muss ASSIGNED oder ACCEPTED sein (aktuell: ${assignment.status}).`,
      };
    }

    const updated = await updateAssignmentStatus({
      id: assignment.id,
      status: 'NO_SHOW',
    });
    if (!updated) {
      return { ok: false, error: 'Update fehlgeschlagen.' };
    }

    // Compute hoursOverdue für audit-context
    const scheduledArrival = new Date(
      assignment.scheduledFlight.departureTime.getTime() +
        assignment.scheduledFlight.route.estimatedMinutes * 60_000,
    );
    const hoursOverdue =
      (Date.now() - scheduledArrival.getTime()) / (1000 * 60 * 60);

    // Audit (best-effort)
    try {
      await logAdminAction({
        actorId: user.id,
        action: 'roster.assignment.no_show.marked',
        targetType: 'RosterAssignment',
        targetId: assignment.id,
        metadata: {
          pilotId: assignment.pilotId,
          flightNumber: assignment.scheduledFlight.route.flightNumber,
          hoursOverdue: Math.round(hoursOverdue * 10) / 10,
          reason: parsed.reason ?? null,
          previousStatus: assignment.status,
        },
      });
    } catch {
      /* swallow */
    }

    // Push
    let pushSent = 0;
    if (parsed.notifyPilot && isPushConfigured()) {
      try {
        await sendPushToUser(assignment.pilotId, {
          title: '⚠️ No-Show registriert',
          body: `Für deinen Flug ${assignment.scheduledFlight.route.flightNumber} wurde ein No-Show eingetragen. Bei Fragen wende dich an die Airline-Leitung.`,
          url: '/dashboard',
          tag: 'vam-roster-noshow',
        });
        pushSent = 1;
      } catch (err) {
        console.error('[no-show] push failed:', err);
      }
    }

    revalidatePath('/airline/roster');
    revalidatePath('/airline/roster/no-shows');
    revalidatePath('/dashboard');

    return { ok: true, marked: 1, pushSent };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler.',
    };
  }
}

/**
 * Bulk-variante. Pro assignment macht intern denselben validate +
 * update + audit + push wie markAssignmentAsNoShow. Returnt aggregat.
 *
 * Idempotenz: wenn eine assignment schon NO_SHOW ist, skip + report.
 * Wenn airline-mismatch oder andere validation-fail, skip + report.
 */
export async function markAssignmentsAsNoShow(
  input: z.input<typeof MarkBulkSchema>,
): Promise<NoShowActionResult> {
  try {
    const { user, airlineId } = await requireAirlineManagerWithAirline();
    const parsed = MarkBulkSchema.parse(input);

    let marked = 0;
    let pushSent = 0;
    const skipped: NoShowActionResult['skipped'] = [];

    for (const assignmentId of parsed.assignmentIds) {
      const assignment = await prisma.rosterAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          airlineId: true,
          pilotId: true,
          status: true,
          scheduledFlight: {
            select: {
              departureTime: true,
              route: {
                select: {
                  flightNumber: true,
                  estimatedMinutes: true,
                },
              },
            },
          },
        },
      });
      if (!assignment) {
        skipped.push({ assignmentId, reason: 'nicht gefunden' });
        continue;
      }
      if (assignment.airlineId !== airlineId) {
        skipped.push({ assignmentId, reason: 'falsche airline' });
        continue;
      }
      if (!['ASSIGNED', 'ACCEPTED'].includes(assignment.status)) {
        skipped.push({
          assignmentId,
          reason: `status ${assignment.status}`,
        });
        continue;
      }

      const updated = await updateAssignmentStatus({
        id: assignment.id,
        status: 'NO_SHOW',
      });
      if (!updated) {
        skipped.push({ assignmentId, reason: 'update-fail' });
        continue;
      }
      marked += 1;

      const scheduledArrival = new Date(
        assignment.scheduledFlight.departureTime.getTime() +
          assignment.scheduledFlight.route.estimatedMinutes * 60_000,
      );
      const hoursOverdue =
        (Date.now() - scheduledArrival.getTime()) / (1000 * 60 * 60);

      try {
        await logAdminAction({
          actorId: user.id,
          action: 'roster.assignment.no_show.marked',
          targetType: 'RosterAssignment',
          targetId: assignment.id,
          metadata: {
            pilotId: assignment.pilotId,
            flightNumber: assignment.scheduledFlight.route.flightNumber,
            hoursOverdue: Math.round(hoursOverdue * 10) / 10,
            reason: parsed.reason ?? null,
            previousStatus: assignment.status,
            bulk: true,
          },
        });
      } catch {
        /* swallow */
      }

      if (parsed.notifyPilot && isPushConfigured()) {
        try {
          await sendPushToUser(assignment.pilotId, {
            title: '⚠️ No-Show registriert',
            body: `Für deinen Flug ${assignment.scheduledFlight.route.flightNumber} wurde ein No-Show eingetragen.`,
            url: '/dashboard',
            tag: 'vam-roster-noshow',
          });
          pushSent += 1;
        } catch (err) {
          console.error('[no-show] push failed:', err);
        }
      }
    }

    revalidatePath('/airline/roster');
    revalidatePath('/airline/roster/no-shows');
    revalidatePath('/dashboard');

    return { ok: true, marked, pushSent, skipped };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler.',
    };
  }
}

/**
 * "Doch kein no-show" — admin entscheidet dass die assignment als
 * COMPLETED gilt (z.B. pilot hat den flight nachweislich gemacht
 * aber PIREP vergessen). Wir setzen direkt auf COMPLETED, ohne
 * pirepId (assignment wird "completed-orphaned" — kein PIREP-link).
 *
 * Audit: roster.assignment.no_show.dismissed
 */
export async function dismissNoShowCandidate(
  input: z.input<typeof DismissSchema>,
): Promise<NoShowActionResult> {
  try {
    const { user, airlineId } = await requireAirlineManagerWithAirline();
    const parsed = DismissSchema.parse(input);

    const assignment = await prisma.rosterAssignment.findUnique({
      where: { id: parsed.assignmentId },
      select: { id: true, airlineId: true, status: true, pilotId: true },
    });
    if (!assignment) {
      return { ok: false, error: 'Assignment nicht gefunden.' };
    }
    if (assignment.airlineId !== airlineId) {
      return { ok: false, error: 'Assignment gehört nicht zu deiner Airline.' };
    }

    const updated = await updateAssignmentStatus({
      id: assignment.id,
      status: 'COMPLETED',
    });
    if (!updated) {
      return { ok: false, error: 'Update fehlgeschlagen.' };
    }

    try {
      await logAdminAction({
        actorId: user.id,
        action: 'roster.assignment.no_show.dismissed',
        targetType: 'RosterAssignment',
        targetId: assignment.id,
        metadata: {
          pilotId: assignment.pilotId,
          previousStatus: assignment.status,
        },
      });
    } catch {
      /* swallow */
    }

    revalidatePath('/airline/roster');
    revalidatePath('/airline/roster/no-shows');

    return { ok: true, marked: 0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler.',
    };
  }
}
