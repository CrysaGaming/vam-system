'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createFlightSchool,
  updateFlightSchool,
  type FlightSchoolFormInput,
} from './actions';

const ALL_LICENSE_TYPES: { value: FlightSchoolFormInput['offeredLicenses'][number]; label: string }[] = [
  { value: 'SPL', label: 'SPL — Student Pilot' },
  { value: 'PPL', label: 'PPL — Private Pilot' },
  { value: 'NIGHT_RATING', label: 'Night Rating' },
  { value: 'INSTRUMENT_RATING', label: 'IR — Instrument Rating' },
  { value: 'MULTI_ENGINE_RATING', label: 'ME — Multi-Engine' },
  { value: 'CPL', label: 'CPL — Commercial Pilot' },
  { value: 'MCC', label: 'MCC — Multi-Crew' },
  { value: 'ATPL', label: 'ATPL — Airline Transport' },
  { value: 'TRI', label: 'TRI — Type Rating Instructor' },
  { value: 'TRE', label: 'TRE — Type Rating Examiner' },
];

interface Props {
  /**
   * Mode bestimmt welche action gefeuert wird + ob das form initiale
   * werte hat. 'create': leeres form, action=createFlightSchool. 'edit':
   * vorausgefüllt, action=updateFlightSchool, ID als hidden-feld.
   */
  mode: 'create' | 'edit';
  /** Im edit-mode: vorhandene werte. Im create-mode: undefined (defaults). */
  initial?: {
    id: string;
    name: string;
    airportIcao: string;
    rating: number;
    offeredLicenses: FlightSchoolFormInput['offeredLicenses'];
    hourlyRateGround: string;
    hourlyRateAir: string;
    hourlyRateSim: string | null;
    description: string | null;
    logoUrl: string | null;
  };
  /** Optional callback nach success. Default: router.refresh() im create-mode. */
  onSuccess?: () => void;
}

/**
 * Shared create/edit-form für FlightSchool. Wird von der list-page
 * (admin/flight-schools/page.tsx) inline für create benutzt und von
 * der edit-page (admin/flight-schools/[id]/page.tsx) für update.
 *
 * State-architektur: lokaler form-state (kein useFormState weil wir die
 * complex license-checkbox-array-handling brauchen, was über plain form-
 * data nicht idiomatic geht). startTransition für pending-state, custom
 * error-flash bei action-throw.
 *
 * Licenses werden als checkbox-grid gerendert — der admin tickt die
 * angebotenen typen an. Mindestens einer muss ausgewählt sein (zod-check
 * server-seitig + visual-disabled-submit-button client-seitig).
 */
export function FlightSchoolForm({ mode, initial, onSuccess }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [airportIcao, setAirportIcao] = useState(initial?.airportIcao ?? '');
  const [rating, setRating] = useState(initial?.rating?.toString() ?? '4.0');
  const [offeredLicenses, setOfferedLicenses] = useState<
    FlightSchoolFormInput['offeredLicenses']
  >(initial?.offeredLicenses ?? []);
  const [hourlyRateGround, setHourlyRateGround] = useState(
    initial?.hourlyRateGround ?? '',
  );
  const [hourlyRateAir, setHourlyRateAir] = useState(
    initial?.hourlyRateAir ?? '',
  );
  const [hourlyRateSim, setHourlyRateSim] = useState(
    initial?.hourlyRateSim ?? '',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? '');

  function toggleLicense(value: FlightSchoolFormInput['offeredLicenses'][number]) {
    setOfferedLicenses((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const payload: FlightSchoolFormInput = {
      name: name.trim(),
      airportIcao: airportIcao.trim().toUpperCase(),
      rating: parseFloat(rating),
      offeredLicenses,
      hourlyRateGround: hourlyRateGround.trim(),
      hourlyRateAir: hourlyRateAir.trim(),
      hourlyRateSim: hourlyRateSim.trim() || null,
      description: description.trim() || null,
      logoUrl: logoUrl.trim() || null,
    };

    startTransition(async () => {
      try {
        if (mode === 'edit' && initial) {
          await updateFlightSchool({ ...payload, id: initial.id });
        } else {
          await createFlightSchool(payload);
          // Reset form nach create damit admin direkt weiter anlegen kann.
          setName('');
          setAirportIcao('');
          setRating('4.0');
          setOfferedLicenses([]);
          setHourlyRateGround('');
          setHourlyRateAir('');
          setHourlyRateSim('');
          setDescription('');
          setLogoUrl('');
        }
        if (onSuccess) {
          onSuccess();
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  }

  const canSubmit =
    name.trim().length >= 2 &&
    /^[A-Z]{4}$/.test(airportIcao.trim().toUpperCase()) &&
    offeredLicenses.length > 0 &&
    /^\d+(\.\d{1,2})?$/.test(hourlyRateGround.trim()) &&
    /^\d+(\.\d{1,2})?$/.test(hourlyRateAir.trim()) &&
    !pending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            placeholder="z.B. DLR Flugschule Bremen"
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Airport ICAO
          </label>
          <input
            type="text"
            value={airportIcao}
            onChange={(e) => setAirportIcao(e.target.value.toUpperCase())}
            required
            pattern="[A-Z]{4}"
            placeholder="EDDF"
            maxLength={4}
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase focus:outline-none focus:border-indigo-500"
          />
          <p className="text-xs text-gray-500 mt-0.5">
            Muss bereits in Airport-Verwaltung existieren.
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1.5">
          Angebotene Lizenzen ({offeredLicenses.length} ausgewählt)
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {ALL_LICENSE_TYPES.map((t) => (
            <label
              key={t.value}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer text-xs transition ${
                offeredLicenses.includes(t.value)
                  ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                  : 'bg-white dark:bg-gray-950 border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={offeredLicenses.includes(t.value)}
                onChange={() => toggleLicense(t.value)}
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-700"
              />
              <span className="truncate">{t.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Tarif Theorie (VAM$/h)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={hourlyRateGround}
            onChange={(e) => setHourlyRateGround(e.target.value)}
            required
            pattern="\d+(\.\d{1,2})?"
            placeholder="150"
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Tarif Flug (VAM$/h)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={hourlyRateAir}
            onChange={(e) => setHourlyRateAir(e.target.value)}
            required
            pattern="\d+(\.\d{1,2})?"
            placeholder="350"
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Tarif Sim (optional)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={hourlyRateSim}
            onChange={(e) => setHourlyRateSim(e.target.value)}
            pattern="\d+(\.\d{1,2})?"
            placeholder="200"
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Rating (0–5)
          </label>
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Logo-URL (optional)
          </label>
          <input
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            maxLength={500}
            placeholder="https://..."
            className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
          Beschreibung (optional, Markdown)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="z.B. Etablierte EASA-Flugschule mit modernem Trainingscenter…"
          className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500 resize-y"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending
            ? mode === 'edit'
              ? 'Speichern…'
              : 'Anlegen…'
            : mode === 'edit'
              ? 'Änderungen speichern'
              : 'FlightSchool anlegen'}
        </button>
      </div>
    </form>
  );
}
