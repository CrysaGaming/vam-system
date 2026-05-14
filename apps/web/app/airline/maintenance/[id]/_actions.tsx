'use client';

/**
 * Welle L / L3 — Maintenance detail action buttons (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  startMaintenanceAction,
  completeMaintenanceAction,
  cancelMaintenanceAction,
  deleteMaintenanceAction,
} from '../actions';

type Status = 'Scheduled' | 'InProgress' | 'Completed' | 'Cancelled';

export default function MaintenanceActions({
  eventId,
  status,
}: {
  eventId: string;
  status: Status;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!confirm('Maintenance-event wirklich löschen?')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteMaintenanceAction(eventId);
      if (res.ok) {
        router.push('/airline/maintenance');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {status === 'Scheduled' && (
          <>
            <button
              type="button"
              onClick={() => run(() => startMaintenanceAction(eventId))}
              disabled={isPending}
              className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-500/20 disabled:opacity-50 dark:text-orange-300"
            >
              ▶ Maintenance starten
            </button>
            <button
              type="button"
              onClick={() => run(() => cancelMaintenanceAction(eventId))}
              disabled={isPending}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:border-red-400 hover:text-red-600 disabled:opacity-50"
            >
              Löschen
            </button>
          </>
        )}

        {status === 'InProgress' && (
          <>
            <button
              type="button"
              onClick={() => run(() => completeMaintenanceAction(eventId))}
              disabled={isPending}
              className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm font-semibold text-green-700 hover:bg-green-500/20 disabled:opacity-50 dark:text-green-300"
            >
              ✓ Abschließen
            </button>
            <button
              type="button"
              onClick={() => run(() => cancelMaintenanceAction(eventId))}
              disabled={isPending}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
