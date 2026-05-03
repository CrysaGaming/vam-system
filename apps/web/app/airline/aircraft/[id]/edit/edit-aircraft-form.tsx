'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateAircraft } from '../../actions';

/**
 * Edit-form für ein bestehendes Aircraft. Separat von AddAircraftForm
 * weil:
 * - Pre-filled values aus initial-props
 * - Status NICHT editierbar hier (status-changes laufen über die
 *   action-buttons-dropdown auf der listing-page — single source of
 *   truth)
 * - Registration-changes mit warning ("printet auf historische PIREPs")
 *
 * Hidden field aircraftId wird im server-action für multi-tenant-check
 * + lookup genutzt.
 */
type State = { ok: true } | { ok: false; error: string } | null;

interface Props {
  aircraftId: string;
  initialRegistration: string;
  initialType: string;
  initialAircraftTypeId: string | null;
  initialHomeIcao: string | null;
}

async function updateAircraftAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  return await updateAircraft(formData);
}

export function EditAircraftForm({
  aircraftId,
  initialRegistration,
  initialType,
  initialAircraftTypeId,
  initialHomeIcao,
}: Props) {
  const [state, formAction] = useActionState<State, FormData>(
    updateAircraftAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="aircraftId" value={aircraftId} />
      {initialAircraftTypeId && (
        <input
          type="hidden"
          name="aircraftTypeId"
          value={initialAircraftTypeId}
        />
      )}

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
            defaultValue={initialRegistration}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white uppercase placeholder:normal-case placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
          />
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            ⚠️ Registration-Änderungen wirken sich auf historische PIREPs
            und Routes aus.
          </p>
        </div>

        <div>
          <label
            htmlFor="type"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Aircraft Type (ICAO)
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text"
            id="type"
            name="type"
            required
            maxLength={20}
            defaultValue={initialType}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white uppercase placeholder:normal-case placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
          />
          {initialAircraftTypeId && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Aktuell verlinkt mit Catalog-Eintrag.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
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
            defaultValue={initialHomeIcao ?? ''}
            placeholder="EDDF (optional)"
            className="w-full sm:w-32 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white uppercase placeholder:normal-case placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
          />
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Leer lassen um Home-Hub zu entfernen. Muss im Airport-Catalog
            existieren.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
      </div>

      {state && !state.ok && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {state.error}
        </div>
      )}
      {state && state.ok && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2">
          Aircraft aktualisiert.
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
      {pending ? 'Speichere…' : 'Änderungen speichern'}
    </button>
  );
}
