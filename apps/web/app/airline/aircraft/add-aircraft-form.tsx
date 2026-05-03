'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { addAircraft } from './actions';
import { AircraftTypeAutocomplete } from '@/components/aircraft-type-autocomplete';

/**
 * Inline-form zum hinzufügen eines neuen Aircraft. Bewusst minimal gehalten:
 * - Registration (uppercase + regex auf A-Z, 0-9, -)
 * - Type via AircraftTypeAutocomplete (HYBRID: catalog-pick ODER free-text).
 *   Catalog-pick setzt zusätzlich aircraftTypeId für FK-binding. Free-text
 *   bleibt erlaubt für nicht-katalogisierte Types (legacy + edge-cases).
 *   → Welle 6A-1
 * - Home-Hub ICAO (optional, validated gegen catalog server-side)
 * - Status (radio, default ACTIVE — meiste airframes werden direkt aktiv
 *   eingelegt; STORED/MAINTENANCE als import-zustand selten genug für
 *   einen extra-step)
 *
 * Edit-flow läuft über separate page (/airline/aircraft/[id]/edit) statt
 * inline — registration-changes sind riskant (printet auf historische
 * PIREPs) und die edit-form sollte daher mehr platz für warnings haben.
 *
 * Why not autocomplete für home-icao: AirportAutocomplete-component bringt
 * client-side fetch + dropdown-state + 85k airports. Für hub-eingabe wo
 * admin den ICAO auswendig kennt ist das overkill. Server-side validation
 * fängt typos.
 */
type State = { ok: true } | { ok: false; error: string } | null;

async function addAircraftAction(_prev: State, formData: FormData): Promise<State> {
  return await addAircraft(formData);
}

export function AddAircraftForm() {
  const [state, formAction] = useActionState<State, FormData>(
    addAircraftAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="registration"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Registration<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text"
            id="registration"
            name="registration"
            required
            maxLength={10}
            placeholder="D-AIBC"
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white uppercase placeholder:normal-case placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        <div>
          <AircraftTypeAutocomplete required />
        </div>

        <div>
          <label
            htmlFor="homeIcao"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Home-Hub (ICAO)
          </label>
          <input
            type="text"
            id="homeIcao"
            name="homeIcao"
            maxLength={4}
            placeholder="EDDF (optional)"
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white uppercase placeholder:normal-case placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>

        <div>
          <label
            htmlFor="status"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue="ACTIVE"
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="ACTIVE">Aktiv (buchbar)</option>
            <option value="MAINTENANCE">Wartung</option>
            <option value="STORED">Eingelagert</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Registration und Type werden automatisch in Großbuchstaben
          gespeichert. Home-Hub muss im Airport-Catalog existieren.
        </p>
        <SubmitButton />
      </div>

      {state && !state.ok && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {state.error}
        </div>
      )}
      {state && state.ok && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2">
          Aircraft hinzugefügt.
        </div>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? 'Wird hinzugefügt…' : '+ Aircraft hinzufügen'}
    </button>
  );
}
