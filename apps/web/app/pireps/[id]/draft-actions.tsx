'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateDraftPirep,
  submitDraftPirep,
  discardDraftPirep,
} from '../actions';

/**
 * Draft-PIREP edit + publish + discard actions (option #19).
 *
 * Rendered in /pireps/[id] when status=Draft AND the viewer is the
 * pilot who owns the PIREP. Mirrors the approval-actions.tsx pattern
 * (client-component wrapping server-actions, useTransition for pending
 * state, inline error rendering).
 *
 * Three actions:
 *   1. Speichern  → updateDraftPirep with diff against initial state.
 *                   Stays on the page; inputs reset to the new values.
 *   2. Submit     → submitDraftPirep then redirect to /pireps with the
 *                   intent that the pilot sees their PIREP in the
 *                   "Eingereicht"-state-styled list. The list page is
 *                   the natural confirmation: PIREP appears with the
 *                   yellow "Eingereicht" badge instead of cyan "Entwurf".
 *   3. Verwerfen  → discardDraftPirep, gated by window.confirm() because
 *                   it deletes the row + decrements user totals + rolls
 *                   back the booking. Browser-native confirm is fine
 *                   for a single OK/Cancel — adding a custom modal
 *                   would be over-engineering for v1.
 *
 * Edit-form fields:
 *   - remarks (textarea): the splice-prefixed flag-bracket text the
 *     auto-generator produced. Pilot is expected to remove false-
 *     positive flags or add context. Most-edited field.
 *   - flightTimeMin (number, minutes): block-to-block, edit-able when
 *     the BLOCK_OFF/BLOCK_ON heuristic mis-detected.
 *   - fuelUsedKg (number, kg): optional, often null when ACARS didn't
 *     capture fuel.
 *   - landingRateFpm (number): optional, often null on touch-and-go.
 *
 * Diff-on-save: we send the full set of values, but the server-side
 * action treats undefined as "no change". To keep things simple here
 * we always send all four — the server's internal Object.keys-empty
 * check short-circuits if nothing actually differed (we re-load the
 * page after each save, so a truly empty diff is rare).
 */
export function DraftActions({
  pirepId,
  initialRemarks,
  initialFlightTimeMin,
  initialFuelUsedKg,
  initialLandingRateFpm,
}: {
  pirepId: string;
  initialRemarks: string | null;
  initialFlightTimeMin: number | null;
  initialFuelUsedKg: number | null;
  initialLandingRateFpm: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState(false);

  // Form state. Strings throughout so the empty-string vs 0 distinction
  // is preserved (number-input value is always a string in DOM-land).
  // Conversion to number | null happens in the submit handlers.
  const [remarks, setRemarks] = useState(initialRemarks ?? '');
  const [flightTimeMin, setFlightTimeMin] = useState(
    initialFlightTimeMin?.toString() ?? '',
  );
  const [fuelUsedKg, setFuelUsedKg] = useState(
    initialFuelUsedKg?.toString() ?? '',
  );
  const [landingRateFpm, setLandingRateFpm] = useState(
    initialLandingRateFpm?.toString() ?? '',
  );

  // Helper: convert a number-input string to (number | null). Empty →
  // null (which is "clear the field"); valid number → number; non-
  // numeric (shouldn't happen with type=number but defense) → null.
  function parseNum(s: string): number | null {
    if (s.trim() === '') return null;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }

  const handleSave = () => {
    setError(null);
    setSavedHint(false);
    startTransition(async () => {
      try {
        await updateDraftPirep(pirepId, {
          // Empty string remarks → null (consistent with server-action's
          // "" → null collapse). Pilot can clear the auto-generated
          // suffix entirely if they prefer.
          remarks: remarks.trim() === '' ? null : remarks.trim(),
          flightTimeMin: parseNum(flightTimeMin),
          fuelUsedKg: parseNum(fuelUsedKg),
          landingRateFpm: parseNum(landingRateFpm),
        });
        setSavedHint(true);
        router.refresh();
        // Hide "Gespeichert" hint after a moment so it doesn't linger
        // confusingly when the pilot starts editing again.
        setTimeout(() => setSavedHint(false), 2500);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  };

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      try {
        // Save current edits first so the published PIREP reflects what
        // the pilot sees in the textarea — without this they'd have to
        // remember to click Speichern before Submit, easy to forget.
        await updateDraftPirep(pirepId, {
          remarks: remarks.trim() === '' ? null : remarks.trim(),
          flightTimeMin: parseNum(flightTimeMin),
          fuelUsedKg: parseNum(fuelUsedKg),
          landingRateFpm: parseNum(landingRateFpm),
        });
        await submitDraftPirep(pirepId);
        // Redirect to the PIREP list — that's where the pilot sees the
        // status flip to "Eingereicht" alongside their other PIREPs.
        router.push('/pireps');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  };

  const handleDiscard = () => {
    setError(null);
    // window.confirm is the simplest "are you sure?" gate for a
    // destructive action. The action deletes the PIREP, decrements
    // user totals, and rolls back the booking — irreversible. A custom
    // modal would be over-engineering for the rare discard case.
    const confirmed = window.confirm(
      'Soll dieser Draft-PIREP wirklich verworfen werden?\n\n' +
        'Das löscht den PIREP und macht die Flug-Stunden + Booking-Fortschritt rückgängig. ' +
        'Diese Aktion kann nicht rückgängig gemacht werden.',
    );
    if (!confirmed) return;

    startTransition(async () => {
      try {
        await discardDraftPirep(pirepId);
        router.push('/pireps');
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  };

  return (
    <div
      style={{
        backgroundColor: 'rgba(6, 182, 212, 0.05)', // cyan-500 @ 5%
        borderColor: 'rgba(6, 182, 212, 0.3)',
      }}
      className="border rounded-lg p-6 mb-8"
    >
      <div className="mb-5">
        <h2 className="text-lg font-semibold">
          Draft — wartet auf deine Freigabe
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Dieser PIREP wurde vom ACARS-Client automatisch erzeugt. Du
          kannst die Bemerkungen + Werte editieren und ihn dann zur
          Review einreichen, oder verwerfen wenn der Flug nicht
          gewertet werden soll.
        </p>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Bemerkungen
          </span>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={5}
            disabled={isPending}
            placeholder="Optional — z. B. Hinweise zum Flug, Erklärung wenn ein Auto-Flag fälschlich gesetzt wurde, ..."
            style={{ backgroundColor: '#111827', borderColor: '#374151' }}
            className="w-full mt-1 px-3 py-2 border rounded text-sm focus:outline-none disabled:opacity-50 text-white font-mono"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">
            Maximal 5000 Zeichen. Auto-Flags wie{' '}
            <code className="font-mono">[ACARS-flag: …]</code> oder{' '}
            <code className="font-mono">[Replay-flag: …]</code> kannst
            du löschen wenn sie falsch positiv waren — die Admins
            sehen den unedited Verlauf nicht.
          </span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Flugzeit (min)
            </span>
            <input
              type="number"
              value={flightTimeMin}
              onChange={(e) => setFlightTimeMin(e.target.value)}
              min={1}
              disabled={isPending}
              style={{ backgroundColor: '#111827', borderColor: '#374151' }}
              className="w-full mt-1 px-3 py-2 border rounded text-sm focus:outline-none disabled:opacity-50 text-white font-mono"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Treibstoff (kg)
            </span>
            <input
              type="number"
              value={fuelUsedKg}
              onChange={(e) => setFuelUsedKg(e.target.value)}
              min={0}
              disabled={isPending}
              style={{ backgroundColor: '#111827', borderColor: '#374151' }}
              className="w-full mt-1 px-3 py-2 border rounded text-sm focus:outline-none disabled:opacity-50 text-white font-mono"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Landing Rate (fpm)
            </span>
            <input
              type="number"
              value={landingRateFpm}
              onChange={(e) => setLandingRateFpm(e.target.value)}
              disabled={isPending}
              style={{ backgroundColor: '#111827', borderColor: '#374151' }}
              className="w-full mt-1 px-3 py-2 border rounded text-sm focus:outline-none disabled:opacity-50 text-white font-mono"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          style={{ backgroundColor: '#374151' }}
          className="px-4 py-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition text-white"
        >
          {isPending ? '...' : '💾 Speichern'}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          style={{ backgroundColor: '#16a34a' }}
          className="px-4 py-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition text-white"
        >
          {isPending ? '...' : '✓ Submit zur Review'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleDiscard}
          disabled={isPending}
          style={{ backgroundColor: '#dc2626' }}
          className="px-4 py-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition text-white"
        >
          {isPending ? '...' : '🗑 Verwerfen'}
        </button>
      </div>

      {savedHint && !error && (
        <p
          style={{
            color: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.1)',
          }}
          className="mt-3 text-sm px-3 py-2 rounded"
        >
          ✓ Gespeichert. Der Draft bleibt unveröffentlicht — klick
          „Submit zur Review" wenn du ihn einreichen willst.
        </p>
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
