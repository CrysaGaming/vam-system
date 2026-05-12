'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptSwapRequestAction, rejectSwapRequestAction } from './actions';

/**
 * Track 5 #29 — Accept/Reject buttons für eingehende swap-requests.
 *
 * Zeigt zuerst die zwei buttons. Bei click auf accept/reject expandiert
 * sich eine textarea für optional response-message, dann confirm-button.
 * useTransition für pending-state. Bei error → inline-message, bei
 * success → router.refresh damit die page mit neuem status re-rendert.
 */
export function SwapResponseButtons({ swapRequestId }: { swapRequestId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<'idle' | 'accept' | 'reject'>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (mode === 'idle') return;
    startTransition(async () => {
      const action =
        mode === 'accept' ? acceptSwapRequestAction : rejectSwapRequestAction;
      const result = await action({
        swapRequestId,
        responseMessage: message.trim() || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Reset + refresh
      setMode('idle');
      setMessage('');
      router.refresh();
    });
  }

  if (mode === 'idle') {
    return (
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => setMode('accept')}
          className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition"
        >
          ✅ Akzeptieren
        </button>
        <button
          type="button"
          onClick={() => setMode('reject')}
          className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition"
        >
          ❌ Ablehnen
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-3">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder={
          mode === 'accept'
            ? 'Optional: Notiz an den anderen Piloten (z.B. „klar, alles gut")'
            : 'Optional: Grund für die Ablehnung (z.B. „bin nicht qualifiziert für das aircraft")'
        }
        className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {error && (
        <div className="text-xs text-red-700 dark:text-red-400">{error}</div>
      )}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => {
            setMode('idle');
            setMessage('');
            setError(null);
          }}
          className="px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition"
        >
          Abbrechen
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={submit}
          className={`px-4 py-1.5 rounded-md text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === 'accept'
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {isPending
            ? '…'
            : mode === 'accept'
              ? '✅ Bestätigen'
              : '❌ Bestätigen'}
        </button>
      </div>
    </div>
  );
}
