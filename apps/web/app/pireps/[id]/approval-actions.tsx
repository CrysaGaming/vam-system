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
    <div
      style={{
        backgroundColor: 'rgba(99, 102, 241, 0.05)',
        borderColor: 'rgba(99, 102, 241, 0.3)',
      }}
      className="border rounded-lg p-6"
    >
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
              style={{ backgroundColor: '#16a34a' }}
              className="px-4 py-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition text-white"
            >
              {isPending ? '...' : '✓ Genehmigen'}
            </button>
            <button
              type="button"
              onClick={() => setShowRejectForm(true)}
              disabled={isPending}
              style={{ backgroundColor: '#dc2626' }}
              className="px-4 py-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition text-white"
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
              style={{ backgroundColor: '#111827', borderColor: '#374151' }}
              className="w-full mt-1 px-3 py-2 border rounded text-sm focus:outline-none disabled:opacity-50 text-white"
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
              style={{ backgroundColor: '#374151' }}
              className="px-4 py-2 hover:opacity-90 disabled:opacity-50 rounded text-sm transition text-white"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isPending || reason.trim().length < 3}
              style={{ backgroundColor: '#dc2626' }}
              className="px-4 py-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition text-white"
            >
              {isPending ? '...' : 'Ablehnen bestätigen'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          style={{
            color: '#f87171',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
          }}
          className="mt-3 text-sm px-3 py-2 rounded"
        >
          {error}
        </p>
      )}
    </div>
  );
}