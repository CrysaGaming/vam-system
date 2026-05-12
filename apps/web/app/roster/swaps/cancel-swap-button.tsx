'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelSwapRequestAction } from './actions';

/**
 * Track 5 #29 — Cancel-button für outgoing swap-requests.
 *
 * Inline confirm-flow: click → "Wirklich stornieren?" inline ack +
 * confirm/dismiss. Schützt vor accidental-cancel ohne extra modal.
 */
export function CancelSwapButton({ swapRequestId }: { swapRequestId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await cancelSwapRequestAction({ swapRequestId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition"
        >
          Stornieren
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 mt-3">
      <span className="text-xs text-muted-foreground">Wirklich stornieren?</span>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
        className="px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition"
      >
        Nein
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={submit}
        className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition disabled:opacity-50"
      >
        {isPending ? '…' : 'Ja, stornieren'}
      </button>
      {error && (
        <span className="text-xs text-red-700 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
