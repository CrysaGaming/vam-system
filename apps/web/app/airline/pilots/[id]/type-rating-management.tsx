'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminGrantTypeRating,
  adminRevokeTypeRating,
  adminExtendTypeRating,
} from './actions';

/**
 * Welle 13E-6 — Type-rating-grant form (admin perspective).
 *
 * Fields:
 *   - aircraftType: ICAO-string (B738, A20N etc), 2-8 chars uppercase
 *   - expiresAt: optional, default 12 monate ab now (helper-default)
 *   - notes: optional
 */
export function TypeRatingGrantForm({ userId }: { userId: string }) {
  const [aircraftType, setAircraftType] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const normalized = aircraftType.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(normalized)) {
      setError('ICAO-Typ muss 2-8 zeichen sein, nur Buchstaben + Ziffern.');
      return;
    }

    startTransition(async () => {
      try {
        await adminGrantTypeRating({
          userId,
          aircraftType: normalized,
          expiresAt: expiresAt || null,
          notes: notes.trim() || null,
        });
        setAircraftType('');
        setExpiresAt('');
        setNotes('');
        setSuccess(true);
        router.refresh();
        setTimeout(() => setSuccess(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 space-y-3"
    >
      <h3 className="text-sm font-semibold">Neues Type-Rating vergeben</h3>

      {error && (
        <div className="px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="px-3 py-2 rounded border bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300 text-xs">
          ✓ Type-Rating erfolgreich vergeben
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            ICAO-Typ
          </label>
          <input
            type="text"
            value={aircraftType}
            onChange={(e) => setAircraftType(e.target.value)}
            placeholder="z. B. B738, A20N, A35K"
            maxLength={8}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase focus:border-indigo-500 outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Wird in canPilotFlyAircraft exact gegen den booking-aircraft-typ
            geprüft.
          </p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Gültig bis (optional)
          </label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Default: 12 Monate (recurrent-zyklus). Leer = lifetime.
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
          Notiz (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="z. B. erworben in CAE-simulator 04/2026"
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none resize-y"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
      >
        {pending ? 'Vergebe…' : 'Type-Rating vergeben'}
      </button>
    </form>
  );
}

/**
 * Inline action-buttons pro type-rating-row.
 *   - [Verlängern] → +12 monate ab altem expiresAt (oder ab now wenn expired)
 *   - [Widerrufen] → hard-delete (siehe actions.ts comment für rationale)
 *
 * Verlängern hat einen optional notes-prompt für audit ("recurrent sim
 * 04/2026 pass"). Widerrufen ist destructive + verlangt reason.
 */
export function TypeRatingRowActions({
  ratingId,
  userId,
}: {
  ratingId: string;
  userId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleExtend() {
    const note = window.prompt(
      'Optional: Notiz für recurrent-pass (z. B. "CAE sim-check 04/2026 pass"). 12 monate werden automatisch dazugerechnet.',
    );
    if (note === null) return; // cancel
    setError(null);
    startTransition(async () => {
      try {
        await adminExtendTypeRating({
          ratingId,
          userId,
          notesAppend: note.trim() || null,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fehler');
      }
    });
  }

  function handleRevoke() {
    const reason = window.prompt(
      'ACHTUNG: Type-Ratings werden hard-deleted (kein audit-trail im record). ' +
        'Grund für Widerruf (min. 3 zeichen, wird in der server-console geloggt):',
    );
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) {
        setError('Grund muss mindestens 3 zeichen lang sein.');
      }
      return;
    }
    if (
      !window.confirm(
        'Type-Rating wirklich löschen? Die hours-on-type werden mitgelöscht.',
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await adminRevokeTypeRating({
          ratingId,
          userId,
          reason: reason.trim(),
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fehler');
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button
        type="button"
        onClick={handleExtend}
        disabled={pending}
        className="px-2 py-1 text-xs rounded bg-green-500/15 hover:bg-green-500/25 text-green-700 dark:text-green-300 transition disabled:opacity-50"
      >
        Verlängern
      </button>
      <button
        type="button"
        onClick={handleRevoke}
        disabled={pending}
        className="px-2 py-1 text-xs rounded bg-red-500/15 hover:bg-red-500/25 text-red-700 dark:text-red-300 transition disabled:opacity-50"
      >
        Widerrufen
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
