import type { ReactNode } from 'react';
import { Plane, AlertTriangle, MessageSquareWarning } from 'lucide-react';

/**
 * Welle B — B4 phase 3. PIREP aircraft-substitution card.
 *
 * Renders the disposition the pilot picked in the ACARS-client's
 * pre-flight mismatch dialog (B4 P2C, VamAcarsClient/AircraftSubstitution-
 * Dialog.xaml). The dialog fires when the sim-loaded aircraft type
 * differs from the booked aircraft type at Verbinden-click time; the
 * pilot picks one of three paths:
 *
 *   - "intentional"  → flew on purpose (livery, training, mood). Optional
 *                      free-text reason.
 *   - "wrongBooking" → believes the booking is wrong; admin should
 *                      reconcile. No reason field; the disposition IS
 *                      the signal.
 *   - (the third path "wrongLoaded" aborts the connect-flow client-side
 *      and never reaches the server, so it doesn't show up here.)
 *
 * # Data source
 *
 * `LiveSession.aircraftSubstitution` Json column, populated by the
 * heartbeat-route when the ACARS client ships an aircraftSubstitution
 * block (B4 P1 server-side, see apps/web/app/api/acars/heartbeat/route.ts).
 * Null for the common case (no mismatch / no dialog shown / pre-B4
 * session); the parent page hides the card in those cases.
 *
 * # Visual treatment
 *
 * - intentional → blue accent (informational, pilot's own call)
 * - wrongBooking → red accent + warning icon (admin-flag, action item)
 *
 * Booked/flown types render side-by-side as the dialog displayed them,
 * so the PIREP page reads as a faithful transcript of the pilot's
 * pre-flight decision. Reason text (intentional path only) goes
 * below in a quoted block — pilot's own words, no editing.
 *
 * # Why this card exists
 *
 * Before B4, when a pilot flew the "wrong" aircraft, the PIREP arrived
 * with the flown aircraft populated and no signal whatsoever about
 * intent. Admins had to either accept-as-is (charitable but blind) or
 * reject-and-DM-the-pilot (annoying and slow). The substitution card
 * surfaces the pilot's own pre-flight reasoning so admins can act on
 * structured intent rather than guessing — "I picked this livery for
 * training" is self-explanatory; "the booking aircraft is wrong"
 * routes the issue straight to the admin queue.
 *
 * # Conditional rendering
 *
 * Caller should only render when `liveSession.aircraftSubstitution`
 * is non-null. The component defensively returns null on null/missing
 * data so a caller-side mistake doesn't render a broken card.
 */

/** Shape of LiveSession.aircraftSubstitution Json after the heartbeat-route writes it. */
export type AircraftSubstitution = {
  /**
   * One of "intentional" or "wrongBooking" — matches the server-side
   * zod enum on the heartbeat payload. "wrongLoaded" never reaches the
   * server (the ACARS client aborts the connect-flow on that disposition),
   * so we don't render for it.
   */
  intent: 'intentional' | 'wrongBooking';
  /** Aircraft type from the booking at dialog-confirm time (e.g. "A20N"). */
  bookedAircraftType: string;
  /** Sim-loaded aircraft type at dialog-confirm time (e.g. "B738"). */
  flownAircraftType: string;
  /**
   * Free-text reason the pilot supplied (intentional path only, optional).
   * Server-side zod caps at 200 chars; we render verbatim.
   */
  reason?: string | null;
};

export type AircraftSubstitutionCardProps = {
  substitution: AircraftSubstitution;
};

export function AircraftSubstitutionCard({
  substitution,
}: AircraftSubstitutionCardProps): ReactNode {
  // Defensive: the parent page should have null-checked before rendering
  // (Json columns deserialize as JsonValue, the type-narrow lives at
  // the call site). But if a caller passes us a malformed value, fail
  // gracefully rather than crash the whole PIREP page.
  if (
    !substitution ||
    typeof substitution !== 'object' ||
    typeof substitution.bookedAircraftType !== 'string' ||
    typeof substitution.flownAircraftType !== 'string'
  ) {
    return null;
  }

  const isWrongBooking = substitution.intent === 'wrongBooking';

  // Color-coding mirrors the dialog's emotional weight:
  //   - intentional: blue, informational ("pilot's choice noted")
  //   - wrongBooking: red, admin-action ("this needs review")
  //
  // Border + bg use 5-10% opacity to stay subtle in light/dark mode
  // without screaming for attention; the icon + intent-pill carry the
  // saturated color. Same pattern as the Anti-Cheat-Flags card and the
  // approver-info bar elsewhere on this page.
  const accentClasses = isWrongBooking
    ? 'border-red-300/60 dark:border-red-700/40'
    : 'border-blue-300/60 dark:border-blue-700/40';

  const intentPillClasses = isWrongBooking
    ? 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300'
    : 'bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300';

  const intentLabel = isWrongBooking
    ? 'Buchung-Diskrepanz · Admin-Review'
    : 'Beabsichtigt';

  const IntentIcon = isWrongBooking ? MessageSquareWarning : Plane;

  return (
    <section
      className={`bg-white dark:bg-gray-900 border rounded-lg p-6 mb-8 ${accentClasses}`}
    >
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-2">
          {/* Icon stays neutral-gray in the heading; the intent-pill below
              carries the color signal. Keeps the heading-row consistent
              with other cards on this page (Weather, ATC, Phase-Breakdown
              all use a muted icon + uppercase title). */}
          <AlertTriangle
            className="h-4 w-4 text-amber-500"
            aria-hidden="true"
          />
          Flugzeug-Substitution
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 border rounded-md text-xs font-medium ${intentPillClasses}`}
        >
          <IntentIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {intentLabel}
        </span>
      </div>

      {/* Booked vs flown — side-by-side. Same layout the ACARS client's
          dialog uses, so the PIREP page reads as a faithful transcript
          of what the pilot saw at decision-time.

          On mobile (single col), they stack with a divider so the
          comparison still reads top-to-bottom. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4 border border-gray-200 dark:border-gray-700/40">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Gebucht
          </p>
          <p className="text-2xl font-bold font-mono mt-2 leading-tight text-blue-700 dark:text-blue-300 break-all">
            {substitution.bookedAircraftType}
          </p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4 border border-gray-200 dark:border-gray-700/40">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Geflogen
          </p>
          <p
            className={`text-2xl font-bold font-mono mt-2 leading-tight break-all ${
              isWrongBooking
                ? 'text-red-700 dark:text-red-300'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {substitution.flownAircraftType}
          </p>
        </div>
      </div>

      {/* Optional reason (intentional path only). Quoted-style block with
          a left-border, monospace-feel for "pilot's own words". Trim
          whitespace defensively — the client should have done so already
          (OnConfirmClick.normalizeEmptyReason) but defense in depth.

          Skipped entirely for wrongBooking: the disposition itself is
          the signal, and the dialog doesn't even show the textbox
          for that path. */}
      {!isWrongBooking &&
        typeof substitution.reason === 'string' &&
        substitution.reason.trim().length > 0 && (
          <div className="mt-4 pl-4 border-l-2 border-blue-300 dark:border-blue-700/60">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
              Begründung
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {substitution.reason.trim()}
            </p>
          </div>
        )}

      {/* Sublabel: short note explaining WHAT the card means. Different
          text per intent — "pilot chose this on purpose" vs "admin
          should reconcile". Helps both pilots reading their own PIREP
          (oh right, I picked that) and admins reviewing (oh, this is
          the action item). */}
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-4">
        {isWrongBooking
          ? 'Pilot meldet eine Buchungs-Diskrepanz. Bitte Buchung prüfen und ggf. reconciliieren.'
          : 'Pilot hat das geflogene Flugzeug bewusst gewählt — abweichend von der Buchung.'}
      </p>
    </section>
  );
}
