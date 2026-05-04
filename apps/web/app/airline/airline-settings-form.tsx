'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateAirlineSettings, type AirlineSettings } from './actions';

interface Props {
  initial: AirlineSettings;
}

/**
 * Airline settings form — edits name, ICAO, callsign, IATA, logoUrl.
 *
 * ICAO is editable but guarded: an extra "ich weiß was ich tue" checkbox
 * must be checked before the input unlocks. Reason: ICAO is the visible
 * identifier across the entire UI (dashboard, ATC callsigns, bookings,
 * SimBrief OFP), and a typo would propagate everywhere immediately. The
 * gate prevents accidental edits while keeping the field accessible
 * when an admin genuinely needs to fix or rename it.
 *
 * The DB stores ICAO as `@unique` but does NOT use it as a foreign key —
 * all relations go through `airlineId`. So renaming is a single-row
 * update that doesn't cascade.
 */
export function AirlineSettingsForm({ initial }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [icaoUnlocked, setIcaoUnlocked] = useState(false);
  const router = useRouter();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);

    const name = (formData.get('name') as string).trim();
    const icao = (formData.get('icao') as string).trim().toUpperCase();
    const callsign = (formData.get('callsign') as string).trim() || null;
    const iata = (formData.get('iata') as string).trim() || null;
    const logoUrl = (formData.get('logoUrl') as string).trim() || null;
    // Welle 8 branding fields
    const tagline = (formData.get('tagline') as string).trim() || null;
    const description = (formData.get('description') as string).trim() || null;
    const websiteUrl = (formData.get('websiteUrl') as string).trim() || null;
    const primaryColor =
      (formData.get('primaryColor') as string).trim().toUpperCase() || null;
    const secondaryColor =
      (formData.get('secondaryColor') as string).trim().toUpperCase() || null;
    // Checkbox: present only when checked. We invert: input is named
    // "publicHidden" (default unchecked = publicVisible=true, the
    // privacy-friendly opt-out). This makes the form control match how
    // a user thinks about the action ("hide my airline").
    const publicVisible = formData.get('publicHidden') !== 'on';

    startTransition(async () => {
      try {
        await updateAirlineSettings({
          name,
          icao,
          callsign,
          iata,
          logoUrl,
          tagline,
          description,
          websiteUrl,
          primaryColor,
          secondaryColor,
          publicVisible,
        });
        setSaved(true);
        setIcaoUnlocked(false); // re-lock after save so next edit needs unlock again
        router.refresh();
        // Auto-clear the saved indicator after a moment so the user
        // doesn't see "Gespeichert" hours later if they leave the page open.
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Airline-Einstellungen</h2>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded border bg-red-500/10 border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 px-4 py-3 rounded border bg-green-500/10 border-green-500/30 text-green-300 text-sm">
          ✓ Gespeichert
        </div>
      )}

      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Name
          </label>
          <input
            type="text"
            name="name"
            required
            minLength={2}
            maxLength={80}
            defaultValue={initial.name}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            ICAO Code
          </label>
          <input
            type="text"
            name="icao"
            required
            minLength={3}
            maxLength={4}
            pattern="[A-Z]{3,4}"
            defaultValue={initial.icao}
            disabled={!icaoUnlocked}
            placeholder="z. B. DLH"
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase focus:border-indigo-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <label className="flex items-start gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={icaoUnlocked}
              onChange={(e) => setIcaoUnlocked(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-gray-500">
              ICAO bearbeiten — wird sofort in Dashboard, Bookings, ATC-Callsigns
              und SimBrief OFP sichtbar. 3-4 Großbuchstaben (A-Z), z. B. DLH, BAW.
            </span>
          </label>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Callsign
            </label>
            <input
              type="text"
              name="callsign"
              maxLength={20}
              defaultValue={initial.callsign ?? ''}
              placeholder="z. B. LUFTHANSA"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Wird in ATC-Communication verwendet
            </p>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              IATA Code
            </label>
            <input
              type="text"
              name="iata"
              maxLength={2}
              pattern="[A-Z0-9]{2}"
              defaultValue={initial.iata ?? ''}
              placeholder="z. B. LH"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              2-stelliger IATA-Code (optional)
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Logo URL
          </label>
          <input
            type="url"
            name="logoUrl"
            maxLength={500}
            defaultValue={initial.logoUrl ?? ''}
            placeholder="https://example.com/logo.png"
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional. URL zu einem öffentlich erreichbaren Bild.
          </p>
        </div>

        {/* Welle 8: Branding section. Visually separated from the
            identity-fields above because these only affect the public
            airline-page (/a/[icao]) — admin should be aware they're
            editing the public-facing presentation, not internal config. */}
        <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold mb-3">Branding (Public)</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Tagline
              </label>
              <input
                type="text"
                name="tagline"
                maxLength={120}
                defaultValue={initial.tagline ?? ''}
                placeholder="z. B. Das Tor zur Welt"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Ein Satz, der unter dem Airline-Namen auf der public-page
                erscheint. Max 120 Zeichen.
              </p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Beschreibung
              </label>
              <textarea
                name="description"
                maxLength={2000}
                rows={4}
                defaultValue={initial.description ?? ''}
                placeholder="Kurze Vorstellung der Airline. Wird auf der public-page als Fließtext angezeigt."
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none resize-y"
              />
              <p className="text-xs text-gray-500 mt-1">
                Plain text, max 2000 Zeichen. Markdown wird (noch) nicht
                gerendert.
              </p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Website
              </label>
              <input
                type="url"
                name="websiteUrl"
                maxLength={500}
                defaultValue={initial.websiteUrl ?? ''}
                placeholder="https://example.com"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Primärfarbe
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    name="primaryColor"
                    defaultValue={initial.primaryColor ?? '#4F46E5'}
                    className="h-10 w-16 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 cursor-pointer"
                  />
                  <span className="text-xs text-gray-500 font-mono">
                    {initial.primaryColor ?? 'Standard'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Akzent auf Buttons, Links und Header der public-page.
                </p>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Sekundärfarbe
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    name="secondaryColor"
                    defaultValue={initial.secondaryColor ?? '#1F2937'}
                    className="h-10 w-16 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 cursor-pointer"
                  />
                  <span className="text-xs text-gray-500 font-mono">
                    {initial.secondaryColor ?? 'Standard'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Hintergrund-Akzent (Cards, Footer).
                </p>
              </div>
            </div>

            {/* Visibility toggle. Stored DB-side as publicVisible boolean
                (default true), but presented as the inverted action
                "verstecken" so the checkbox semantics match user intent.
                See handleSubmit() for the inversion logic. */}
            <div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="publicHidden"
                  defaultChecked={!initial.publicVisible}
                  className="mt-0.5"
                />
                <span className="text-xs text-gray-500">
                  <strong className="block text-sm text-gray-700 dark:text-gray-300 mb-0.5">
                    Airline verstecken
                  </strong>
                  Wenn aktiviert, ist die airline nicht im /airlines-Verzeichnis
                  auffindbar und /a/{initial.icao} liefert 404. Members und Admin
                  bleiben unverändert eingeloggt — nur die public-pages werden
                  ausgeblendet.
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold transition disabled:opacity-50"
          >
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </form>
    </div>
  );
}
