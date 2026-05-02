'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { AirportAutocomplete } from '@/components/airport-autocomplete';
import {
  createRoute,
  updateRoute,
  type RouteFormState,
} from './actions';

/**
 * Airport-projection (matches AirportAutocomplete's expected shape +
 * was Route relations include). Lokal definiert um die page-zu-form-
 * datenflüsse typed zu halten ohne über zu viele helper-files zu hopsen.
 */
type AirportLike = {
  id: string;
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string;
  latitude: number;
  longitude: number;
};

type Mode =
  | { kind: 'create' }
  | {
      kind: 'edit';
      routeId: string;
      initialFlightNumber: string;
      initialDeparture: AirportLike;
      initialArrival: AirportLike;
      initialAircraftTypeIcao: string | null;
      initialEstimatedMinutes: number;
      initialDistanceNm: number;
      initialActive: boolean;
    };

interface Props {
  mode: Mode;
}

/**
 * Shared form für create + edit. Verwendet useActionState (React 19) für
 * server-action-integration mit per-field-errors. Der `mode`-discriminated-
 * union entscheidet welche action gebunden wird und welche initial-werte
 * das form bekommt.
 *
 * Pattern-rationale:
 * - Shared statt zwei separate components weil 95% des UI identisch ist
 *   (felder, validation, layout). Der unterschied ist nur welche action
 *   gerufen wird + welche pre-filled values geladen sind.
 * - useActionState statt useFormState (renamed in React 19) — beide
 *   funktionieren noch aber useActionState ist die forward-compatible API.
 *
 * Auto-calc hint: distance + duration zeigen "(auto wenn leer)" als
 * placeholder + helper-text, weil das die meist-genutzte option sein wird.
 * Manueller override für edge-cases (charter mit ungewöhnlicher route,
 * step-climb-profile, etc.).
 */
export function RouteForm({ mode }: Props) {
  const action =
    mode.kind === 'create'
      ? createRoute
      : updateRoute.bind(null, mode.routeId);

  const [state, formAction] = useActionState<RouteFormState | null, FormData>(
    action,
    null,
  );

  return (
    <form action={formAction} className="space-y-6">
      {/* Top-level message banner — success oder error vom server */}
      {state?.message && (
        <div
          className={`rounded-lg p-4 text-sm ${
            state.ok
              ? 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-800 text-green-900 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
          }`}
          role={state.ok ? 'status' : 'alert'}
        >
          {state.message}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Flight number */}
        <div>
          <label
            htmlFor="flightNumber"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Flugnummer<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            id="flightNumber"
            name="flightNumber"
            type="text"
            required
            defaultValue={mode.kind === 'edit' ? mode.initialFlightNumber : ''}
            placeholder="LH918, BA2761, KK101"
            autoComplete="off"
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              state?.fieldErrors?.flightNumber
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white font-mono uppercase focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-500`}
          />
          {state?.fieldErrors?.flightNumber ? (
            <p className="text-xs text-red-500 mt-1">{state.fieldErrors.flightNumber}</p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              2-3 buchstaben + 1-4 zahlen, optional 1 suffix
            </p>
          )}
        </div>

        {/* Aircraft type ICAO */}
        <div>
          <label
            htmlFor="aircraftTypeIcao"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Aircraft-Type (ICAO)
          </label>
          <input
            id="aircraftTypeIcao"
            name="aircraftTypeIcao"
            type="text"
            defaultValue={
              mode.kind === 'edit' ? (mode.initialAircraftTypeIcao ?? '') : ''
            }
            placeholder="B738, A20N, A359, CRJ9"
            autoComplete="off"
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              state?.fieldErrors?.aircraftTypeIcao
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white font-mono uppercase focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-500`}
          />
          {state?.fieldErrors?.aircraftTypeIcao ? (
            <p className="text-xs text-red-500 mt-1">{state.fieldErrors.aircraftTypeIcao}</p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Optional. Pilot wählt im sim eine kompatible livery
            </p>
          )}
        </div>
      </div>

      {/* Departure + arrival side-by-side on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <AirportAutocomplete
          name="departureId"
          label="Abflughafen"
          required
          initialAirport={mode.kind === 'edit' ? mode.initialDeparture : null}
          error={state?.fieldErrors?.departureId}
        />
        <AirportAutocomplete
          name="arrivalId"
          label="Zielflughafen"
          required
          initialAirport={mode.kind === 'edit' ? mode.initialArrival : null}
          error={state?.fieldErrors?.arrivalId}
        />
      </div>

      {/* Distance + duration (both optional / auto-calc) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label
            htmlFor="distanceNm"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Distanz (NM)
          </label>
          <input
            id="distanceNm"
            name="distanceNm"
            type="number"
            min={1}
            max={15000}
            defaultValue={mode.kind === 'edit' ? mode.initialDistanceNm : ''}
            placeholder="auto wenn leer"
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              state?.fieldErrors?.distanceNm
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-500`}
          />
          {state?.fieldErrors?.distanceNm ? (
            <p className="text-xs text-red-500 mt-1">{state.fieldErrors.distanceNm}</p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Wenn leer: great-circle-distanz aus airport-koordinaten
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="estimatedMinutes"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Flugzeit (Minuten)
          </label>
          <input
            id="estimatedMinutes"
            name="estimatedMinutes"
            type="number"
            min={1}
            max={2000}
            defaultValue={mode.kind === 'edit' ? mode.initialEstimatedMinutes : ''}
            placeholder="auto wenn leer"
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              state?.fieldErrors?.estimatedMinutes
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 placeholder:text-gray-400 dark:placeholder:text-gray-500`}
          />
          {state?.fieldErrors?.estimatedMinutes ? (
            <p className="text-xs text-red-500 mt-1">{state.fieldErrors.estimatedMinutes}</p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Wenn leer: distanz / 450kt + 25 min taxi/climb/descent
            </p>
          )}
        </div>
      </div>

      {/* Active checkbox */}
      <div className="flex items-center gap-3">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={mode.kind === 'edit' ? mode.initialActive : true}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="active" className="text-sm text-gray-700 dark:text-gray-300">
          Aktiv (für piloten sichtbar + buchbar)
        </label>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
        <SubmitButton mode={mode.kind} />
        <Link
          href="/airline/routes"
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
        >
          Abbrechen
        </Link>
      </div>
    </form>
  );
}

/**
 * Submit-button mit useFormStatus für pending-state. Sub-component damit
 * der hook nur dort lebt wo er nötig ist (das parent-form muss nicht
 * client-component-status managen).
 */
function SubmitButton({ mode }: { mode: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition"
    >
      {pending
        ? mode === 'create'
          ? 'Wird angelegt...'
          : 'Wird aktualisiert...'
        : mode === 'create'
          ? 'Route anlegen'
          : 'Änderungen speichern'}
    </button>
  );
}
