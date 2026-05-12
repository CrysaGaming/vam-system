'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import {
  createAssignment,
  logAdminAction,
  Prisma,
} from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { checkRosterEligibility, type EligibilityIssue } from '@/lib/roster/eligibility';
import { sendPushToUser, isPushConfigured } from '@/lib/push/vapid';

/**
 * Track 5 #27 (Section F) — Roster-Assignment server-actions
 *
 * Server-side mutations für das roster-system. Hauptfunktion:
 * `createRosterAssignments` — multi-flight bulk-create (1 oder N flights
 * für 1 pilot). Single-assignment ist ein bulk-mit-1-flight; wir haben
 * NICHT zwei parallel-actions weil das nur duplicate-logic wäre.
 *
 * # Auth
 *
 * Alle actions gated via `requireAirlineManagerWithAirline()` — wirft
 * wenn user nicht authentifiziert, nicht airline-manager, oder ohne
 * airline-zuordnung. Spiegelt das existing schedule/actions.ts pattern.
 *
 * # Eligibility-policy
 *
 * Default: hard-blocks (errors) blockieren ALWAYS. Soft-warnings
 * (missing-license, conflicts) blockieren DEFAULT, aber der admin kann
 * mit `allowWarnings: true` override-n.
 *
 * # Push-notification (#24 integration)
 *
 * Wenn `sendPushNotification: true` (default), wird nach erfolgreichem
 * create ein push an den pilot's subscribed devices gefeuert. Wenn der
 * pilot keine push-subscription hat (oder die airline kein VAPID
 * konfiguriert hat), ist das ein no-op — die assignment wird trotzdem
 * erstellt. Failure-handling für push: silent swallow, weil die action
 * NICHT failen soll wegen push-issues.
 *
 * # Audit-log (#101 integration)
 *
 * Jede create-action loggt `roster.assignment.created` mit metadata:
 * { pilotId, scheduledFlightId, assignedAircraftId, allowWarnings,
 * warnings: number, source: 'manual' }. `source` lässt uns später
 * manual-creates von auto-rotation-creates (#28) unterscheiden.
 */

// Single-flight schema, used as building-block für bulk.
const SingleCreateInputSchema = z.object({
  pilotId: z.string().min(1, 'pilotId required'),
  scheduledFlightId: z.string().min(1, 'scheduledFlightId required'),
  assignedAircraftId: z.string().min(1).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const BulkCreateInputSchema = z.object({
  pilotId: z.string().min(1),
  // Mindestens 1, max 50 — bulk-create soll workflow-friendly sein aber
  // nicht ein "rosters für ein ganzes jahr in einem call"-vector.
  scheduledFlightIds: z.array(z.string().min(1)).min(1).max(50),
  assignedAircraftId: z.string().min(1).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  /** Wenn true, soft-warnings ignorieren und trotzdem erstellen. */
  allowWarnings: z.boolean().optional().default(false),
  /** Wenn true, push-notification fan-out via #24. Default ON. */
  sendPushNotification: z.boolean().optional().default(true),
  /**
   * Audit-log source-tag. Default 'manual' — Track 5 #27 admin-form.
   * Track 5 #28 auto-rostering commit setzt 'auto' damit man später
   * abfragen kann "wieviele assignments wurden manuell vs automatisch
   * erstellt?". Wird in der audit-metadata gespeichert, NICHT in der
   * RosterAssignment selbst — das schema bleibt clean.
   */
  source: z.enum(['manual', 'auto']).optional().default('manual'),
});

export type CreateRosterAssignmentsInput = z.input<typeof BulkCreateInputSchema>;

export type CreateRosterAssignmentsResult = {
  /** Successful assignment-creates mit ihren neuen IDs. */
  created: Array<{
    scheduledFlightId: string;
    assignmentId: string;
    warnings: EligibilityIssue[];
  }>;
  /** Skipped flights — couldn't be created. */
  skipped: Array<{
    scheduledFlightId: string;
    reason: 'errors' | 'warnings-blocked' | 'duplicate' | 'unknown';
    issues: EligibilityIssue[];
  }>;
  /** Aggregated warnings across all successful creates (for admin review). */
  pushNotificationSent: boolean;
};

/**
 * Bulk-create roster-assignments für einen pilot auf N flights. Returnt
 * pro flight ein result: created (success) oder skipped (mit grund).
 *
 * Idempotenz-handling: P2002 (unique constraint on [pilotId, scheduledFlightId])
 * wird als `skipped: duplicate` behandelt — die assignment existiert
 * schon, kein fehler, kein crash. Andere Prisma-errors werden als
 * `unknown` markiert.
 *
 * Push-notification: wird EINMAL nach all-creates gefeuert (nicht pro
 * flight) — eine summary-notification "Du wurdest auf N flüge gerostert"
 * statt N einzelne notifications. Wenn der admin nur 1 flight rosterte,
 * zeigt die notification konkrete flight-details.
 */
export async function createRosterAssignments(
  input: CreateRosterAssignmentsInput,
): Promise<CreateRosterAssignmentsResult> {
  const { user, airlineId } = await requireAirlineManagerWithAirline();
  const parsed = BulkCreateInputSchema.parse(input);

  const created: CreateRosterAssignmentsResult['created'] = [];
  const skipped: CreateRosterAssignmentsResult['skipped'] = [];

  for (const flightId of parsed.scheduledFlightIds) {
    const eligibility = await checkRosterEligibility({
      airlineId,
      pilotId: parsed.pilotId,
      scheduledFlightId: flightId,
      assignedAircraftId: parsed.assignedAircraftId ?? null,
    });

    if (!eligibility.ok) {
      // Hard-block (errors). Admin kann NICHT overriden — diese errors sind
      // unfixable ohne data-correction (pilot existiert nicht, falsche airline,
      // pilot terminated). Skip + report.
      skipped.push({
        scheduledFlightId: flightId,
        reason: 'errors',
        issues: [...eligibility.errors, ...eligibility.warnings],
      });
      continue;
    }

    if (eligibility.warnings.length > 0 && !parsed.allowWarnings) {
      // Soft-warnings present + admin hat nicht override aktiviert → skip.
      skipped.push({
        scheduledFlightId: flightId,
        reason: 'warnings-blocked',
        issues: eligibility.warnings,
      });
      continue;
    }

    try {
      const assignment = await createAssignment({
        airlineId,
        pilotId: parsed.pilotId,
        scheduledFlightId: flightId,
        assignedAircraftId: parsed.assignedAircraftId ?? null,
        assignedById: user.id,
        note: parsed.note ?? null,
      });

      created.push({
        scheduledFlightId: flightId,
        assignmentId: assignment.id,
        warnings: eligibility.warnings,
      });

      // Audit-log per assignment. Wir loggen jede einzelne nicht eine
      // "bulk" sub-action — das macht spätere queries einfacher
      // ("zeig mir alle assignments die seit gestern erstellt wurden").
      await logAdminAction({
        actorId: user.id,
        action: 'roster.assignment.created',
        targetType: 'RosterAssignment',
        targetId: assignment.id,
        metadata: {
          pilotId: parsed.pilotId,
          scheduledFlightId: flightId,
          assignedAircraftId: parsed.assignedAircraftId ?? null,
          allowWarnings: parsed.allowWarnings,
          warningCount: eligibility.warnings.length,
          warningCodes: eligibility.warnings.map((w) => w.code),
          source: parsed.source,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation. Triggered wenn die kombo
      // [pilotId, scheduledFlightId] schon existiert. Kein crash —
      // markieren als duplicate skipped.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        skipped.push({
          scheduledFlightId: flightId,
          reason: 'duplicate',
          issues: [
            {
              code: 'pilot-conflict',
              message: 'Pilot ist bereits zu diesem Flight gerostert.',
            },
          ],
        });
        continue;
      }
      // Anderer DB-error: log + skip with 'unknown'.
      console.error('[roster] createAssignment failed for flight', flightId, err);
      skipped.push({
        scheduledFlightId: flightId,
        reason: 'unknown',
        issues: [],
      });
    }
  }

  // Push-notification: nur fan-out wenn >=1 created und enabled.
  let pushSent = false;
  if (
    parsed.sendPushNotification &&
    created.length > 0 &&
    isPushConfigured()
  ) {
    try {
      const title = '📋 Neue Roster-Zuweisung';
      const body =
        created.length === 1
          ? `Du wurdest auf 1 Flug zugewiesen. Tippe für Details.`
          : `Du wurdest auf ${created.length} Flüge zugewiesen. Tippe für Details.`;
      await sendPushToUser(parsed.pilotId, {
        title,
        body,
        url: '/dashboard',
        tag: 'vam-roster-new',
      });
      pushSent = true;
    } catch (err) {
      // Silent fail — push-failure soll die action nicht zerstören.
      console.error('[roster] push fan-out failed:', err);
    }
  }

  // Revalidate beide UIs: admin-list + pilot-dashboard.
  revalidatePath('/airline/roster');
  revalidatePath('/dashboard');

  return {
    created,
    skipped,
    pushNotificationSent: pushSent,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Track 5 #28 (Section F) — Auto-Rostering server-actions
// ─────────────────────────────────────────────────────────────────────

/**
 * Wraps `generateAutoRosterPreview` mit auth-gate. Reine read-only —
 * berechnet die roster-vorschläge anhand fairness + eligibility, ohne
 * irgendwas in die DB zu schreiben. Admin reviewt das ergebnis im
 * preview-UI und triggert dann `commitAutoRosterAssignments` für den
 * actual create.
 *
 * Performance-warnung: bei großen flight×pilot-mengen kann das ein paar
 * sekunden dauern (jeder pilot × flight kombo macht eligibility-DB-
 * calls). Daher das frontend in pending-state setzen während des calls.
 */
const PreviewInputSchema = z.object({
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  pilotIdsWhitelist: z.array(z.string()).optional(),
  pilotIdsBlacklist: z.array(z.string()).optional(),
  maxFlightsPerPilot: z.number().int().positive().optional(),
});

export type PreviewAutoRosterInput = z.input<typeof PreviewInputSchema>;

export async function previewAutoRoster(input: PreviewAutoRosterInput) {
  const { airlineId } = await requireAirlineManagerWithAirline();
  const parsed = PreviewInputSchema.parse(input);

  // Import dynamisch um zu vermeiden dass die generateAutoRosterPreview-
  // funktion (heavy DB-imports) zum bundle des "use server"-modules
  // gerechnet wird ohne dass sie wirklich genutzt wird. Server-actions
  // werden bei build-zeit statisch analysiert, dynamic import hält die
  // dep-graph clean.
  const { generateAutoRosterPreview } = await import(
    '@/lib/roster/auto-roster'
  );

  return generateAutoRosterPreview({
    airlineId,
    fromDate: parsed.fromDate,
    toDate: parsed.toDate,
    pilotIdsWhitelist: parsed.pilotIdsWhitelist,
    pilotIdsBlacklist: parsed.pilotIdsBlacklist,
    maxFlightsPerPilot: parsed.maxFlightsPerPilot,
  });
}

/**
 * Commits auto-roster proposals via bulk-create-pattern. Gruppiert die
 * proposals nach pilotId (weil `createRosterAssignments` 1 pilot × N
 * flights akzeptiert), dann ruft pro gruppe einmal die create-action
 * auf — mit `source: 'auto'` für audit-trail.
 *
 * Returns aggregat: total created/skipped + push-pilots-count. Wir
 * detail-listen nicht jede einzelne assignment (das wäre redundant zu
 * preview-table), nur summary-zahlen.
 */
const CommitAutoInputSchema = z.object({
  /** Format: { pilotId: [scheduledFlightId, ...] }. */
  assignmentsByPilot: z.record(z.string(), z.array(z.string().min(1))),
  /** Wenn true, alle pilots kriegen single summary-push. Default ON. */
  sendPushNotifications: z.boolean().optional().default(true),
});

export type CommitAutoRosterInput = z.input<typeof CommitAutoInputSchema>;

export type CommitAutoRosterResult = {
  totalCreated: number;
  totalSkipped: number;
  pilotsNotified: number;
  perPilotBreakdown: Array<{
    pilotId: string;
    created: number;
    skipped: number;
    pushSent: boolean;
  }>;
};

export async function commitAutoRosterAssignments(
  input: CommitAutoRosterInput,
): Promise<CommitAutoRosterResult> {
  // Gate-check via requireAirlineManagerWithAirline läuft schon in
  // createRosterAssignments selbst. Kein separater check hier nötig.
  const parsed = CommitAutoInputSchema.parse(input);

  let totalCreated = 0;
  let totalSkipped = 0;
  let pilotsNotified = 0;
  const perPilotBreakdown: CommitAutoRosterResult['perPilotBreakdown'] = [];

  for (const [pilotId, flightIds] of Object.entries(parsed.assignmentsByPilot)) {
    if (flightIds.length === 0) continue;

    const result = await createRosterAssignments({
      pilotId,
      scheduledFlightIds: flightIds,
      allowWarnings: false, // Auto-modus filtert schon vorher; warnings sollten hier eh nicht vorkommen
      sendPushNotification: parsed.sendPushNotifications,
      source: 'auto',
    });

    totalCreated += result.created.length;
    totalSkipped += result.skipped.length;
    if (result.pushNotificationSent) pilotsNotified += 1;

    perPilotBreakdown.push({
      pilotId,
      created: result.created.length,
      skipped: result.skipped.length,
      pushSent: result.pushNotificationSent,
    });
  }

  // revalidatePath happens innerhalb createRosterAssignments pro call.
  // Hier extra-revalidate auf die auto-page falls die admin nochmal
  // generieren will mit den jetzt-committed assignments im hintergrund.
  revalidatePath('/airline/roster/auto');

  return {
    totalCreated,
    totalSkipped,
    pilotsNotified,
    perPilotBreakdown,
  };
}
