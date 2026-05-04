'use client';

import { useTransition, useState } from 'react';
import { cancelScheduledFlight } from '../actions';

/**
 * Cancel-button für eine ScheduledFlight-instance (Welle 7 commit 7B-3).
 *
 * Confirm-dialog vor dem call (single-step destructive action — analog
 * zu DeleteScheduleTemplateButton). Optimistic UI ist hier bewusst NICHT
 * verwendet weil Cancel selten ist und die response (revalidatePath in
 * der action) das UI ohnehin frisch rendert.
 */
export function CancelScheduledFlightButton({
  flightId,
  flightLabel,
  hasBooking,
}: {
  flightId: string;
  flightLabel: string;
  hasBooking: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const msg = hasBooking
      ? `${flightLabel} ist bereits gebucht — Cancel ist nicht erlaubt.`
      : `${flightLabel} cancellen? Der slot bleibt im audit-trail erhalten und wird vom generator nicht neu erzeugt.`;

    if (hasBooking) {
      setError('Booked-flights können nicht cancelled werden.');
      return;
    }

    if (!window.confirm(msg)) return;

    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('flightId', flightId);
      const res = await cancelScheduledFlight(fd);
      if (!res.ok) setError(res.message ?? 'Cancel fehlgeschlagen.');
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || hasBooking}
        className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
        title={
          hasBooking
            ? 'Booked-flights können nicht cancelled werden'
            : 'Diesen flight cancellen'
        }
      >
        {pending ? 'Cancelling…' : 'Cancel'}
      </button>
      {error && (
        <span className="text-[10px] text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </div>
  );
}
