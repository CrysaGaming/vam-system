'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateAirlineSimBriefOverlay } from './actions';
import type { SimBriefOverlay } from '@/lib/simbrief/overlay';

interface Props {
  initial: SimBriefOverlay;
}

/**
 * Field configuration drives the form layout. Adding a new SimBrief
 * parameter to `SimBriefOverlaySchema` requires:
 *
 *   1. Add the Zod field in apps/web/lib/simbrief/overlay.ts
 *   2. Append a row to `FIELDS` below
 *
 * No other touch points — the form auto-renders the new control,
 * the action validates via the same schema, and the dispatch
 * pipeline applies it through `overlayToParams`.
 *
 * Field types:
 *   - 'number'  → <input type="number">, parsed to int (or float if step<1)
 *   - 'text'    → <input type="text">, kept as string
 *   - 'select'  → <select> with options, value matched literally
 *
 * Empty inputs are stripped at submit time (no key in the JSON),
 * which equals "no override at this level" — different from
 * `0` or `'kgs'` which are explicit values.
 */
type FieldDef =
  | {
      key: keyof SimBriefOverlay;
      label: string;
      hint?: string;
      type: 'number';
      min?: number;
      max?: number;
      step?: number;
      placeholder?: string;
    }
  | {
      key: keyof SimBriefOverlay;
      label: string;
      hint?: string;
      type: 'text';
      placeholder?: string;
    }
  | {
      key: keyof SimBriefOverlay;
      label: string;
      hint?: string;
      type: 'select';
      options: { value: string; label: string }[];
    };

interface Section {
  title: string;
  description: string;
  fields: FieldDef[];
}

const SECTIONS: Section[] = [
  {
    title: 'Output',
    description: 'Wie SimBrief das OFP rendert.',
    fields: [
      {
        key: 'ofp_layout',
        label: 'OFP Layout',
        hint: 'z. B. LIDO, ATPL, CFP. Leer = SimBrief default.',
        type: 'text',
        placeholder: 'auto',
      },
      {
        key: 'pounds',
        label: 'Anzeige-Einheit',
        hint: 'Auto = SimBrief Account-Einstellung (kann zwischen Requests springen).',
        type: 'select',
        options: [
          { value: '', label: 'Auto (SimBrief default)' },
          { value: '0', label: 'Kilogramm (kg)' },
          { value: '1', label: 'Pfund (lbs)' },
        ],
      },
    ],
  },
  {
    title: 'Pax / Cargo',
    description: 'Beladung. Leer = SimBrief leitet aus aircraft type ab.',
    fields: [
      {
        key: 'pax',
        label: 'Passagiere',
        hint: 'Anzahl. A320 typ. ~123, A359 ~325.',
        type: 'number',
        min: 0,
        max: 999,
        placeholder: 'auto',
      },
      {
        key: 'cargo',
        label: 'Cargo (kg)',
        type: 'number',
        min: 0,
        max: 999999,
        placeholder: 'auto',
      },
      {
        key: 'manualpayload',
        label: 'Manuelle Payload (kg)',
        hint: 'Überschreibt pax-derived Berechnung komplett.',
        type: 'number',
        min: 0,
        max: 999999,
        placeholder: 'auto',
      },
      {
        key: 'manualzfw',
        label: 'Manuelles ZFW (kg)',
        type: 'number',
        min: 0,
        max: 999999,
        placeholder: 'auto',
      },
    ],
  },
  {
    title: 'Fuel',
    description: 'Treibstoff-Policy. Leer = aircraft perf-default.',
    fields: [
      {
        key: 'contpct',
        label: 'Contingency (%)',
        hint: 'ICAO empfiehlt min. 5%.',
        type: 'number',
        min: 0,
        max: 99,
        step: 1,
        placeholder: 'auto',
      },
      {
        key: 'resvrule',
        label: 'Reserve Rule',
        hint: 'auto, @FAR, I50, D45, F30, oder Minuten-Zahl.',
        type: 'text',
        placeholder: 'auto',
      },
      {
        key: 'melfuel',
        label: 'MEL/CDL Fuel',
        type: 'number',
        min: 0,
        max: 99999,
        placeholder: 'auto',
      },
      {
        key: 'melfuel_units',
        label: 'MEL/CDL Einheit',
        type: 'select',
        options: [
          { value: '', label: 'Default' },
          { value: 'kgs', label: 'kg' },
          { value: 'lbs', label: 'lbs' },
        ],
      },
      {
        key: 'atcfuel',
        label: 'ATC Fuel (Min.)',
        hint: 'Immer in Minuten.',
        type: 'number',
        min: 0,
        max: 999,
        placeholder: 'auto',
      },
      {
        key: 'addedfuel',
        label: 'Extra Fuel',
        hint: 'Operational discretion.',
        type: 'number',
        min: 0,
        max: 99999,
        placeholder: 'auto',
      },
      {
        key: 'addedfuel_units',
        label: 'Extra Fuel Einheit',
        type: 'select',
        options: [
          { value: '', label: 'Default' },
          { value: 'kgs', label: 'kg' },
          { value: 'lbs', label: 'lbs' },
        ],
      },
      {
        key: 'tankering',
        label: 'Tankering',
        type: 'select',
        options: [
          { value: '', label: 'Default' },
          { value: '0', label: 'Aus' },
          { value: '1', label: 'An' },
        ],
      },
      {
        key: 'taxiout',
        label: 'Taxi-out (Min.)',
        hint: 'SimBrief default 20.',
        type: 'number',
        min: 0,
        max: 999,
        placeholder: '20',
      },
      {
        key: 'taxiin',
        label: 'Taxi-in (Min.)',
        hint: 'SimBrief default 8.',
        type: 'number',
        min: 0,
        max: 999,
        placeholder: '8',
      },
      {
        key: 'taxifuel',
        label: 'Total Taxi Fuel (kg)',
        hint: '0 = use taxiout+taxiin defaults.',
        type: 'number',
        min: 0,
        max: 99999,
        placeholder: 'auto',
      },
      {
        key: 'fuelfactor',
        label: 'Fuel Factor',
        hint: '1.0 = nominal, 1.05 = +5%. Range 0.5–2.0.',
        type: 'number',
        min: 0.5,
        max: 2.0,
        step: 0.01,
        placeholder: '1.00',
      },
    ],
  },
  {
    title: 'Routing',
    description: 'Routen-Vorgaben. Werden meist per-Route gesetzt, hier nur als Airline-floor.',
    fields: [
      {
        key: 'altn',
        label: 'Standard-Alternate (ICAO)',
        hint: 'Genau 4 Buchstaben.',
        type: 'text',
        placeholder: 'auto',
      },
      {
        key: 'fl',
        label: 'Cruise FL',
        hint: 'z. B. 350 für FL350. 0 = auto.',
        type: 'number',
        min: 0,
        max: 50000,
        placeholder: 'auto',
      },
      {
        key: 'route',
        label: 'Custom Route',
        hint: 'Leer = SimBrief auto-routes.',
        type: 'text',
        placeholder: 'auto',
      },
      {
        key: 'origrwy',
        label: 'Departure RWY',
        type: 'text',
        placeholder: 'auto',
      },
      {
        key: 'destrwy',
        label: 'Arrival RWY',
        type: 'text',
        placeholder: 'auto',
      },
    ],
  },
];

/**
 * Convert an initial typed overlay to string-form values for the
 * form's controlled inputs. Numbers become their string repr,
 * strings stay as-is, undefined becomes empty string.
 */
function overlayToFormValues(overlay: SimBriefOverlay): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sec of SECTIONS) {
    for (const f of sec.fields) {
      const v = overlay[f.key];
      out[f.key as string] = v === undefined || v === null ? '' : String(v);
    }
  }
  return out;
}

/**
 * Convert form string values back to a typed SimBriefOverlay,
 * stripping empty strings (= "not set"). Number-typed fields
 * are parsed via Number(); the server-side Zod schema is the
 * final authority on validation, so we pass through whatever
 * we have and let the action surface issues if any.
 */
function formValuesToOverlay(
  values: Record<string, string>,
): SimBriefOverlay {
  const out: Record<string, unknown> = {};
  for (const sec of SECTIONS) {
    for (const f of sec.fields) {
      const raw = values[f.key as string];
      if (raw === undefined || raw === '') continue;
      if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isNaN(n)) out[f.key as string] = n;
      } else if (f.type === 'select') {
        // Toggle/enum fields: pounds + tankering use 0/1, units use kgs/lbs
        if (raw === '0') out[f.key as string] = 0;
        else if (raw === '1') out[f.key as string] = 1;
        else out[f.key as string] = raw;
      } else {
        out[f.key as string] = raw;
      }
    }
  }
  return out as SimBriefOverlay;
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
          setError(
            'Du bist keiner Airline zugeordnet. Frag den Admin.',
          );
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
      className="bg-gray-900 border border-gray-800 rounded-lg p-6"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold">SimBrief Override (Airline)</h3>
        <span className="text-xs text-gray-500 mt-1">
          {populatedCount} {populatedCount === 1 ? 'Override' : 'Overrides'} aktiv
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-6">
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
          <fieldset key={section.title} className="border-t border-gray-800 pt-4">
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
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
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
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
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

      <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-800">
        <button
          type="button"
          onClick={handleReset}
          disabled={isPending || populatedCount === 0}
          className="px-3 py-2 text-sm text-gray-400 hover:text-red-400 disabled:opacity-30 disabled:hover:text-gray-400 transition"
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
