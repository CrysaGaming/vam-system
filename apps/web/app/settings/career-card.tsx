'use client';

import { useState, useTransition } from 'react';
import { setUserCareerEnabled } from './actions';

interface Props {
  initialEnabled: boolean;
  /**
   * Status der airline-flag (Airline.careerEnabled). Wird vom server-
   * component beim render geladen und runter-gepasst. Wenn user keine
   * airline hat → null.
   */
  airlineCareerEnabled: boolean | null;
  /**
   * Whether der user überhaupt eine airline hat. Wenn null, ist
   * der toggle harmlos aber wirkungslos — wir zeigen einen hint dass
   * eine airline-zugehörigkeit voraussetzung ist.
   */
  hasAirline: boolean;
}

/**
 * Welle 13E-3: User-level career opt-in. Toggle für User.careerEnabled.
 *
 * Mirror'd das EconomyCard-pattern aus 13D-1 — selbe dual-flag-philosophie:
 * BEIDE flags (User.careerEnabled UND Airline.careerEnabled) müssen true
 * sein damit der booking-gate (13E-7) und auto-rank-promotion (13E-9)
 * greifen.
 *
 * Drei UI-states (kombiniert):
 *
 *   1. user-toggle off → grauer button, keine licenses-card im dashboard,
 *      kein /licenses-link in der sidebar, keine type-rating-anzeige bei
 *      bookings. Default für alle existing users.
 *   2. user-toggle on, aber airline.careerEnabled=false → toggle ist
 *      sichtbar an, aber prominenter hint dass die airline-flag noch off
 *      ist. UI zeigt user dass der toggle aktuell wirkungslos ist (keine
 *      booking-gates greifen, keine auto-promotion).
 *   3. beide flags an → career-features sind aktiv. Dashboard zeigt
 *      LicensesCard, /licenses ist erreichbar, booking-flow gated bei
 *      missing-licenses, PIREP-approval inkrementiert hoursOnType.
 *
 * Bewusst NICHT in eine eigene tab eingeordnet: career ist persönlich
 * (wie economy) und gehört in den profil-bereich. Wenn später UI-
 * präferenzen für career dazukommen (z.B. "verstecke type-ratings die
 * ich nicht mehr fliege", "renewal-reminders email"), wird das hier
 * erweitert.
 *
 * Disclaimer-text bewusst klar:
 *   "Existing PIREPs werden NICHT retroaktiv ranked" — wenn user später
 *   aktiviert, fängt die rank-progression bei seinem aktuellen license-
 *   stand an. Keine berechnung für vergangene flüge.
 */
export function CareerCard({
  initialEnabled,
  airlineCareerEnabled,
  hasAirline,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const newValue = !enabled;
    setError(null);

    // Optimistic update — UI flippt sofort, server-action revertiert
    // bei error.
    setEnabled(newValue);

    startTransition(async () => {
      try {
        await setUserCareerEnabled(newValue);
      } catch (e) {
        setEnabled(!newValue); // revert
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  // Hint-zustand: was zeigen wir dem user?
  const hintMessage = (() => {
    if (!enabled) {
      return null;
    }
    if (!hasAirline) {
      return {
        kind: 'warning' as const,
        text:
          'Du bist (noch) keiner Airline zugeordnet — der Toggle ist gesetzt, aber Career-Features greifen erst sobald du einer Airline beitrittst, die Career-Mode aktiviert hat.',
      };
    }
    if (airlineCareerEnabled === false) {
      return {
        kind: 'info' as const,
        text:
          'Deine Airline hat Career-Mode noch nicht aktiviert — License-Gates und Auto-Promotion sind erst aktiv wenn deine Airline-Admin den Toggle in der Airline-Verwaltung umlegt. Dein persönlicher Toggle bleibt vorgemerkt.',
      };
    }
    return {
      kind: 'success' as const,
      text:
        'Career-Features sind aktiv. Buchungen werden gegen deine Lizenzen geprüft, Type-Rating-Stunden werden bei PIREP-Approval automatisch incrementiert, und du wirst nach erreichen der nächsten Rang-Anforderungen befördert.',
    };
  })();

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
        Career (Beta)
      </h2>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Lizenzen, Type-Ratings, License-Gates beim Buchen, automatische
        Rang-Beförderung nach PIREP-Approval, Flugschulen + Prüfungen.
        Aktivieren ist <strong>opt-in</strong> — solange der Toggle aus
        ist, siehst du keine License-UI und Buchungen werden nicht gegen
        Lizenzen geprüft. Existing PIREPs werden <strong>NICHT</strong>{' '}
        retroaktiv für die Rang-Progression gewertet, nur künftige
        Approvals.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-start justify-between gap-4 py-3 border-t border-gray-200 dark:border-gray-800">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Career für mich aktivieren
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Persönlicher Opt-In. Sowohl dieser Toggle als auch der
            Airline-weite Toggle müssen aktiviert sein, damit License-Gates
            und Auto-Promotion wirksam werden.
          </p>
        </div>

        {/* Switch — accessible via keyboard, role=switch, aria-checked.
            Visual: 44×24px track mit thumb. Selbe dimensionen wie
            EconomyCard für visuelle konsistenz im profile-tab. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          disabled={pending}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed ${
            enabled
              ? 'bg-indigo-600'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span className="sr-only">Career aktivieren</span>
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {hintMessage && (
        <div
          className={`mt-4 px-4 py-3 rounded border text-sm ${
            hintMessage.kind === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300'
              : hintMessage.kind === 'warning'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300'
          }`}
        >
          {hintMessage.text}
        </div>
      )}
    </section>
  );
}
