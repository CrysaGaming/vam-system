'use client';

/**
 * Welle L / L5 — NOTAM detail action buttons (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  publishNotamAction,
  cancelNotamAction,
  deleteNotamAction,
} from '../actions';
import type { NotamStatus } from '@/lib/notams/status';

export default function NotamActions({
  notamId,
  status,
}: {
  notamId: string;
  status: NotamStatus;
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
    if (!confirm('NOTAM-Draft wirklich löschen?')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteNotamAction(notamId);
      if (res.ok) {
        router.push('/airline/notams');
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
        {status === 'Draft' && (
          <>
            <button
              type="button"
              onClick={() => run(() => publishNotamAction(notamId))}
              disabled={isPending}
              className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm font-semibold text-green-700 hover:bg-green-500/20 disabled:opacity-50 dark:text-green-300"
            >
              📤 Publishen
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
            >
              Löschen
            </button>
          </>
        )}

        {(status === 'Pending' || status === 'Active' || status === 'Expired') && (
          <button
            type="button"
            onClick={() => run(() => cancelNotamAction(notamId))}
            disabled={isPending}
            className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
