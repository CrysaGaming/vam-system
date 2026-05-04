'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  createScheduleTemplate,
  updateScheduleTemplate,
  type ScheduleTemplateFormState,
} from './actions';
import { formatMinuteUtc, ISO_WEEKDAY_LABELS_DE } from '@/lib/schedule';

type RouteOption = {
  id: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  active: boolean;
};

type AircraftOption = {
  id: string;
  registration: string;
  type: string;
};

type Mode =
  | { kind: 'create' }
  | {
      kind: 'edit';
      templateId: string;
      initialRouteId: string;
      initialLabel: string | null;
      initialDaysOfWeek: number[];
      initialDepartureMinuteUtc: number;
      initialValidFrom: Date;
      initialValidUntil: Date | null;
      initialPreferredAircraftId: string | null;
      initialActive: boolean;
    };

interface Props {
  mode: Mode;
  routes: RouteOption[];
  aircraft: AircraftOption[];
}

/**
 * Shared form für create + edit von ScheduleTemplate. Mirror der pattern
 * von rank-form.tsx: useActionState (React 19) + per-field-errors.
 *
 * Felder:
 * - Route (select, required) — nur active routes der eigenen airline
 * - Label (optional text, max 80) — human-readable name
 * - daysOfWeek (7 checkboxes 1..7) — mindestens einer required
 * - departureTime (time-input "HH:MM" UTC) — wird zu int konvertiert
 * - validFrom (date-input, required) — UTC-midnight
 * - validUntil (date-input, optional) — UTC-midnight, > validFrom
 * - preferredAircraft (select, optional) — eigene aircraft only
 * - active (checkbox, default true)
 *
 * UX-decisions:
 * - daysOfWeek als 7 inline-checkboxes statt multi-select-dropdown — ist
 *   schneller zu klicken und macht das pattern visuell sofort klar
 * - Schnell-buttons "Mo-Fr / Sa-So / Täglich" oberhalb der checkboxes
 *   für die häufigsten patterns (siehe formatDaysOfWeekDe shortcuts)
 * - departureTime ist nativ <input type="time"> — browser zeigt 24h,
 *   wir labelen ALL-CAPS UTC daneben damit klar ist dass das nicht
 *   local-time ist
 */
export function ScheduleTemplateForm({ mode, routes, aircraft }: Props) {
  const action =
    mode.kind === 'create'
      ? createScheduleTemplate
      : updateScheduleTemplate.bind(null, mode.templateId);

  const [state, formAction] = useActionState<
    ScheduleTemplateFormState | null,
    FormData
  >(action, null);

  const errors = state?.fieldErrors ?? {};

  const initialDaysOfWeek =
    mode.kind === 'edit' ? new Set(mode.initialDaysOfWeek) : new Set<number>();
  const initialDepartureTime =
    mode.kind === 'edit'
      ? formatMinuteUtc(mode.initialDepartureMinuteUtc)
      : '';
  const initialValidFromYmd =
    mode.kind === 'edit' ? toYmd(mode.initialValidFrom) : '';
  const initialValidUntilYmd =
    mode.kind === 'edit' && mode.initialValidUntil
      ? toYmd(mode.initialValidUntil)
      : '';

  return (
    <form action={formAction} className="space-y-5">
      {state?.message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            state.ok
              ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
          }`}
        >
          {state.ok ? '✓' : '✗'} {state.message}
        </div>
      )}

      {/* Route */}
      <div>
        <label
          htmlFor="schedule-route"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Route<span className="text-red-500 ml-0.5">*</span>
        </label>
        <select
          id="schedule-route"
          name="routeId"
          required
          defaultValue={mode.kind === 'edit' ? mode.initialRouteId : ''}
          className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
            errors.routeId
              ? 'border-red-500 dark:border-red-500'
              : 'border-gray-300 dark:border-gray-700'
          } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500`}
        >
          <option value="">— Route wählen —</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.flightNumber} · {r.departureIcao} → {r.arrivalIcao}
              {!r.active ? ' (inaktiv)' : ''}
            </option>
          ))}
        </select>
        {errors.routeId && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            {errors.routeId}
          </p>
        )}
        {routes.length === 0 && (
          <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
            Keine routes verfügbar — leg erst eine{' '}
            <Link
              href="/airline/routes/new"
              className="underline hover:text-yellow-700 dark:hover:text-yellow-400"
            >
              route an
            </Link>
            .
          </p>
        )}
      </div>

      {/* Label */}
      <div>
        <label
          htmlFor="schedule-label"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Label{' '}
          <span className="text-gray-400 dark:text-gray-500 font-normal">
            (optional)
          </span>
        </label>
        <input
          type="text"
          id="schedule-label"
          name="label"
          maxLength={80}
          placeholder="z.B. Daily Frankfurt-Munich Morning Shuttle"
          defaultValue={mode.kind === 'edit' ? mode.initialLabel ?? '' : ''}
          className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
            errors.label
              ? 'border-red-500 dark:border-red-500'
              : 'border-gray-300 dark:border-gray-700'
          } rounded text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-indigo-500`}
        />
        {errors.label && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            {errors.label}
          </p>
        )}
      </div>

      {/* daysOfWeek + departureTime nebeneinander */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Wochentage<span className="text-red-500 ml-0.5">*</span>
          </label>
          <DaysOfWeekPicker initialDays={initialDaysOfWeek} />
          {errors.daysOfWeek && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.daysOfWeek}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="schedule-departure-time"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Abflugzeit{' '}
            <span className="text-gray-500 dark:text-gray-400 font-normal text-xs">
              (UTC)
            </span>
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="time"
            id="schedule-departure-time"
            name="departureTime"
            required
            defaultValue={initialDepartureTime}
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              errors.departureTime
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 tabular-nums`}
          />
          {errors.departureTime && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.departureTime}
            </p>
          )}
          {!errors.departureTime && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              In UTC eingeben (kein local time)
            </p>
          )}
        </div>
      </div>

      {/* validFrom + validUntil */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label
            htmlFor="schedule-valid-from"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Gültig ab<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="date"
            id="schedule-valid-from"
            name="validFrom"
            required
            defaultValue={initialValidFromYmd}
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              errors.validFrom
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500`}
          />
          {errors.validFrom && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.validFrom}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="schedule-valid-until"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Gültig bis{' '}
            <span className="text-gray-400 dark:text-gray-500 font-normal">
              (optional, leer = unbegrenzt)
            </span>
          </label>
          <input
            type="date"
            id="schedule-valid-until"
            name="validUntil"
            defaultValue={initialValidUntilYmd}
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              errors.validUntil
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500`}
          />
          {errors.validUntil && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.validUntil}
            </p>
          )}
        </div>
      </div>

      {/* preferredAircraft */}
      <div>
        <label
          htmlFor="schedule-aircraft"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Bevorzugtes Flugzeug{' '}
          <span className="text-gray-400 dark:text-gray-500 font-normal">
            (optional)
          </span>
        </label>
        <select
          id="schedule-aircraft"
          name="preferredAircraftId"
          defaultValue={
            mode.kind === 'edit' ? mode.initialPreferredAircraftId ?? '' : ''
          }
          className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
            errors.preferredAircraftId
              ? 'border-red-500 dark:border-red-500'
              : 'border-gray-300 dark:border-gray-700'
          } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500`}
        >
          <option value="">— Kein bestimmtes Flugzeug —</option>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} · {a.type}
            </option>
          ))}
        </select>
        {errors.preferredAircraftId && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            {errors.preferredAircraftId}
          </p>
        )}
        {!errors.preferredAircraftId && (
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Wenn gesetzt: pre-fill für scheduled-instances. Conflict-detection
            ist 7A nur informational, kein hard-block.
          </p>
        )}
      </div>

      {/* active */}
      <div className="flex items-center gap-2 pt-2">
        <input
          type="checkbox"
          id="schedule-active"
          name="active"
          defaultChecked={mode.kind === 'edit' ? mode.initialActive : true}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500"
        />
        <label
          htmlFor="schedule-active"
          className="text-sm text-gray-700 dark:text-gray-300"
        >
          Aktiv (generator nutzt dieses template)
        </label>
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        <SubmitButton kind={mode.kind} />
        <Link
          href="/airline/schedule"
          className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded transition"
        >
          Abbrechen
        </Link>
      </div>
    </form>
  );
}

/**
 * 7 checkboxes für daysOfWeek mit shortcut-buttons darüber. Client-side
 * state nur für die shortcut-buttons (toggle multiple at once); die
 * checkboxes selbst sind uncontrolled mit defaultChecked. FormData
 * collected dann automatisch alle gesetzten checkboxes.
 */
function DaysOfWeekPicker({ initialDays }: { initialDays: Set<number> }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        <ShortcutButton
          days={[1, 2, 3, 4, 5]}
          label="Mo–Fr"
          selectorBase="schedule-day-"
        />
        <ShortcutButton
          days={[6, 7]}
          label="Wochenende"
          selectorBase="schedule-day-"
        />
        <ShortcutButton
          days={[1, 2, 3, 4, 5, 6, 7]}
          label="Täglich"
          selectorBase="schedule-day-"
        />
        <ShortcutButton
          days={[]}
          label="Alle abwählen"
          selectorBase="schedule-day-"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <label
            key={d}
            htmlFor={`schedule-day-${d}`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
          >
            <input
              type="checkbox"
              id={`schedule-day-${d}`}
              name="daysOfWeek"
              value={d}
              defaultChecked={initialDays.has(d)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {ISO_WEEKDAY_LABELS_DE[d]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Setzt eine vordefinierte days-of-week selection. days=[] bedeutet
 * "alle abwählen".
 */
function ShortcutButton({
  days,
  label,
  selectorBase,
}: {
  days: number[];
  label: string;
  selectorBase: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const wanted = new Set(days);
        for (const d of [1, 2, 3, 4, 5, 6, 7]) {
          const cb = document.getElementById(
            `${selectorBase}${d}`,
          ) as HTMLInputElement | null;
          if (cb) cb.checked = wanted.has(d);
        }
      }}
      className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded transition"
    >
      {label}
    </button>
  );
}

function SubmitButton({ kind }: { kind: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  const label = kind === 'create' ? 'Template anlegen' : 'Änderungen speichern';
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded transition"
    >
      {pending ? 'Speichere…' : label}
    </button>
  );
}

function toYmd(date: Date): string {
  // UTC-portion damit das selbe datum kommt was beim parseDateOnlyToUtc
  // server-seitig wieder rauskommt.
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
