'use client';

import { useState, useTransition } from 'react';
import { deleteScheduleTemplate } from './actions';

interface Props {
  templateId: string;
  /** Display-name für das confirmation-prompt (route flightNumber typically). */
  templateLabel: string;
  /** Wenn > 0: zeigt warnung dass mit-instances mit gelöscht werden. */
  scheduledFlightCount: number;
}

/**
 * Delete-button für ScheduleTemplate. Mirror der pattern aus
 * delete-rank-button.tsx: 2-step inline confirm, kein modal.
 *
 * Wenn scheduledFlightCount > 0: zusätzliche warnung im confirm-text
 * dass die instances mit-cascadiert werden. Der admin soll wissen was
 * passiert. Bookings selbst bleiben intakt (SetNull-cascade auf
 * Booking.scheduledFlightId via back-relation).
 */
export function DeleteScheduleTemplateButton({
  templateId,
  templateLabel,
  scheduledFlightCount,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    const fd = new FormData();
    fd.set('templateId', templateId);
    startTransition(async () => {
      const result = await deleteScheduleTemplate(fd);
      if (!result.ok) {
        setError(result.message ?? 'Fehler beim löschen');
        setConfirming(false);
      } else {
        setError(null);
        // server-action revalidatet path, liste rerendered ohne dieses
        // template. Kein redirect nötig.
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-xs text-gray-600 dark:text-gray-400">
          &ldquo;{templateLabel}&rdquo;
          {scheduledFlightCount > 0
            ? ` + ${scheduledFlightCount} instances`
            : ''}{' '}
          wirklich löschen?
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded transition"
          >
            {isPending ? '…' : 'Ja, löschen'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded transition"
          >
            Nein
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 sm:ml-2">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition"
      >
        Löschen
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
