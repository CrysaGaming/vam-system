'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateAirlineSimBriefOverlay } from './actions';
import {
  SECTIONS,
  overlayToFormValues,
  formValuesToOverlay,
} from './_overlay-fields';
import type { SimBriefOverlay } from '@/lib/simbrief/overlay';

interface Props {
  initial: SimBriefOverlay;
}

export function AirlineOverlayCard({ initial }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    overlayToFormValues(initial),
  );
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; msg: string }[]>([]);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const setField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Reset feedback on edit so stale banners don't linger
    if (success) setSuccess(false);
    if (error) setError(null);
    if (issues.length > 0) setIssues([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIssues([]);
    setSuccess(false);

    const overlay = formValuesToOverlay(values);

    startTransition(async () => {
      const result = await updateAirlineSimBriefOverlay(overlay);
      if (result.success) {
        setSuccess(true);
        // Refresh server-component data so any other Sections relying
        // on the airline state see the new values
        router.refresh();
      } else {
        if (result.error === 'unauthorized')
          setError('Nicht angemeldet — Seite neu laden.');
        else if (result.error === 'no_airline')
          setError('Du bist keiner Airline zugeordnet. Frag den Admin.');
        else if (result.error === 'invalid_input') {
          setError('Mindestens ein Feld hat einen ungültigen Wert.');
          setIssues(
            (result.issues ?? []).map((i) => ({
              path: i.path.join('.'),
              msg: i.message,
            })),
          );
        } else {
          setError(result.error);
        }
      }
    });
  };

  const handleReset = () => {
    if (
      !confirm(
        'Alle Airline-Overrides löschen? Routen-Overrides (Ebene 4) bleiben unberührt.',
      )
    )
      return;
    setValues(overlayToFormValues({}));
  };

  // Count populated fields for the header summary
  const populatedCount = Object.values(values).filter((v) => v !== '').length;

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold">SimBrief Override (Airline)</h3>
        <span className="text-xs text-gray-500 mt-1">
          {populatedCount} {populatedCount === 1 ? 'Override' : 'Overrides'} aktiv
        </span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Ebene 1 der 4-stufigen Override-Hierarchie. Wird bei jedem SimBrief-
        Dispatch als Floor verwendet und durch Fleet (Ebene 2), Aircraft
        (Ebene 3) oder Route (Ebene 4) überschrieben. Leere Felder = keine
        Vorgabe, SimBrief-Account-Defaults greifen.
      </p>

      {success && (
        <div className="mb-4 px-3 py-2 rounded border bg-green-500/10 border-green-500/30 text-green-300 text-sm">
          Gespeichert.
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-300 text-sm">
          {error}
          {issues.length > 0 && (
            <ul className="mt-2 ml-4 list-disc text-xs">
              {issues.map((i, idx) => (
                <li key={idx}>
                  <code>{i.path}</code>: {i.msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <fieldset key={section.title} className="border-t border-gray-200 dark:border-gray-800 pt-4">
            <legend className="text-xs uppercase tracking-wider text-gray-500 mb-1 px-2 -ml-2">
              {section.title}
            </legend>
            <p className="text-xs text-gray-500 mb-4">{section.description}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {section.fields.map((f) => (
                <div key={f.key as string}>
                  <label className="block text-sm font-medium mb-1">
                    {f.label}
                  </label>
                  {f.type === 'select' ? (
                    <select
                      value={values[f.key as string] ?? ''}
                      onChange={(e) => setField(f.key as string, e.target.value)}
                      className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                      disabled={isPending}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      value={values[f.key as string] ?? ''}
                      onChange={(e) =>
                        setField(f.key as string, e.target.value)
                      }
                      placeholder={
                        'placeholder' in f ? f.placeholder : undefined
                      }
                      min={f.type === 'number' ? f.min : undefined}
                      max={f.type === 'number' ? f.max : undefined}
                      step={f.type === 'number' ? f.step : undefined}
                      className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                      disabled={isPending}
                    />
                  )}
                  {f.hint && (
                    <p className="text-xs text-gray-500 mt-1">{f.hint}</p>
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={handleReset}
          disabled={isPending || populatedCount === 0}
          className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-400 disabled:opacity-30 disabled:hover:text-gray-500 dark:text-gray-400 transition"
        >
          Alle löschen
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isPending ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
