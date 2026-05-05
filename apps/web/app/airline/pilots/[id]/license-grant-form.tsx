'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminGrantLicense,
  adminGrantTypeRating,
} from './actions';

const LICENSE_TYPES = [
  { value: 'SPL', label: 'SPL — Student Pilot License' },
  { value: 'PPL', label: 'PPL — Private Pilot License' },
  { value: 'NIGHT_RATING', label: 'Night Rating' },
  { value: 'INSTRUMENT_RATING', label: 'IR — Instrument Rating' },
  { value: 'MULTI_ENGINE_RATING', label: 'ME — Multi-Engine Rating' },
  { value: 'CPL', label: 'CPL — Commercial Pilot License' },
  { value: 'MCC', label: 'MCC — Multi-Crew Cooperation' },
  { value: 'ATPL', label: 'ATPL — Airline Transport Pilot License' },
  { value: 'TRI', label: 'TRI — Type Rating Instructor' },
  { value: 'TRE', label: 'TRE — Type Rating Examiner' },
] as const;

interface Props {
  userId: string;
  /** Existing license-types of this user. Used to disable already-granted
   *  options in the dropdown so the admin doesn't trigger the P2002. */
  existingLicenseTypes: string[];
  /** Existing type-rating aircraft-types. Used to soft-warn admin if he
   *  tries to grant a duplicate type-rating. */
  existingTypeRatings: string[];
}

/**
 * Welle 13E-6 — combined grant-form for licenses + type-ratings.
 *
 * Two tabs: "Lizenz vergeben" und "Type-Rating vergeben". Der admin
 * wechselt per radio-button welchen er erstellen will. Beide forms
 * nutzen dieselben fields (expiresAt + notes) plus type-spezifischen
 * dropdown/input.
 *
 * Optimistic feedback: form bleibt offen mit success-message und reset-
 * den-state, damit admin schnell mehrere licenses am stück vergeben
 * kann (typischer use-case nach abgeschlossenem training-block).
 */
export function LicenseGrantForm({ userId, existingLicenseTypes, existingTypeRatings }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<'license' | 'type-rating'>('license');

  // Form-state per mode. Wir halten beide states gleichzeitig damit ein
  // mode-switch keinen kontext verliert.
  const [licenseType, setLicenseType] = useState<string>('PPL');
  const [aircraftType, setAircraftType] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        if (mode === 'license') {
          if (existingLicenseTypes.includes(licenseType)) {
            setError(
              `Pilot hat bereits eine ${licenseType}-Lizenz. Bestehende widerrufen oder verlängern statt neu vergeben.`,
            );
            return;
          }
          await adminGrantLicense({
            userId,
            // The discriminated union keeps types of LICENSE_TYPES as the
            // canonical literal-set, but the form-state is plain string. We
            // narrow to LicenseType in the action via z.enum.
            type: licenseType as (typeof LICENSE_TYPES)[number]['value'],
            expiresAt: expiresAt || null,
            notes: notes || null,
          });
          setSuccess(`Lizenz ${licenseType} ausgestellt.`);
        } else {
          const normalizedType = aircraftType.trim().toUpperCase();
          if (!/^[A-Z0-9]{2,8}$/.test(normalizedType)) {
            setError(
              'ICAO-Typ ungültig. Format: 2-8 Großbuchstaben/Ziffern (z.B. A320, B738).',
            );
            return;
          }
          if (existingTypeRatings.includes(normalizedType)) {
            setError(
              `Pilot hat bereits ein Type-Rating für ${normalizedType}. Verlängern statt neu vergeben.`,
            );
            return;
          }
          await adminGrantTypeRating({
            userId,
            aircraftType: normalizedType,
            expiresAt: expiresAt || null,
            notes: notes || null,
          });
          setSuccess(`Type-Rating ${normalizedType} ausgestellt.`);
          setAircraftType('');
        }

        // Reset notes nach erfolg (häufigster usecase: leere notes für
        // standard-grants), behalte license-type/expires damit batch-
        // grants schneller gehen.
        setNotes('');
        router.refresh();
        // Auto-clear nach 5s
        setTimeout(() => setSuccess(null), 5000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
      <h3 className="text-base font-semibold mb-3">Neue Qualifikation vergeben</h3>

      {/* Mode-toggle. Radio-style buttons statt tabs weil's nur 2 sind und
          die selection visuell sehr schnell zu erfassen sein muss — admin
          will nicht durch tab-clicks navigieren. */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode('license')}
          className={`flex-1 px-3 py-2 text-sm rounded border transition ${
            mode === 'license'
              ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 text-indigo-700 dark:text-indigo-300'
              : 'bg-gray-50 dark:bg-gray-950 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          📜 Lizenz
        </button>
        <button
          type="button"
          onClick={() => setMode('type-rating')}
          className={`flex-1 px-3 py-2 text-sm rounded border transition ${
            mode === 'type-rating'
              ? 'bg-purple-50 dark:bg-purple-500/10 border-purple-500 text-purple-700 dark:text-purple-300'
              : 'bg-gray-50 dark:bg-gray-950 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          🎯 Type-Rating
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-3 px-3 py-2 rounded border bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300 text-xs">
          ✓ {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'license' ? (
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Lizenz-Typ
            </label>
            <select
              value={licenseType}
              onChange={(e) => setLicenseType(e.target.value)}
              disabled={pending}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-60"
            >
              {LICENSE_TYPES.map((t) => {
                const alreadyHas = existingLicenseTypes.includes(t.value);
                return (
                  <option key={t.value} value={t.value} disabled={alreadyHas}>
                    {t.label}
                    {alreadyHas ? ' (bereits vorhanden)' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              ICAO-Typ
            </label>
            <input
              type="text"
              value={aircraftType}
              onChange={(e) => setAircraftType(e.target.value.toUpperCase())}
              disabled={pending}
              required
              minLength={2}
              maxLength={8}
              pattern="[A-Z0-9]+"
              placeholder="z.B. A320, B738, C172"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono focus:border-indigo-500 outline-none disabled:opacity-60"
            />
            <p className="text-xs text-gray-500 mt-1">
              4-stelliger ICAO-Aircraft-Type-Code. Default-expiry: 12 Monate
              ab heute (überschreibbar unten).
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Gültig bis (optional)
          </label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={pending}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-60"
          />
          <p className="text-xs text-gray-500 mt-1">
            {mode === 'license'
              ? 'Leer lassen = ohne Ablaufdatum (z.B. PPL gilt lifetime).'
              : 'Leer lassen = default 12 Monate ab heute (recurrent-zyklus).'}
          </p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Notizen (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={pending}
            maxLength={500}
            rows={2}
            placeholder='z.B. "ausgestellt nach DLR-prüfung 04/2026"'
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none disabled:opacity-60 resize-y"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending
            ? 'Speichern…'
            : mode === 'license'
              ? 'Lizenz vergeben'
              : 'Type-Rating vergeben'}
        </button>
      </form>
    </div>
  );
}
