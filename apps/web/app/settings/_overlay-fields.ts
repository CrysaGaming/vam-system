import type { SimBriefOverlay } from '@/lib/simbrief/overlay';

/**
 * Shared field-config for SimBrief overlay forms across all four
 * hierarchy levels (Airline, Fleet, Aircraft, Route). Adding a
 * new SimBrief parameter to `SimBriefOverlaySchema` requires:
 *
 *   1. Add the Zod field in apps/web/lib/simbrief/overlay.ts
 *   2. Append a row to `SECTIONS` below
 *
 * No other touch points — every overlay-card auto-renders the new
 * control, the actions validate via the same schema, and the
 * dispatch pipeline applies it through `overlayToParams`.
 *
 * Field types:
 *   - 'number'  → <input type="number">
 *   - 'text'    → <input type="text">
 *   - 'select'  → shadcn <Select> with options. Auto/default options
 *                 keep `value: ''` here; the cards map to/from a
 *                 sentinel via toSelectValue/fromSelectValue (siehe
 *                 unten) weil Radix-Select kein leerer string als
 *                 item-value akzeptiert.
 *
 * Empty inputs are stripped at submit time (no key in the JSON),
 * which equals "no override at this level" — different from
 * `0` or `'kgs'` which are explicit values.
 */
export type FieldDef =
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

export interface Section {
  title: string;
  description: string;
  fields: FieldDef[];
}

export const SECTIONS: Section[] = [
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
    description: 'Routen-Vorgaben. Werden meist per-Route gesetzt, hier nur als Floor.',
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
 * Sentinel-value für shadcn-Select bei "Auto/Default" options. Radix-
 * Select reserviert intern den leeren string und akzeptiert ihn nicht
 * als Item-value. Unsere Form-data nutzt aber `''` als "kein override"
 * marker (siehe formValuesToOverlay — strippt empty strings raus).
 *
 * Lösung: am UI-layer mappen wir form '' ↔ select '__auto__'. Die
 * options-arrays in SECTIONS behalten `value: ''` als kanonisches
 * format; die card-components mappen via toSelectValue/fromSelectValue
 * beim rendern.
 *
 * Warum nicht direkt die options auf '__auto__' umstellen: würde formValuesToOverlay() brechen, der auf `''` als strip-marker zählt,
 * und macht den schema-roundtrip unklar. Sentinel-mapping bleibt isoliert
 * in der UI-schicht.
 */
export const SELECT_AUTO_VALUE = '__auto__';

/** Form-value (`''` für auto) → Select-value (`'__auto__'` für auto). */
export function toSelectValue(formValue: string): string {
  return formValue === '' ? SELECT_AUTO_VALUE : formValue;
}

/** Select-value (`'__auto__'` für auto) → Form-value (`''` für auto). */
export function fromSelectValue(selectValue: string): string {
  return selectValue === SELECT_AUTO_VALUE ? '' : selectValue;
}

/**
 * Convert an initial typed overlay to string-form values for the
 * form's controlled inputs. Numbers become their string repr,
 * strings stay as-is, undefined becomes empty string.
 */
export function overlayToFormValues(
  overlay: SimBriefOverlay,
): Record<string, string> {
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
export function formValuesToOverlay(
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
