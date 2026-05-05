'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  createSceneryAction,
  updateSceneryAction,
  deleteSceneryAction,
  type ActionResult,
} from './actions';
import type { Scenery } from '@vam/db';

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Admin client components.
 *
 * Server-actions sind in actions.ts; hier sind die client-side wrappers
 * die forms rendern, useActionState für pending/errors handeln, und
 * confirmation-dialogs für destructive ops zeigen.
 *
 * Pattern spiegelt /admin/awards/admin-forms.tsx — collapsible <details>-
 * card für create-form, inline edit-form in der liste.
 *
 * Eine besonderheit: deleteSceneryAction nutzt formData + redirect (im
 * gegensatz zu deleteAwardAction das direct id + ActionResult nutzt).
 * Das matched die explizite design-entscheidung in actions.ts ("delete
 * ist fire-and-redirect, kein validate-and-show-feedback") — der button
 * submitted ein hidden-form, kein onClick-handler mit useState.
 */

// Airline-option-shape — passed in als prop weil airlines auf der server-
// seite in den page-loaders gefetcht werden (schon im memory).
export type AirlineOption = {
  id: string;
  name: string;
  iata: string | null;
  icao: string | null;
};

// ─────────────────────────────────────────────────────────────────────
// Shared form-fields component
// ─────────────────────────────────────────────────────────────────────

/**
 * DRY-helper: die felder name/airport/provider/url/free/airline werden
 * in BEIDEN forms (create + edit) gerendert. Statt das markup zu
 * duplizieren extrahieren wir es in eine inner-component die in beiden
 * verwendet wird.
 *
 * `idPrefix` differenziert die label-htmlFor-bindings (sonst hätten edit
 * und create dieselbe id und screen-readers/click-on-label würde aufs
 * falsche element targeten).
 */
function SceneryFormFields({
  idPrefix,
  defaults,
  airlines,
}: {
  idPrefix: string;
  defaults?: {
    name?: string;
    airportIcao?: string | null;
    provider?: string | null;
    url?: string | null;
    free?: boolean;
    airlineId?: string | null;
  };
  airlines: AirlineOption[];
}) {
  return (
    <>
      <div>
        <label
          htmlFor={`${idPrefix}-name`}
          className="block text-sm font-medium mb-1"
        >
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          minLength={2}
          maxLength={150}
          defaultValue={defaults?.name ?? ''}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          placeholder="z.B. EDDF Frankfurt von Inibuilds"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`${idPrefix}-airportIcao`}
            className="block text-sm font-medium mb-1"
          >
            Airport (ICAO)
          </label>
          <input
            id={`${idPrefix}-airportIcao`}
            name="airportIcao"
            maxLength={4}
            defaultValue={defaults?.airportIcao ?? ''}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm font-mono uppercase"
            placeholder="EDDF"
          />
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-provider`}
            className="block text-sm font-medium mb-1"
          >
            Provider
          </label>
          <input
            id={`${idPrefix}-provider`}
            name="provider"
            maxLength={100}
            defaultValue={defaults?.provider ?? ''}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
            placeholder="Inibuilds, Orbx, ..."
          />
        </div>
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-url`}
          className="block text-sm font-medium mb-1"
        >
          URL (Store-Link)
        </label>
        <input
          id={`${idPrefix}-url`}
          name="url"
          type="url"
          maxLength={500}
          defaultValue={defaults?.url ?? ''}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          placeholder="https://..."
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <div>
          <label
            htmlFor={`${idPrefix}-airlineId`}
            className="block text-sm font-medium mb-1"
          >
            Airline
          </label>
          <select
            id={`${idPrefix}-airlineId`}
            name="airlineId"
            defaultValue={defaults?.airlineId ?? ''}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded text-sm"
          >
            <option value="">Global (alle airlines)</option>
            {airlines.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.iata ?? a.icao ?? '–'})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pt-6 sm:pt-0">
          <input
            id={`${idPrefix}-free`}
            name="free"
            type="checkbox"
            // HTML-checkboxes senden "on" wenn checked, sonst nichts.
            // defaultChecked steuert initial-state. Server normalisiert
            // value === 'on' → boolean true.
            defaultChecked={defaults?.free ?? true}
            className="w-4 h-4"
          />
          <label
            htmlFor={`${idPrefix}-free`}
            className="text-sm font-medium cursor-pointer"
          >
            Kostenlos
          </label>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CreateSceneryForm
// ─────────────────────────────────────────────────────────────────────

export function CreateSceneryForm({
  airlines,
}: {
  airlines: AirlineOption[];
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(createSceneryAction, null);
  const [resetKey, setResetKey] = useState(0);

  // Bei erfolg formular zurücksetzen — useActionState behält state nach
  // submit, also würde sonst der alte input stehen bleiben. resetKey
  // forciert ein remount des form-elements.
  useEffect(() => {
    if (state?.ok) setResetKey((k) => k + 1);
  }, [state?.ok]);

  return (
    <form
      key={resetKey}
      action={formAction}
      className="space-y-3 max-w-xl"
    >
      <SceneryFormFields idPrefix="create" airlines={airlines} />
      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded text-sm font-medium transition"
        >
          {pending ? 'Wird angelegt…' : 'Scenery anlegen'}
        </button>
        {state && (
          <p
            className={`text-xs ${
              state.ok
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
            role={state.ok ? 'status' : 'alert'}
          >
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EditSceneryForm
// ─────────────────────────────────────────────────────────────────────

export function EditSceneryForm({
  scenery,
  airlines,
}: {
  scenery: Scenery;
  airlines: AirlineOption[];
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(updateSceneryAction, null);

  return (
    <form action={formAction} className="space-y-3 max-w-xl">
      <input type="hidden" name="id" value={scenery.id} />
      <SceneryFormFields
        idPrefix={`edit-${scenery.id}`}
        defaults={{
          name: scenery.name,
          airportIcao: scenery.airportIcao,
          provider: scenery.provider,
          url: scenery.url,
          free: scenery.free,
          airlineId: scenery.airlineId,
        }}
        airlines={airlines}
      />
      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded text-sm font-medium transition"
        >
          {pending ? 'Wird gespeichert…' : 'Speichern'}
        </button>
        {state && (
          <p
            className={`text-xs ${
              state.ok
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
            role={state.ok ? 'status' : 'alert'}
          >
            {state.ok ? state.message : state.error}
          </p>
        )}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DeleteSceneryButton
// ─────────────────────────────────────────────────────────────────────

/**
 * Delete-button als hidden-form. Anders als awards (das direct-arg-action
 * mit ActionResult nutzt) ist deleteSceneryAction redirect-style — wir
 * submitten ein hidden form mit der scenery-id, der server löscht und
 * redirected zurück auf /admin/sceneries.
 *
 * Confirmation per onSubmit: wenn user cancel'd, preventDefault stoppt
 * die submission. Schlicht aber funktional.
 *
 * Variante "compact" (für list-rows) zeigt nur einen kleineren button;
 * default ist die normale größe für die detail-page.
 */
export function DeleteSceneryButton({
  sceneryId,
  sceneryName,
  variant = 'default',
}: {
  sceneryId: string;
  sceneryName: string;
  variant?: 'default' | 'compact';
}) {
  return (
    <form
      action={deleteSceneryAction}
      onSubmit={(e) => {
        if (
          !confirm(
            `Scenery "${sceneryName}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
          )
        ) {
          e.preventDefault();
        }
      }}
      // inline-block damit der button nicht den ganzen flex-row sprengt
      className="inline-block"
    >
      <input type="hidden" name="id" value={sceneryId} />
      <button
        type="submit"
        className={
          variant === 'compact'
            ? 'px-3 py-1.5 text-xs bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded font-medium transition'
            : 'px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition'
        }
      >
        Löschen
      </button>
    </form>
  );
}
