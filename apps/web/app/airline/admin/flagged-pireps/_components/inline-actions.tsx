'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approvePirep, rejectPirep } from '@/app/pireps/actions';

/**
 * Inline approve/reject form for the Anti-Cheat Review Queue
 * (Welle C / C4). Renders compactly in the footer of each PIREP
 * card on /airline/admin/flagged-pireps.
 *
 * # State machine
 *
 *   idle ──[Approve clicked]──→ optimistic-approve ──→ router-refresh
 *     │
 *     └──[Reject clicked]──→ reject-expanded ──[reason typed + Submit]──→
 *                            optimistic-reject ──→ router-refresh
 *
 * Approve fires immediately (no confirm dialog) because the action is
 * non-destructive — the PIREP moves to approved state, audit trail
 * preserved. Pilot can still see it; admins can still review.
 *
 * Reject requires a reason — same as the existing actions.ts contract.
 * We expand a textarea inline rather than using window.prompt() because
 * (a) prompt is browser-modal and ugly, (b) we want German placeholder
 * text and styling that matches the rest of the page.
 *
 * # Optimistic dispatch
 *
 * `useTransition` keeps the UI responsive — the button visibly disables
 * during the await, then router.refresh() pulls the latest server state
 * (this PIREP disappears from the queue because its status is no longer
 * 'Submitted'). No client-side filtering needed; the server query is
 * the source of truth.
 *
 * # Error handling
 *
 * If the server action throws (auth failure, network glitch, race
 * condition where another admin already approved), we surface the
 * error message inline and let the user retry. The state machine
 * resets to idle so the buttons reactivate.
 */
export function PirepInlineActions({ pirepId }: { pirepId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approvePirep(pirepId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Approve fehlgeschlagen');
      }
    });
  }

  function handleStartReject() {
    setError(null);
    setMode('reject');
  }

  function handleCancelReject() {
    setMode('idle');
    setRejectReason('');
    setError(null);
  }

  function handleSubmitReject() {
    const reason = rejectReason.trim();
    if (reason.length < 5) {
      setError('Bitte mindestens 5 Zeichen Begründung angeben.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await rejectPirep(pirepId, reason);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reject fehlgeschlagen');
      }
    });
  }

  if (mode === 'reject') {
    return (
      <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-1 sm:max-w-md">
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Begründung für Reject (pilot-sichtbar) …"
          rows={2}
          maxLength={500}
          disabled={isPending}
          className="w-full px-3 py-2 text-xs rounded border bg-white dark:bg-gray-950 border-gray-300 dark:border-gray-700 focus:border-rose-500 focus:outline-none disabled:opacity-60"
          autoFocus
        />
        {error && (
          <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleCancelReject}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded border bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-60"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmitReject}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
          >
            {isPending ? 'Reject läuft …' : 'Reject absenden'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex gap-2">
        <button
          onClick={handleStartReject}
          disabled={isPending}
          className="px-3 py-1.5 text-xs rounded border bg-white hover:bg-rose-50 dark:bg-gray-900 dark:hover:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-semibold disabled:opacity-60 transition"
        >
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={isPending}
          className="px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60 transition"
        >
          {isPending ? 'Approve läuft …' : 'Approve'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}
