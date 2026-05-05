'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminGrantLicense,
  adminRevokeLicense,
  adminSuspendLicense,
  adminReinstateLicense,
} from './actions';

const LICENSE_TYPES = [
  { value: 'SPL', label: 'SPL — Student Pilot' },
  { value: 'PPL', label: 'PPL — Private Pilot' },
  { value: 'NIGHT_RATING', label: 'Night Rating' },
  { value: 'INSTRUMENT_RATING', label: 'IR — Instrument Rating' },
  { value: 'MULTI_ENGINE_RATING', label: 'ME — Multi Engine Rating' },
  { value: 'CPL', label: 'CPL — Commercial Pilot' },
  { value: 'MCC', label: 'MCC — Multi Crew Cooperation' },
  { value: 'ATPL', label: 'ATPL — Airline Transport Pilot' },
  { value: 'TRI', label: 'TRI — Type Rating Instructor' },
  { value: 'TRE', label: 'TRE — Type Rating Examiner' },
] as const;

type LicenseTypeValue = (typeof LICENSE_TYPES)[number]['value'];

/**
 * Welle 13E-6 — License-grant form (admin perspective).
 *
 * Fields:
 *   - type-select: 10 license-typen aus dem enum
 *   - expiresAt: datetime-local, optional (leer = lifetime)
 *   - notes: textarea, optional
 *
 * Auf submit: server-action `adminGrantLicense`. Bei P2002-error
 * (license dieses typs existiert schon) zeigt der server-action eine
 * deutsche fehler-message zurück, die wir hier anzeigen.
 *
 * Form wird auf success zurückgesetzt damit der admin direkt eine weitere
 * license vergeben kann (häufiger workflow: pilot kommt frisch von der
 * flugschule, kriegt PPL+NR+IR auf einen schlag).
 */
export function LicenseGrantForm({ userId }: { userId: string }) {
  const [type, setType] = useState<LicenseTypeValue>('PPL');
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

    startTransition(async () => {
      try {
        await adminGrantLicense({
          userId,
          type,
          expiresAt: expiresAt || null,
          notes: notes.trim() || null,
        });
        // Reset form (außer type — admin könnte ähnliche grants in folge
        // machen, aber expiresAt+notes sind wahrscheinlich anders).
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
      <h3 className="text-sm font-semibold">Neue Lizenz vergeben</h3>

      {error && (
        <div className="px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="px-3 py-2 rounded border bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300 text-xs">
          ✓ Lizenz erfolgreich vergeben
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Lizenz-Typ
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as LicenseTypeValue)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          >
            {LICENSE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
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
          <p className="text-xs text-gray-500 mt-1">Leer = Lifetime</p>
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
          placeholder="z. B. ausgestellt nach erfolgreichem checkride 04.05.2026"
          className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none resize-y"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition disabled:opacity-50"
      >
        {pending ? 'Vergebe…' : 'Lizenz vergeben'}
      </button>
    </form>
  );
}

/**
 * Inline action-buttons pro license-row. Buttons abhängig vom status:
 *   - ACTIVE       → [Suspendieren] [Widerrufen]
 *   - SUSPENDED    → [Reaktivieren] [Widerrufen]
 *   - EXPIRED      → [Reaktivieren] (renewal nach recurrent)
 *   - REVOKED      → [Reaktivieren] (rare admin-override)
 *
 * Confirm-prompts: alle destructive actions (Widerrufen, Suspendieren)
 * fragen via window.confirm + reason-prompt. Reaktivieren ist non-
 * destructive aber fragt trotzdem nach optional-reason für audit-trail.
 *
 * Reason ist required (min 3 zeichen) bei revoke/suspend — siehe schema
 * in actions.ts. Wir validieren clientseitig + server prüft erneut.
 */
export function LicenseRowActions({
  licenseId,
  userId,
  status,
}: {
  licenseId: string;
  userId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'SUSPENDED';
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleRevoke() {
    const reason = window.prompt(
      'Grund für Widerruf (min. 3 zeichen, wird im audit-trail gespeichert):',
    );
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) {
        setError('Grund muss mindestens 3 zeichen lang sein.');
      }
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await adminRevokeLicense({ licenseId, userId, reason: reason.trim() });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fehler');
      }
    });
  }

  function handleSuspend() {
    const reason = window.prompt(
      'Grund für Suspendierung (min. 3 zeichen). Pilot kann die license später wieder reaktivieren.',
    );
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) {
        setError('Grund muss mindestens 3 zeichen lang sein.');
      }
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await adminSuspendLicense({ licenseId, userId, reason: reason.trim() });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fehler');
      }
    });
  }

  function handleReinstate() {
    const reason = window.prompt(
      'Optional: Grund für Reaktivierung (für audit-trail).',
    );
    // Reason ist optional — null = cancel, leerer string = OK ohne reason.
    if (reason === null) return;
    setError(null);
    startTransition(async () => {
      try {
        await adminReinstateLicense({
          licenseId,
          userId,
          reason: reason.trim() || null,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fehler');
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {status === 'ACTIVE' && (
        <>
          <button
            type="button"
            onClick={handleSuspend}
            disabled={pending}
            className="px-2 py-1 text-xs rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 transition disabled:opacity-50"
          >
            Suspendieren
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={pending}
            className="px-2 py-1 text-xs rounded bg-red-500/15 hover:bg-red-500/25 text-red-700 dark:text-red-300 transition disabled:opacity-50"
          >
            Widerrufen
          </button>
        </>
      )}
      {status === 'SUSPENDED' && (
        <>
          <button
            type="button"
            onClick={handleReinstate}
            disabled={pending}
            className="px-2 py-1 text-xs rounded bg-green-500/15 hover:bg-green-500/25 text-green-700 dark:text-green-300 transition disabled:opacity-50"
          >
            Reaktivieren
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={pending}
            className="px-2 py-1 text-xs rounded bg-red-500/15 hover:bg-red-500/25 text-red-700 dark:text-red-300 transition disabled:opacity-50"
          >
            Widerrufen
          </button>
        </>
      )}
      {(status === 'EXPIRED' || status === 'REVOKED') && (
        <button
          type="button"
          onClick={handleReinstate}
          disabled={pending}
          className="px-2 py-1 text-xs rounded bg-green-500/15 hover:bg-green-500/25 text-green-700 dark:text-green-300 transition disabled:opacity-50"
        >
          Reaktivieren
        </button>
      )}
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
