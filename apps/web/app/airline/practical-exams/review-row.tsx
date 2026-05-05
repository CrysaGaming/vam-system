'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  passPracticalExamAction,
  failPracticalExamAction,
} from './actions';

/**
 * PIREP-info-shape für die page → review-row datenpassung. Strict subset
 * der prisma-fields damit serialization sauber ist (Date-objects sind
 * in next.js server-component → client-component automatisch okay).
 */
export interface PirepInfo {
  id: string;
  flightTimeMin: number | null;
  submittedAt: Date;
  approvedAt: Date | null;
  remarks: string | null;
  departureIcao: string;
  arrivalIcao: string;
  aircraftType: string | null;
  aircraftRegistration: string | null;
}

interface Props {
  enrollmentId: string;
  licenseType: string;
  pilotName: string;
}

/**
 * Pass/Fail-controls für eine review-row (Welle 13E-14c).
 *
 * Drei modes:
 *   IDLE   — zwei buttons (Pass / Fail), keine textarea sichtbar
 *   PASS   — pass-form mit optionalem notes-textarea + bestätigen-button
 *   FAIL   — fail-form mit required reason-textarea + bestätigen-button
 *
 * Nach erfolgreichem submit: router.refresh() — die page lädt neu, die
 * row verschwindet aus der queue (status hat sich geändert für PASS,
 * pirepId wurde reset für FAIL → beide raus aus where-clause).
 *
 * Confirm-dialog vor pass: "Lizenz wird ausgestellt — sicher?". Vor fail:
 * "Pilot kann neu zuweisen — sicher?". Beide via confirm() — keine custom-
 * modal weil das die kompliziertheit nicht rechtfertigt für so seltene
 * actions.
 */
export function ReviewRow({ enrollmentId, licenseType, pilotName }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'pass' | 'fail'>('idle');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  function reset() {
    setMode('idle');
    setNotes('');
    setReason('');
    setError(null);
  }

  function handlePassConfirm() {
    if (
      !confirm(
        `Prüfung als BESTANDEN markieren?\n\n${pilotName} erhält die ${licenseType}-Lizenz. Diese Aktion kann nicht rückgängig gemacht werden.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await passPracticalExamAction({
          enrollmentId,
          notes: notes.trim() || null,
        });
        router.refresh();
        // reset() nicht nötig — die row verschwindet nach refresh.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleFailConfirm() {
    if (reason.trim().length < 3) {
      setError('Begründung ist erforderlich (mindestens 3 Zeichen).');
      return;
    }
    if (
      !confirm(
        `Prüfung als NICHT BESTANDEN markieren?\n\n${pilotName} kann einen neuen Prüfungsflug zuweisen. Die Begründung wird im Audit-Log gespeichert.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await failPracticalExamAction({
          enrollmentId,
          reason: reason.trim(),
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
      {error && (
        <div className="mb-3 px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* IDLE — zwei buttons nebeneinander */}
      {mode === 'idle' && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setMode('pass')}
            disabled={pending}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
          >
            ✓ Bestanden
          </button>
          <button
            type="button"
            onClick={() => setMode('fail')}
            disabled={pending}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
          >
            ✗ Nicht bestanden
          </button>
        </div>
      )}

      {/* PASS-form — optionale notes */}
      {mode === 'pass' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Notizen (optional, wird in der Lizenz hinterlegt)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="z.B. 'Sehr saubere approaches, präzise navigation'"
              className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              disabled={pending}
            />
            <p className="text-xs text-gray-500 mt-1">
              {notes.length}/500 Zeichen
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handlePassConfirm}
              disabled={pending}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
            >
              {pending ? 'Wird verarbeitet…' : `✓ ${licenseType}-Lizenz ausstellen`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm transition disabled:opacity-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* FAIL-form — required reason */}
      {mode === 'fail' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Begründung <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              minLength={3}
              rows={3}
              required
              placeholder="z.B. 'Approach instabil, zu hoch über threshold; Holding nicht eingehalten'"
              className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-red-500 disabled:opacity-60"
              disabled={pending}
            />
            <p className="text-xs text-gray-500 mt-1">
              {reason.length}/500 Zeichen · wird im Audit-Log gespeichert
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleFailConfirm}
              disabled={pending || reason.trim().length < 3}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
            >
              {pending ? 'Wird verarbeitet…' : '✗ Nicht bestanden bestätigen'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm transition disabled:opacity-50"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
