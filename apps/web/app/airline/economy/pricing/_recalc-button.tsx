'use client';

/**
 * Welle M / M1 — Recalculate button (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recalculateRoutePricesAction } from './actions';

export default function RecalculateButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function recalc() {
    setMessage(null);
    startTransition(async () => {
      const res = await recalculateRoutePricesAction();
      if (res.ok) {
        setMessage(res.message ?? 'Done.');
        router.refresh();
      } else {
        setMessage(`Error: ${res.error}`);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={recalc}
        disabled={isPending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Berechne…' : '🔄 Alle preise neu berechnen'}
      </button>
      {message && (
        <span className="text-sm text-muted-foreground">{message}</span>
      )}
    </div>
  );
}
