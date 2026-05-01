'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitAirportRequest } from '@/app/airports/actions';

interface AirportRequestFormProps {
  airlineIcao: string | null;
  airlineName: string | null;
}

interface FormState {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
  elevation: string;
  reason: string;
}

const EMPTY: FormState = {
  icao: '',
  iata: '',
  name: '',
  city: '',
  country: '',
  latitude: '',
  longitude: '',
  elevation: '',
  reason: '',
};

export function AirportRequestForm({
  airlineIcao,
  airlineName,
}: AirportRequestFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side parse — server does the real validation but we want to
    // catch obvious mistakes (non-numeric coords) before hitting the API.
    const lat = parseFloat(form.latitude);
    const lon = parseFloat(form.longitude);
    if (Number.isNaN(lat)) {
      setError('Latitude muss eine Zahl sein (z.B. 50.0379).');
      return;
    }
    if (Number.isNaN(lon)) {
      setError('Longitude muss eine Zahl sein (z.B. 8.5622).');
      return;
    }
    let elevation: number | null = null;
    if (form.elevation.trim()) {
      const e = parseInt(form.elevation, 10);
      if (Number.isNaN(e)) {
        setError('Elevation muss ein Integer sein (oder leer).');
        return;
      }
      elevation = e;
    }

    startTransition(async () => {
      try {
        await submitAirportRequest({
          icao: form.icao,
          iata: form.iata || null,
          name: form.name,
          city: form.city || null,
          country: form.country,
          latitude: lat,
          longitude: lon,
          elevation,
          reason: form.reason || null,
        });
        // Success — redirect to catalog so user sees their submission landed
        router.push('/airports');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6 space-y-4">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Eingereicht als{' '}
          <span className="font-mono font-semibold">
            {airlineIcao ?? '?'}
          </span>{' '}
          ({airlineName ?? 'unknown airline'})
        </div>

        {/* ICAO + IATA */}
        <div className="grid grid-cols-3 gap-3">
          <Field label="ICAO" required>
            <input
              type="text"
              maxLength={4}
              required
              value={form.icao}
              onChange={(e) => update('icao', e.target.value.toUpperCase())}
              placeholder="EDDF"
              className="font-mono uppercase tracking-wider w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="IATA" hint="optional">
            <input
              type="text"
              maxLength={3}
              value={form.iata}
              onChange={(e) => update('iata', e.target.value.toUpperCase())}
              placeholder="FRA"
              className="font-mono uppercase tracking-wider w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        </div>

        {/* Name */}
        <Field label="Name" required>
          <input
            type="text"
            maxLength={100}
            required
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Frankfurt am Main Airport"
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>

        {/* City + Country */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stadt" hint="optional">
            <input
              type="text"
              maxLength={100}
              value={form.city}
              onChange={(e) => update('city', e.target.value)}
              placeholder="Frankfurt"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Land" required>
            <input
              type="text"
              maxLength={100}
              required
              value={form.country}
              onChange={(e) => update('country', e.target.value)}
              placeholder="Germany"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        </div>

        {/* Coords */}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Latitude" required hint="-90 bis 90">
            <input
              type="text"
              required
              value={form.latitude}
              onChange={(e) => update('latitude', e.target.value)}
              placeholder="50.0379"
              className="font-mono w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Longitude" required hint="-180 bis 180">
            <input
              type="text"
              required
              value={form.longitude}
              onChange={(e) => update('longitude', e.target.value)}
              placeholder="8.5622"
              className="font-mono w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Elevation" hint="ft, optional">
            <input
              type="text"
              value={form.elevation}
              onChange={(e) => update('elevation', e.target.value)}
              placeholder="364"
              className="font-mono w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        </div>

        {/* Reason */}
        <Field
          label="Begründung"
          hint="optional, max 500 Zeichen — hilft dem Reviewer"
        >
          <textarea
            maxLength={500}
            rows={3}
            value={form.reason}
            onChange={(e) => update('reason', e.target.value)}
            placeholder="z.B. neue Strecke FRA-IST, oder Charter-Operation"
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </Field>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setForm(EMPTY)}
          disabled={isPending}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-semibold transition disabled:opacity-50"
        >
          {isPending ? 'Sende…' : 'Vorschlag einreichen'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-sm font-medium">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {hint && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {hint}
          </span>
        )}
      </div>
      {children}
    </label>
  );
}
