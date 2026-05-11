'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateAircraft } from '../../actions';
import { AircraftTypeAutocomplete } from '@/components/aircraft-type-autocomplete';

/**
 * Edit-form für ein bestehendes Aircraft. Separat von AddAircraftForm
 * weil:
 * - Pre-filled values aus initial-props
 * - Status NICHT editierbar hier (status-changes laufen über die
 *   action-buttons-dropdown auf der listing-page — single source of
 *   truth)
 * - Registration-changes mit warning ("printet auf historische PIREPs")
 * - Type via AircraftTypeAutocomplete im hybrid-mode (Welle 6A-1) —
 *   pre-filled mit existing catalog-link wenn vorhanden, sonst nur
 *   free-text initialType.
 *
 * Hidden field aircraftId wird im server-action für multi-tenant-check
 * + lookup genutzt. aircraftTypeId + type werden vom Autocomplete
 * selbst gerendert (zwei hidden inputs).
 *
 * # Track 4 #85 (Section Q) — Photo-URL field
 *
 * Statt file-upload nutzen wir das URL-pattern (analog Airline.logoUrl):
 * admin trägt eine bild-URL ein, wir validieren + speichern. Vorteil:
 * keine blob-storage-infrastruktur nötig (existiert im codebase nicht),
 * konsistent mit anderen image-features, deletbar via leeres feld.
 *
 * Live-preview: das input ist controlled (useState) damit eine 96x96-
 * thumbnail neben dem feld sofort beim tippen aktualisiert. Bei invalid
 * URL fällt das preview-image stillschweigend auf den ICAO-fallback.
 */
type State = { ok: true } | { ok: false; error: string } | null;

interface Props {
  aircraftId: string;
  initialRegistration: string;
  initialType: string;
  initialAircraftTypeId: string | null;
  /**
   * Pre-formatted display-string für den autocomplete ("B738 — Boeing
   * 737-800"). Vom parent gebaut aus aircraft.aircraftType. Null wenn
   * das aircraft nicht mit einem catalog-eintrag verknüpft ist.
   */
  initialAircraftTypeDisplay: string | null;
  initialHomeIcao: string | null;
  /**
   * Track 4 #85: bisherige photo-URL. Null wenn keine gesetzt.
   */
  initialPhotoUrl: string | null;
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
  initialAircraftTypeDisplay,
  initialHomeIcao,
  initialPhotoUrl,
}: Props) {
  const [state, formAction] = useActionState<State, FormData>(
    updateAircraftAction,
    null,
  );

  // Controlled state für photoUrl — driver der live-preview-thumbnail.
  // useState statt defaultValue weil wir das preview-bild beim tippen
  // syncen wollen.
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl ?? '');
  // Eigener loaded/error-state für preview damit wir bei broken URLs
  // (404, CORS, malformed) auf den fallback-block schwenken können
  // statt ein kaputtes alt-text-icon zu zeigen.
  const [previewBroken, setPreviewBroken] = useState(false);

  // Beim photoUrl-change broken-flag resetten — neue URL kriegt frische
  // chance zum laden.
  function handlePhotoChange(value: string) {
    setPhotoUrl(value);
    setPreviewBroken(false);
  }

  // Plausibilitäts-check für preview: nur rendern wenn URL "vernünftig"
  // aussieht (http/https-prefix). Verhindert dass beim ersten zeichen
  // schon ein broken-img request gefeuert wird.
  const showPreview =
    photoUrl.length > 0 &&
    /^https?:\/\//i.test(photoUrl) &&
    !previewBroken;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="aircraftId" value={aircraftId} />

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
          <AircraftTypeAutocomplete
            required
            initialAircraftTypeId={initialAircraftTypeId}
            initialType={initialType}
            initialDisplay={initialAircraftTypeDisplay ?? initialType}
          />
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

        {/* Track 4 #85 (Section Q): Photo-URL field. URL-input + 96x96
            live-preview rechts daneben. Bei broken-img schwenkt der
            preview-block auf einen neutralen placeholder; bei leerem
            input zeigt das placeholder den hint "Kein Foto gesetzt". */}
        <div className="sm:col-span-2">
          <label
            htmlFor="photoUrl"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Foto-URL
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="url"
                id="photoUrl"
                name="photoUrl"
                value={photoUrl}
                onChange={(e) => handlePhotoChange(e.target.value)}
                maxLength={2000}
                placeholder="https://example.com/d-aibc-side-view.jpg"
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                URL eines bildes (z.B. von imgur, flickr, oder eigenem
                CDN). Leer lassen um das foto zu entfernen.
              </p>
            </div>
            {/* Preview-block: 96x96 quadrat. Bei valider URL kommt das
                bild rein (mit picture-wrapper analog AppShell-pattern um
                React-Float-preload-warnings zu vermeiden). Bei nicht-
                gesetzter oder broken URL: subtle placeholder. */}
            <div className="shrink-0 w-24 h-24 rounded border border-gray-300 dark:border-gray-700 overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              {showPreview ? (
                <picture>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl}
                    alt="Aircraft-Foto Vorschau"
                    className="w-full h-full object-cover"
                    onError={() => setPreviewBroken(true)}
                  />
                </picture>
              ) : (
                <span
                  className="text-xs text-gray-400 dark:text-gray-600 text-center px-1"
                  aria-hidden="true"
                >
                  {photoUrl.length > 0 && previewBroken
                    ? '⚠️\nBroken'
                    : 'Kein\nFoto'}
                </span>
              )}
            </div>
          </div>
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
