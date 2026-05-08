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

    // Defensive null-coalescing für FormData.get(): disabled inputs werden
    // NICHT in FormData submitted (HTML-spec). icao ist disabled wenn
    // !icaoUnlocked → formData.get('icao') ist null. Pre-existing latent
    // bug der erst mit 13D-1 manifestiert wurde, weil admins jetzt häufiger
    // speichern ohne ICAO zu unlocken (z.B. nur economyEnabled toggle).
    // Fallback auf initial.<field> wo das spec-mässig angemessen ist
    // (sprich: icao wird vom DB-state genommen wenn das input disabled war,
    // wir wollen keine andere semantik dafür).
    const name = ((formData.get('name') as string | null) ?? initial.name).trim();
    const icao = ((formData.get('icao') as string | null) ?? initial.icao).trim().toUpperCase();
    const callsign = ((formData.get('callsign') as string | null) ?? '').trim() || null;
    const iata = ((formData.get('iata') as string | null) ?? '').trim() || null;
    const logoUrl = ((formData.get('logoUrl') as string | null) ?? '').trim() || null;
    // Welle 8 branding fields
    const tagline = ((formData.get('tagline') as string | null) ?? '').trim() || null;
    const description = ((formData.get('description') as string | null) ?? '').trim() || null;
    const websiteUrl = ((formData.get('websiteUrl') as string | null) ?? '').trim() || null;
    const primaryColor =
      ((formData.get('primaryColor') as string | null) ?? '').trim().toUpperCase() || null;
    const secondaryColor =
      ((formData.get('secondaryColor') as string | null) ?? '').trim().toUpperCase() || null;
    // Checkbox: present only when checked. We invert: input is named
    // "publicHidden" (default unchecked = publicVisible=true, the
    // privacy-friendly opt-out). This makes the form control match how
    // a user thinks about the action ("hide my airline").
    const publicVisible = formData.get('publicHidden') !== 'on';

    // Welle 13D-1: Economy-flag. Direkt-checkbox (kein invert) — der
    // admin denkt "economy aktivieren" als positives opt-in, nicht als
    // verstecken. Default beim ersten render = current DB-state, nicht
    // hardcoded false (sonst würde re-saven der form ohne änderung den
    // toggle versehentlich abschalten).
    const economyEnabled = formData.get('economyEnabled') === 'on';
    // Welle 13E-4: Career-flag. Selbes pattern wie economy. Direkt-
    // checkbox, opt-in. Form-checkbox ist additive — bei legacy-airlines
    // ist das field default false und sie sehen den toggle nur wenn sie
    // ihn aktiv anklicken.
    const careerEnabled = formData.get('careerEnabled') === 'on';
    // Option #29: Sub-toggle für strict recency-enforcement. Greift nur
    // wenn careerEnabled=true. Wir lesen das field unabhängig (admin
    // kann ihn vor-aktivieren bevor career on geht) — der booking-gate
    // checkt eh den parent-flag zuerst.
    const enforceTypeRatingCurrency =
      formData.get('enforceTypeRatingCurrency') === 'on';

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
          economyEnabled,
          careerEnabled,
          enforceTypeRatingCurrency,
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

        {/* Welle 13D-1: Economy-section. Eigene section unter Branding,
            visuell getrennt durch border-top weil das ein anderer
            domain-bereich ist (geld + transactions, nicht presentation).
            Aktivieren ist airline-weit — alle members die ihren persönlichen
            economyEnabled-toggle aktiviert haben, bekommen ab dem nächsten
            approved PIREP wallet-bewegungen. Disable wirkt nur prospektiv,
            existing wallets/transactions bleiben in DB als audit-trail. */}
        <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold mb-3">Economy (Beta)</h3>

          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="economyEnabled"
                defaultChecked={initial.economyEnabled}
                className="mt-0.5"
              />
              <span className="text-xs text-gray-500">
                <strong className="block text-sm text-gray-700 dark:text-gray-300 mb-0.5">
                  Economy für diese Airline aktivieren
                </strong>
                Schaltet VAM$-Wallet, Salary-Auszahlungen und Revenue-/
                Expense-Tracking pro Flug für die Airline frei. Beim ersten
                approved PIREP wird automatisch ein Airline-Wallet mit
                Start-Kreditrahmen angelegt. Damit ein Pilot tatsächlich
                Buchungen erhält, muss er ZUSÄTZLICH seinen persönlichen
                Economy-Toggle in den Profil-Einstellungen aktivieren.
                <br />
                <br />
                <em className="not-italic text-gray-400 dark:text-gray-500">
                  Deaktivieren stoppt nur künftige Buchungen — bestehende
                  Wallets und Transaktionen bleiben als Audit-Trail erhalten.
                </em>
              </span>
            </label>
          </div>
        </div>

        {/* Welle 13E-4: Career-section. Mirror'd Economy-pattern: eigene
            section unter Economy, visuell getrennt durch border-top.
            Aktivieren ist airline-weit — der booking-gate (13E-7) prüft
            beim Aircraft-pick ob der pilot die required licenses für den
            type hat. Pilots ohne licenses sehen weiter alle aircraft im
            booking-flow, aber bekommen einen klaren error wenn sie buchen
            wollen ("Du brauchst eine PPL für die C172"). Disable wirkt
            nur prospektiv, existing licenses bleiben in DB. */}
        <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold mb-3">Career-System (Beta)</h3>

          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="careerEnabled"
                defaultChecked={initial.careerEnabled}
                className="mt-0.5"
              />
              <span className="text-xs text-gray-500">
                <strong className="block text-sm text-gray-700 dark:text-gray-300 mb-0.5">
                  Career-System für diese Airline aktivieren
                </strong>
                Schaltet license-basiertes booking-gating frei. Piloten
                können bestimmte aircraft-types nur buchen wenn sie die
                passenden Lizenzen haben (z.B. PPL für Cessna 172, ATPL+
                Type-Rating für Airbus A320). Damit ein Pilot tatsächlich
                gegated wird, muss er ZUSÄTZLICH seinen persönlichen
                Career-Toggle im Profil aktivieren.
                <br />
                <br />
                Geeignet für realistic-airlines mit pilot-progression-
                struktur (Trainee → CPL → ATPL). Nicht empfohlen für
                Casual-/Roleplay-Airlines wo jeder alles fliegen darf.
                <br />
                <br />
                <em className="not-italic text-gray-400 dark:text-gray-500">
                  Deaktivieren entfernt nur das gating für künftige
                  Buchungen — alle vergebenen Lizenzen und Type-Ratings
                  bleiben in der DB als Audit-Trail erhalten und gelten
                  bei einer späteren Re-Aktivierung weiter.
                </em>
              </span>
            </label>
          </div>

          {/* Option #29: Sub-toggle für strict recency-enforcement.
              Visuell eingerückt damit klar wird das ist sub-feature
              vom career-toggle. Greift nur wenn careerEnabled=true,
              sonst ist es no-op (haben wir docstring-mässig dokumentiert
              statt UI-disabling — admin kann es vor-aktivieren).
              Optisch hint via border-l + indent damit es als sub-
              option erkennbar ist. */}
          <div className="mt-4 ml-6 pl-4 border-l-2 border-gray-200 dark:border-gray-800">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="enforceTypeRatingCurrency"
                defaultChecked={initial.enforceTypeRatingCurrency}
                className="mt-0.5"
              />
              <span className="text-xs text-gray-500">
                <strong className="block text-sm text-gray-700 dark:text-gray-300 mb-0.5">
                  Strict Recency-Enforcement (90-Tage-Regel)
                </strong>
                Zusätzlich zu expired type-ratings auch{' '}
                <em className="not-italic">recency-lapsed</em> type-ratings
                blocken: pilot muss in den letzten 90 tagen auf dem type
                geflogen sein, sonst kann er keine neuen bookings für
                diesen aircraft-type erstellen. Booking-error zeigt dann{' '}
                <code className="text-[10px]">
                  Type Rating B738 (recency lapsed)
                </code>{' '}
                in der missing-list.
                <br />
                <br />
                Spiegelt EASA Part-FCL{' '}
                <em className="not-italic">passenger-currency-norm</em>{' '}
                (&quot;3 takeoffs/landings in 90 days for PAX-ops&quot;) als
                vereinfachten lastFlownAt-check. Geeignet für VAs die
                regulatory-realism-mode wollen — pilot muss aktiv auf
                seinen ratings bleiben oder einen{' '}
                <em className="not-italic">recurrent-check</em> machen.
                <br />
                <br />
                Greift nur wenn{' '}
                <strong className="text-gray-700 dark:text-gray-300">
                  Career-System
                </strong>{' '}
                oben aktiviert ist. Pilots die noch nie auf einem rating
                geflogen sind (lastFlownAt=null) gelten als baseline-fresh
                und werden nicht geblockt.
              </span>
            </label>
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
