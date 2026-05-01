'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitAircraftTypeRequest } from '@/app/aircraft-types/actions';

interface AircraftTypeRequestFormProps {
  airlineIcao: string | null;
  airlineName: string | null;
}

interface FormState {
  icaoType: string;
  name: string;
  manufacturer: string;
  category: 'narrow_body' | 'wide_body' | 'regional' | 'cargo' | 'ga';
  rangeNm: string;
  capacityPax: string;
  cruiseSpeedKt: string;
  fuelBurnKgH: string;
  imageUrl: string;
  reason: string;
}

const EMPTY: FormState = {
  icaoType: '',
  name: '',
  manufacturer: '',
  category: 'narrow_body',
  rangeNm: '',
  capacityPax: '',
  cruiseSpeedKt: '',
  fuelBurnKgH: '',
  imageUrl: '',
  reason: '',
};

const CATEGORY_OPTIONS: { value: FormState['category']; label: string }[] = [
  { value: 'narrow_body', label: 'Narrow-Body (z.B. A320, B738)' },
  { value: 'wide_body', label: 'Wide-Body (z.B. A350, B789)' },
  { value: 'regional', label: 'Regional (z.B. CRJ, E170)' },
  { value: 'cargo', label: 'Cargo (z.B. B748F, A332F)' },
  { value: 'ga', label: 'General Aviation (z.B. C172, PA28)' },
];

export function AircraftTypeRequestForm({
  airlineIcao,
  airlineName,
}: AircraftTypeRequestFormProps) {
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
    // catch obvious mistakes (non-numeric ints) before hitting the API.
    const parseInt2 = (v: string, label: string): number | null => {
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) {
        setError(`${label} muss ein Integer sein.`);
        return null;
      }
      return n;
    };

    const rangeNm = parseInt2(form.rangeNm, 'Range');
    if (rangeNm === null) return;
    const capacityPax = parseInt2(form.capacityPax, 'Capacity');
    if (capacityPax === null) return;
    const cruiseSpeedKt = parseInt2(form.cruiseSpeedKt, 'Cruise Speed');
    if (cruiseSpeedKt === null) return;
    const fuelBurnKgH = parseInt2(form.fuelBurnKgH, 'Fuel Burn');
    if (fuelBurnKgH === null) return;

    startTransition(async () => {
      try {
        await submitAircraftTypeRequest({
          icaoType: form.icaoType,
          name: form.name,
          manufacturer: form.manufacturer,
          category: form.category,
          rangeNm,
          capacityPax,
          cruiseSpeedKt,
          fuelBurnKgH,
          imageUrl: form.imageUrl || null,
          reason: form.reason || null,
        });
        router.push('/aircraft-types');
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

        {/* ICAO-Type + Manufacturer + Category */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="ICAO-Type" required hint="2-4 Zeichen">
            <input
              type="text"
              maxLength={4}
              required
              value={form.icaoType}
              onChange={(e) => update('icaoType', e.target.value.toUpperCase())}
              placeholder="B738"
              className="font-mono uppercase tracking-wider w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Hersteller" required>
            <input
              type="text"
              maxLength={50}
              required
              value={form.manufacturer}
              onChange={(e) => update('manufacturer', e.target.value)}
              placeholder="Boeing"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        </div>

        <Field label="Name / Modell" required>
          <input
            type="text"
            maxLength={100}
            required
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Boeing 737-800"
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>

        <Field label="Kategorie" required>
          <select
            value={form.category}
            onChange={(e) =>
              update('category', e.target.value as FormState['category'])
            }
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Performance: Range, Pax, Speed */}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Range" required hint="nm, max 20000">
            <input
              type="text"
              required
              value={form.rangeNm}
              onChange={(e) => update('rangeNm', e.target.value)}
              placeholder="3060"
              className="font-mono w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Capacity" required hint="Pax, max 900">
            <input
              type="text"
              required
              value={form.capacityPax}
              onChange={(e) => update('capacityPax', e.target.value)}
              placeholder="189"
              className="font-mono w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Cruise Speed" required hint="Knoten, 50-700">
            <input
              type="text"
              required
              value={form.cruiseSpeedKt}
              onChange={(e) => update('cruiseSpeedKt', e.target.value)}
              placeholder="453"
              className="font-mono w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        </div>

        {/* Fuel + ImageUrl */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fuel Burn" required hint="kg/h">
            <input
              type="text"
              required
              value={form.fuelBurnKgH}
              onChange={(e) => update('fuelBurnKgH', e.target.value)}
              placeholder="2500"
              className="font-mono w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Image URL" hint="optional, https://…">
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => update('imageUrl', e.target.value)}
              placeholder="https://example.com/b738.jpg"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            placeholder="z.B. Fleet-erweiterung um Boeing 737 NG"
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
