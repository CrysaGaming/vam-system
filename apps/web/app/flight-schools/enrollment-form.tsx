'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { enrollInFlightSchool } from './actions';
import type { LicenseType } from '@vam/db';

interface Props {
  schoolId: string;
  /** License-typen die diese schule anbietet UND der pilot noch nicht hat. */
  availableLicenseTypes: LicenseType[];
}

const LICENSE_LABELS: Record<LicenseType, string> = {
  SPL: 'SPL — Student Pilot License',
  PPL: 'PPL — Private Pilot License',
  NIGHT_RATING: 'Night Rating (VFR-Nacht)',
  INSTRUMENT_RATING: 'IR — Instrument Rating',
  MULTI_ENGINE_RATING: 'ME — Multi-Engine Rating',
  CPL: 'CPL — Commercial Pilot License',
  MCC: 'MCC — Multi-Crew Cooperation',
  ATPL: 'ATPL — Airline Transport Pilot License',
  TRI: 'TRI — Type Rating Instructor',
  TRE: 'TRE — Type Rating Examiner',
};

/**
 * Enrollment-form: pilot wählt einen license-typ und schreibt sich ein
 * (Welle 13E-12). Nach success → router.refresh; die page rendert dann
 * den running-enrollment-block statt der enrollment-form.
 *
 * UX: dropdown statt radio-grid weil typischer use-case 1-2 wählbare
 * licenses sind (alle die der pilot noch braucht UND die schule
 * anbietet). availableLicenseTypes wird server-side berechnet:
 *   schule.offeredLicenses ∩ NOT(pilot.activeLicenses)
 *
 * Wenn availableLicenseTypes leer ist: pilot hat alle angebotenen
 * licenses schon — dann rendert die parent-page ein info-banner statt
 * dieser form.
 */
export function EnrollmentForm({ schoolId, availableLicenseTypes }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [licenseType, setLicenseType] = useState<LicenseType>(
    availableLicenseTypes[0] ?? 'PPL',
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await enrollInFlightSchool({ schoolId, licenseType });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
          Lizenz auswählen
        </label>
        <select
          value={licenseType}
          onChange={(e) => setLicenseType(e.target.value as LicenseType)}
          disabled={pending}
          className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-60"
        >
          {availableLicenseTypes.map((t) => (
            <option key={t} value={t}>
              {LICENSE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Beim Einschreiben wird kein Geld abgebucht. Du zahlst pro Trainings-
        Stunden-Block (Theorie / Flug / Sim) — siehe Tarife oben.
      </p>

      <button
        type="submit"
        disabled={pending || availableLicenseTypes.length === 0}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Einschreiben…' : 'Einschreiben'}
      </button>
    </form>
  );
}
