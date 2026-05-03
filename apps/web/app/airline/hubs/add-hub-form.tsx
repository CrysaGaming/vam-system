'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { addHub } from './actions';

/**
 * Inline-form zum hinzufügen eines neuen hubs. Klein gehalten — ein
 * ICAO-input + submit-button. Bewusst KEIN airport-autocomplete hier:
 * - Hubs sind selten (1-5 pro airline), nicht 50-200 wie routes
 * - Admins kennen ihre hub-ICAOs auswendig (EDDF, EDDM, EGLL, etc.)
 * - Free-text-input ist schneller für muscle-memory
 *
 * Server-action validiert dass der ICAO im catalog existiert und gibt
 * eine error-message zurück wenn nicht (mit hint auf den request-flow).
 */
type State = { ok: true } | { ok: false; error: string } | null;

async function addHubAction(_prev: State, formData: FormData): Promise<State> {
  return await addHub(formData);
}

export function AddHubForm() {
  const [state, formAction] = useActionState<State, FormData>(addHubAction, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[140px]">
          <label
            htmlFor="icao"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Hub ICAO
          </label>
          <input
            type="text"
            id="icao"
            name="icao"
            required
            maxLength={4}
            placeholder="EDDF"
            // Uppercase-via-CSS damit der user-input visuell sofort
            // aussieht wie das was die action speichert (transform .toUpperCase()).
            // Kein onChange-handler weil das nur server-component-form-state
            // unnötig komplex macht.
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white uppercase placeholder:normal-case placeholder:text-gray-400 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <SubmitButton />
      </div>

      {state && !state.ok && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {state.error}
        </div>
      )}
      {state && state.ok && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2">
          Hub hinzugefügt.
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
      {pending ? 'Wird hinzugefügt…' : '+ Hub hinzufügen'}
    </button>
  );
}
