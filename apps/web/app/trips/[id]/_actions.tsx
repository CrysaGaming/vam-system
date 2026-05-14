'use client';

/**
 * Welle K / K5 — Trip detail action-buttons (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  joinInterAirlineTripAction,
  leaveInterAirlineTripAction,
  confirmTripAction,
  completeTripAction,
  cancelTripAction,
} from '../actions';

type Props = {
  tripId: string;
  status: 'Proposed' | 'Confirmed' | 'Completed' | 'Cancelled';
  isOrganizer: boolean;
  isParticipant: boolean;
  canJoin: boolean;
};

export default function TripActions({
  tripId,
  status,
  isOrganizer,
  isParticipant,
  canJoin,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showJoinForm, setShowJoinForm] = useState(false);

  function run<T>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const res = (await fn()) as { ok: boolean; error?: string };
      if (!res.ok && res.error) {
        setError(res.error);
      } else {
        router.refresh();
        setShowJoinForm(false);
        setNotes('');
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
        {/* Join (für nicht-participant + offene trips) */}
        {!isParticipant && canJoin && !showJoinForm && (
          <button
            type="button"
            onClick={() => setShowJoinForm(true)}
            disabled={isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            🤝 Beitreten
          </button>
        )}

        {/* Leave (participants außer organizer, solange nicht completed/cancelled) */}
        {isParticipant && !isOrganizer && (status === 'Proposed' || status === 'Confirmed') && (
          <button
            type="button"
            onClick={() => run(() => leaveInterAirlineTripAction(tripId))}
            disabled={isPending}
            className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-500/20 disabled:opacity-50 dark:text-orange-300"
          >
            Verlassen
          </button>
        )}

        {/* Organizer actions */}
        {isOrganizer && status === 'Proposed' && (
          <>
            <button
              type="button"
              onClick={() => run(() => confirmTripAction(tripId))}
              disabled={isPending}
              className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-500/20 disabled:opacity-50 dark:text-green-300"
            >
              ✓ Confirmen
            </button>
            <button
              type="button"
              onClick={() => run(() => cancelTripAction(tripId))}
              disabled={isPending}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
            >
              Cancel
            </button>
          </>
        )}
        {isOrganizer && status === 'Confirmed' && (
          <>
            <button
              type="button"
              onClick={() => run(() => completeTripAction(tripId))}
              disabled={isPending}
              className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-500/20 disabled:opacity-50 dark:text-green-300"
            >
              ✓ Als completed markieren
            </button>
            <button
              type="button"
              onClick={() => run(() => cancelTripAction(tripId))}
              disabled={isPending}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {showJoinForm && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Optional notiz (z.B. dein aircraft, callsign-hint)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="z.B. A320 D-AICA, IVAO, MAGE callsign"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={isPending}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                run(() => joinInterAirlineTripAction({ tripId, notes }))
              }
              disabled={isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isPending ? 'Beitrete…' : 'Beitreten bestätigen'}
            </button>
            <button
              type="button"
              onClick={() => setShowJoinForm(false)}
              disabled={isPending}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-indigo-400 disabled:opacity-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
