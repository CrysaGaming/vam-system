'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approvePirep, rejectPirep } from '../actions';

export function ApprovalActions({ pirepId }: { pirepId: string }) {
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleApprove = () => {
    setError(null);
    startTransition(async () => {
      try {
        await approvePirep(pirepId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  };

  const handleReject = () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError('Grund muss mindestens 3 Zeichen lang sein');
      return;
    }
    startTransition(async () => {
      try {
        await rejectPirep(pirepId, reason.trim());
        setShowRejectForm(false);
        setReason('');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  };

  return (
    <div className="bg-indigo-500/5 border border-indigo-500/30 rounded-lg p-6">
      <div className="flex justify-between items-start gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Prüfung erforderlich</h2>
          <p className="text-sm text-gray-400 mt-1">
            Du kannst diesen PIREP genehmigen oder ablehnen.
          </p>
        </div>
        {!showRejectForm && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleApprove}
              disabled={isPending}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition"
            >
              {isPending ? '...' : '✓ Genehmigen'}
            </button>
            <button
              type="button"
              onClick={() => setShowRejectForm(true)}
              disabled={isPending}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition"
            >
              ✗ Ablehnen
            </button>
          </div>
        )}
      </div>

      {showRejectForm && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm text-gray-400">Ablehnungsgrund</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Z. B. Flugzeit unrealistisch, falsche Route, ..."
              rows={3}
              disabled={isPending}
              className="w-full mt-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm focus:outline-none focus:border-red-500 disabled:opacity-50"
            />
          </label>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => {
                setShowRejectForm(false);
                setReason('');
                setError(null);
              }}
              disabled={isPending}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm transition"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isPending || reason.trim().length < 3}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition"
            >
              {isPending ? '...' : 'Ablehnen bestätigen'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded">
          {error}
        </p>
      )}
    </div>
  );
}