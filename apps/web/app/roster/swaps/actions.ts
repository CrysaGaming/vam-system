'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import {
  createSwapRequest,
  acceptSwapRequest,
  rejectSwapRequest,
  cancelSwapRequest,
  SwapRequestValidationError,
  logAdminAction,
} from '@vam/db';
import { requireUserWithAirline } from '@/lib/auth';
import { sendPushToUser, isPushConfigured } from '@/lib/push/vapid';

/**
 * Track 5 #29 (Section F) — Roster-Swap server-actions
 *
 * Pilot-seitige actions. Auth via `requireUserWithAirline()` — Manager-
 * gate brauchen wir nicht weil pilots ihre EIGENEN swaps verwalten.
 * Authorisierung der actions selber prüft jeweils ob der user der
 * requester oder target ist (im DB-helper, nicht hier — single-source-
 * of-truth).
 *
 * # Push-notification flow
 *
 *   - create → push an TARGET-pilot ("Pilot X will swappen")
 *   - accept → push an REQUESTER ("Pilot Y hat dein swap akzeptiert")
 *   - reject → push an REQUESTER ("Pilot Y hat dein swap abgelehnt")
 *   - cancel → kein push (requester cancelt selbst; target weiß noch
 *     nicht mal dass es einen swap gab wenn er nicht inbox geöffnet hat)
 *
 * Alle pushes mit `tag: 'vam-swap-*'` damit follow-ups die vorherige
 * notification replacen statt stack-en. Silent-fail bei push-failure
 * (action soll nicht crashen).
 *
 * # Audit-trail
 *
 * Jede mutation loggt eine admin-audit-row mit action='roster.swap.X'.
 * Auch wenn das nicht-admin actions sind: `logAdminAction` ist tolerant
 * gegen non-admin actorIds (actor ist halt der pilot, kein admin). Das
 * gibt uns trotzdem eine vollständige timeline für trouble-shooting
 * ("warum hat sich plötzlich pilot X auf flight 123 gefunden?" →
 * audit-log zeigt den swap-flow).
 */

const CreateSchema = z.object({
  requesterAssignmentId: z.string().min(1),
  targetAssignmentId: z.string().min(1),
  message: z.string().max(500).nullable().optional(),
});

const RespondSchema = z.object({
  swapRequestId: z.string().min(1),
  responseMessage: z.string().max(500).nullable().optional(),
});

const CancelSchema = z.object({
  swapRequestId: z.string().min(1),
});

export type SwapActionError = {
  ok: false;
  code: string;
  message: string;
};

export type SwapActionSuccess<T = unknown> = {
  ok: true;
  data: T;
};

export type SwapActionResult<T = unknown> = SwapActionError | SwapActionSuccess<T>;

function toErrorResult(err: unknown): SwapActionError {
  if (err instanceof SwapRequestValidationError) {
    return { ok: false, code: err.code, message: err.message };
  }
  return {
    ok: false,
    code: 'unknown',
    message: err instanceof Error ? err.message : 'Unbekannter Fehler.',
  };
}

/**
 * Create eine swap-request. Validation läuft im DB-helper (siehe
 * createSwapRequest in @vam/db/roster/swaps). Push-fanout danach.
 */
export async function createSwapRequestAction(
  input: z.input<typeof CreateSchema>,
): Promise<SwapActionResult<{ swapRequestId: string; pushSent: boolean }>> {
  try {
    const { id: userId } = await requireUserWithAirline();
    const parsed = CreateSchema.parse(input);

    const swap = await createSwapRequest({
      requesterId: userId,
      requesterAssignmentId: parsed.requesterAssignmentId,
      targetAssignmentId: parsed.targetAssignmentId,
      message: parsed.message ?? null,
    });

    // Push fan-out an target-pilot
    let pushSent = false;
    if (isPushConfigured()) {
      try {
        await sendPushToUser(swap.targetPilotId, {
          title: '🔄 Swap-Anfrage erhalten',
          body: `${swap.requester.name ?? 'Ein Pilot'} möchte einen Flug mit dir tauschen.`,
          url: '/roster/swaps',
          tag: 'vam-swap-incoming',
        });
        pushSent = true;
      } catch (err) {
        console.error('[swap-request] push to target failed:', err);
      }
    }

    // Audit-log (best-effort)
    try {
      await logAdminAction({
        actorId: userId,
        action: 'roster.swap.created',
        targetType: 'RosterSwapRequest',
        targetId: swap.id,
        metadata: {
          requesterAssignmentId: parsed.requesterAssignmentId,
          targetAssignmentId: parsed.targetAssignmentId,
          targetPilotId: swap.targetPilotId,
        },
      });
    } catch {
      // swallow
    }

    revalidatePath('/roster/swaps');
    revalidatePath('/dashboard');

    return { ok: true, data: { swapRequestId: swap.id, pushSent } };
  } catch (err) {
    return toErrorResult(err);
  }
}

/**
 * Target-pilot akzeptiert. Triggert die DB-transaction die beide
 * assignments tauscht. Push an requester.
 */
export async function acceptSwapRequestAction(
  input: z.input<typeof RespondSchema>,
): Promise<SwapActionResult<{ pushSent: boolean }>> {
  try {
    const { id: userId } = await requireUserWithAirline();
    const parsed = RespondSchema.parse(input);

    const swap = await acceptSwapRequest({
      swapRequestId: parsed.swapRequestId,
      acceptingUserId: userId,
      responseMessage: parsed.responseMessage ?? null,
    });

    let pushSent = false;
    if (isPushConfigured()) {
      try {
        await sendPushToUser(swap.requesterId, {
          title: '✅ Swap akzeptiert',
          body: `${swap.targetPilot.name ?? 'Pilot'} hat deinen Swap angenommen.`,
          url: '/roster/swaps',
          tag: 'vam-swap-accepted',
        });
        pushSent = true;
      } catch (err) {
        console.error('[swap-request] push to requester failed:', err);
      }
    }

    try {
      await logAdminAction({
        actorId: userId,
        action: 'roster.swap.accepted',
        targetType: 'RosterSwapRequest',
        targetId: swap.id,
        metadata: {
          requesterId: swap.requesterId,
          targetPilotId: swap.targetPilotId,
        },
      });
    } catch {
      /* swallow */
    }

    revalidatePath('/roster/swaps');
    revalidatePath('/airline/roster');
    revalidatePath('/dashboard');

    return { ok: true, data: { pushSent } };
  } catch (err) {
    return toErrorResult(err);
  }
}

/** Target-pilot lehnt ab. Keine assignment-mutation, nur status-flip. */
export async function rejectSwapRequestAction(
  input: z.input<typeof RespondSchema>,
): Promise<SwapActionResult<{ pushSent: boolean }>> {
  try {
    const { id: userId } = await requireUserWithAirline();
    const parsed = RespondSchema.parse(input);

    const swap = await rejectSwapRequest({
      swapRequestId: parsed.swapRequestId,
      acceptingUserId: userId,
      responseMessage: parsed.responseMessage ?? null,
    });

    let pushSent = false;
    if (isPushConfigured()) {
      try {
        await sendPushToUser(swap.requesterId, {
          title: '❌ Swap abgelehnt',
          body: `${swap.targetPilot.name ?? 'Pilot'} hat deinen Swap abgelehnt.`,
          url: '/roster/swaps',
          tag: 'vam-swap-rejected',
        });
        pushSent = true;
      } catch (err) {
        console.error('[swap-request] push to requester failed:', err);
      }
    }

    try {
      await logAdminAction({
        actorId: userId,
        action: 'roster.swap.rejected',
        targetType: 'RosterSwapRequest',
        targetId: swap.id,
        metadata: {
          requesterId: swap.requesterId,
          targetPilotId: swap.targetPilotId,
        },
      });
    } catch {
      /* swallow */
    }

    revalidatePath('/roster/swaps');

    return { ok: true, data: { pushSent } };
  } catch (err) {
    return toErrorResult(err);
  }
}

/** Requester cancelt. Keine push. */
export async function cancelSwapRequestAction(
  input: z.input<typeof CancelSchema>,
): Promise<SwapActionResult<{ swapRequestId: string }>> {
  try {
    const { id: userId } = await requireUserWithAirline();
    const parsed = CancelSchema.parse(input);

    const swap = await cancelSwapRequest({
      swapRequestId: parsed.swapRequestId,
      cancellingUserId: userId,
    });

    try {
      await logAdminAction({
        actorId: userId,
        action: 'roster.swap.cancelled',
        targetType: 'RosterSwapRequest',
        targetId: swap.id,
        metadata: {
          requesterId: swap.requesterId,
          targetPilotId: swap.targetPilotId,
        },
      });
    } catch {
      /* swallow */
    }

    revalidatePath('/roster/swaps');

    return { ok: true, data: { swapRequestId: swap.id } };
  } catch (err) {
    return toErrorResult(err);
  }
}
