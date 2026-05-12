import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma, BookingState } from '@vam/db';
import { z } from 'zod';
import Link from 'next/link';
import { buildSimBriefDispatchUrl } from '@/lib/simbrief/buildDispatchUrl';
import { buildSimBriefFormFields } from '@/lib/simbrief/buildFormFields';
import {
  parseSimBriefOverlay,
  resolveSimBriefOverlay,
} from '@/lib/simbrief/overlay';
import { refreshSimBriefOfp, processSimBriefCallback, cloneBooking } from '../actions';
import { SimBriefDispatchForm } from './SimBriefDispatchForm';
import { OfpSummary } from '@/components/OfpSummary';
import { CancelBookingDialog } from './CancelBookingDialog';
import { RoutePreviewMap } from './route-preview-map';
import { WeatherBriefing } from './weather-briefing';
import { AlternatePicker } from './alternate-picker';
import { RecentItemTracker } from '@/components/recent-item-tracker';

function stateStyle(state: BookingState): { className: string; label: string } {
  switch (state) {
    case 'Created':
      return {
        className: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
        label: 'Erstellt',
      };
    case 'SimBriefDispatched':
      return {
        className: 'bg-green-500/10 border-green-500/30 text-green-400',
        label: 'OFP geplant',
      };
    case 'InProgress':
      // Multi-leg tour-state (option #12). Cyan = mid-tour, distinct
      // from planning-blue/green and abgeschlossen-grey. Single-leg
      // bookings (legCount=1) never enter InProgress.
      return {
        className: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
        label: 'Tour läuft',
      };
    case 'Cancelled':
      return {
        className: 'bg-red-500/10 border-red-500/30 text-red-400',
        label: 'Storniert',
      };
    case 'Completed':
      return {
        className: 'bg-gray-500/10 border-gray-500/30 text-gray-500 dark:text-gray-400',
        label: 'Abgeschlossen',
      };
    case 'Expired':
      return {
        className: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
        label: 'Abgelaufen',
      };
  }
}

export default async function BookingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ofp_id?: string; ofp_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const { id } = await params;
  const { ofp_id: ofpIdParam, ofp_error: ofpErrorParam } = await searchParams;

  // Pattern Z popup callback: when the popup closes the vendored JS sends
  // the user back here with `?ofp_id=…`. Handle it before the rest of the
  // page renders so we redirect to the clean URL on success — and on
  // failure surface the reason via `?ofp_error=…` so the page can render
  // a banner instead of swallowing it silently.
  //
  // The redirect() call MUST live outside the try/catch: it throws
  // NEXT_REDIRECT which Next.js relies on to perform the redirect, and
  // the catch block would otherwise swallow it.
  if (ofpIdParam) {
    let callbackError: string | null = null;
    try {
      await processSimBriefCallback({ bookingId: id, ofpId: ofpIdParam });
    } catch (err) {
      console.error('[Pattern Z] processSimBriefCallback failed:', err);
      // Convert known error shapes to user-friendly strings. Zod's default
      // err.message is a JSON.stringified issues array which surfaces raw
      // schema internals to the user — not appropriate for the URL banner.
      // Map specific Zod field-failures to plain-language messages; fall
      // back to err.message for thrown Errors (static_id mismatch, fetch
      // status, state guard) which are already short human-readable.
      let raw: string;
      if (err instanceof z.ZodError) {
        const first = err.issues[0];
        const field = first?.path.join('.') || 'input';
        raw =
          field === 'ofpId'
            ? 'Invalid SimBrief OFP-ID format in callback URL'
            : field === 'bookingId'
              ? 'Invalid booking ID in callback URL'
              : `Invalid ${field}: ${first?.message ?? 'unknown'}`;
      } else if (err instanceof Error) {
        raw = err.message;
      } else {
        raw = 'Unknown error';
      }
      // Cap message length to avoid pushing pathological errors into the
      // URL bar.
      callbackError = raw.slice(0, 200);
    }
    redirect(
      callbackError
        ? `/bookings/${id}?ofp_error=${encodeURIComponent(callbackError)}`
        : `/bookings/${id}`,
    );
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true },
  });
  if (!currentUser) redirect('/');

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      route: {
        include: {
          departure: true,
          arrival: true,
          aircraft: true,
        },
      },
      airline: true,
      user: { select: { id: true, name: true, simBriefUsername: true } },
      flightPlanCache: true,
    },
  });

  if (!booking) notFound();
  if (
    booking.userId !== currentUser.id ||
    booking.airlineId !== currentUser.airlineId
  ) {
    redirect('/');
  }

  const isFinalState =
    booking.state === 'Cancelled' ||
    booking.state === 'Completed' ||
    booking.state === 'Expired';
  const style = stateStyle(booking.state);

  // Resolve SimBrief Override-Hierarchie. Four entities contribute (in
  // ascending precedence): Airline → Fleet (looked up by airlineId+type)
  // → Aircraft → Route. The Fleet lookup is the only extra DB roundtrip
  // here — the other three came along with the booking-include above.
  // We only do the lookup when there's an aircraft (otherwise the overlay
  // would have nothing to attach to anyway, since SimBrief dispatch
  // requires an aircraft type).
  const fleet = booking.route.aircraft
    ? await prisma.fleet.findUnique({
        where: {
          airlineId_type: {
            airlineId: booking.airlineId,
            type: booking.route.aircraft.type,
          },
        },
        select: { simBriefOverlay: true },
      })
    : null;

  const resolvedOverlay = resolveSimBriefOverlay(
    parseSimBriefOverlay(booking.airline.simBriefOverlay),
    parseSimBriefOverlay(fleet?.simBriefOverlay),
    parseSimBriefOverlay(booking.route.aircraft?.simBriefOverlay),
    parseSimBriefOverlay(booking.route.simBriefOverlay),
  );

  const dispatchUrl =
    booking.route.aircraft && !isFinalState
      ? buildSimBriefDispatchUrl({
          bookingId: booking.id,
          airline: { icao: booking.airline.icao },
          route: { flightNumber: booking.route.flightNumber },
          aircraft: {
            type: booking.route.aircraft.type,
            registration: booking.route.aircraft.registration,
          },
          departure: { icao: booking.route.departure.icao },
          arrival: { icao: booking.route.arrival.icao },
          user: { name: booking.user.name },
          scheduledDeparture: booking.scheduledDeparture,
          overlay: resolvedOverlay,
        })
      : null;

  // Pattern Z is only offered when an API key is configured AND the user
  // has a SimBrief username on file (the popup flow requires the user to
  // already be — or be willing to log in as — a real SimBrief account).
  // The env-check happens server-side; the client never learns whether a
  // key is set, only whether the form renders.
  const patternZAvailable =
    !!process.env.SIMBRIEF_API_KEY &&
    !!booking.user.simBriefUsername &&
    !!booking.route.aircraft &&
    !isFinalState;

  const patternZFields =
    patternZAvailable && booking.route.aircraft
      ? buildSimBriefFormFields({
          bookingId: booking.id,
          airline: { icao: booking.airline.icao },
          route: { flightNumber: booking.route.flightNumber },
          aircraft: {
            type: booking.route.aircraft.type,
            registration: booking.route.aircraft.registration,
          },
          departure: { icao: booking.route.departure.icao },
          arrival: { icao: booking.route.arrival.icao },
          user: { name: booking.user.name },
          scheduledDeparture: booking.scheduledDeparture,
          overlay: resolvedOverlay,
        })
      : null;

  const bookingId = booking.id;
  async function refreshAction() {
    'use server';
    await refreshSimBriefOfp({ bookingId });
  }
  async function cloneAction() {
    'use server';
    const result = await cloneBooking({ bookingId });
    redirect(`/bookings/${result.id}`);
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      {/* Track 4 #71 (Section N): Recently-Viewed tracker. Schreibt diese
          booking als "kürzlich besucht" in den localStorage (LRU, dedup
          auf id+type). Renders nichts visuell — pure-side-effect. Wird
          oben im main-tree platziert damit der effect garantiert vor
          dem rest des render-trees landet. */}
      <RecentItemTracker
        id={booking.id}
        type="booking"
        label={`${booking.route.flightNumber} ${booking.route.departure.icao}→${booking.route.arrival.icao}`}
        subLabel={style.label}
        href={`/bookings/${booking.id}`}
      />
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold font-mono">
                {booking.route.flightNumber}
              </h1>
              <span
                className={`px-3 py-1 rounded text-xs font-semibold border ${style.className}`}
              >
                {style.label}
              </span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Erstellt am{' '}
              {new Date(booking.createdAt).toLocaleString('de-DE', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Zurück
          </Link>
        </header>

        {/* Pattern Z callback error — set by `processSimBriefCallback` failure
            in the if(ofpIdParam) block above. Rendered as a dismissable banner
            so the user knows why the popup flow did not produce a cached OFP
            and can decide whether to retry, fall back to Pattern α, or open
            an issue. The "Schließen" link strips the query param without a
            client-side handler. */}
        {ofpErrorParam && (
          <section className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-red-400 mb-1">
                SimBrief-Callback fehlgeschlagen
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 break-words">
                {ofpErrorParam}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Tipp: Falls dieser Fehler bleibt, kannst du den
                Tab-Redirect (Pattern α) als Fallback nutzen.
              </p>
            </div>
            <Link
              href={`/bookings/${booking.id}`}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm flex-shrink-0"
            >
              Schließen
            </Link>
          </section>
        )}

        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between gap-8">
            <div className="text-center flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Departure
              </p>
              <p className="text-3xl font-bold font-mono">
                {booking.route.departure.icao}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
                {booking.route.departure.name}
              </p>
              {booking.route.departure.city && (
                <p className="text-xs text-gray-500 mt-1">
                  {booking.route.departure.city}
                </p>
              )}
            </div>

            <div className="flex-1 max-w-xs">
              <div className="border-t-2 border-dashed border-gray-300 dark:border-gray-700 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-900 px-3">
                  <span className="text-2xl">✈️</span>
                </div>
              </div>
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-5">
                {booking.route.distanceNm
                  ? `${booking.route.distanceNm} nm`
                  : '—'}
              </p>
            </div>

            <div className="text-center flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Arrival
              </p>
              <p className="text-3xl font-bold font-mono">
                {booking.route.arrival.icao}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
                {booking.route.arrival.name}
              </p>
              {booking.route.arrival.city && (
                <p className="text-xs text-gray-500 mt-1">
                  {booking.route.arrival.city}
                </p>
              )}
            </div>
          </div>

          {/* Track 4 #65 (Section M): Route-Preview-Map. Inline-SVG mit
              great-circle-route zwischen DEP+ARR. Server-rendered, kein
              external map-tile-service nötig. Sichtbar direkt unter den
              ICAO-textblocks für räumlichen kontext "wo geht's hin". */}
          <div className="mt-6">
            <RoutePreviewMap
              departure={{
                icao: booking.route.departure.icao,
                name: booking.route.departure.name,
                lat: booking.route.departure.latitude,
                lon: booking.route.departure.longitude,
              }}
              arrival={{
                icao: booking.route.arrival.icao,
                name: booking.route.arrival.name,
                lat: booking.route.arrival.latitude,
                lon: booking.route.arrival.longitude,
              }}
              distanceNm={booking.route.distanceNm}
            />
          </div>
        </section>

        {/* Track 5 #16 (Section D) — Weather Briefing. METAR-cards für
            DEP + ARR, direkt nach dem RoutePreviewMap. "wo flieg ich hin"
            + "wie sieht's da aus" gehört zusammen. Server-component,
            zieht decoded METARs aus dem bot-cache (60s revalidate). */}
        <WeatherBriefing
          departureIcao={booking.route.departure.icao}
          arrivalIcao={booking.route.arrival.icao}
        />

        {/* Track 5 #18 (Section D) — Alternate-Picker. Zeigt nächste
            6 commercially-served airports im 30-200nm radius um arrival,
            mit METAR-badges pro alternate. Pure geo-aggregator über
            Airport-tabelle (Haversine + bounding-box). DEP wird
            ausgeschlossen (trivial-circular alternate). Hidden wenn
            keine alternates in range gefunden. */}
        <AlternatePicker
          arrivalIcao={booking.route.arrival.icao}
          departureIcao={booking.route.departure.icao}
        />

        {/* Tour-Progress (option #17). Only rendered for multi-leg bookings
            (legCount > 1) — single-leg bookings see no extra card and the
            page looks identical to before this commit. The card shows:

            - Leg counter "Leg 2 / 4" — current position in the tour.
              "Current" = legsCompleted + 1, because legsCompleted reflects
              what's already done; the next PIREP file becomes that leg.
              For a finished tour (state=Completed) we show "Tour
              abgeschlossen" instead — legsCompleted == legCount and there
              is no "next" leg.

            - Progress bar — visual % of completion. Cyan to match the
              "Tour läuft" badge color used in the booking-list page.

            - Per-leg dots underneath — N filled circles for completed,
              N empty for remaining. Lets the pilot count at a glance
              without doing the math, and surfaces the structure of the
              tour even when it's just N×same-route. */}
        {booking.legCount > 1 && (
          <section className="bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-900/50 rounded-lg p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm uppercase tracking-wider text-cyan-700 dark:text-cyan-400 mb-1">
                  Tour-Progress
                </h2>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {booking.state === 'Completed'
                    ? 'Tour abgeschlossen'
                    : `Leg ${Math.min(booking.legsCompleted + 1, booking.legCount)} / ${booking.legCount}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Abgeschlossen
                </p>
                <p className="text-3xl font-bold font-mono text-cyan-700 dark:text-cyan-400">
                  {booking.legsCompleted}
                  <span className="text-gray-400 dark:text-gray-600 text-xl">
                    /{booking.legCount}
                  </span>
                </p>
              </div>
            </div>

            {/* Progress bar — pure CSS width-percentage calc, no client-
                side JS needed. Rounded to nearest %; for legCount=10 each
                leg adds 10% which divides cleanly. */}
            <div className="h-2 bg-cyan-100 dark:bg-cyan-900/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 dark:bg-cyan-400 rounded-full transition-all"
                style={{
                  width: `${Math.round((booking.legsCompleted / booking.legCount) * 100)}%`,
                }}
              />
            </div>

            {/* Per-leg dots. Visual sugar for sub-10 tour-lengths — the
                schema caps legCount at 10 (see CreateBookingSchema in
                actions.ts) so this never grows past 10 dots. flex-wrap is
                a defensive belt for future cap-bumps. */}
            <div className="flex flex-wrap gap-2 mt-4">
              {Array.from({ length: booking.legCount }, (_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full ${
                    i < booking.legsCompleted
                      ? 'bg-cyan-500 dark:bg-cyan-400'
                      : 'bg-cyan-200 dark:bg-cyan-900/50 border border-cyan-300 dark:border-cyan-800'
                  }`}
                  title={
                    i < booking.legsCompleted
                      ? `Leg ${i + 1} abgeschlossen`
                      : `Leg ${i + 1} ausstehend`
                  }
                />
              ))}
            </div>

            {booking.state !== 'Completed' && (
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-4">
                Diese Tour besteht aus {booking.legCount} Legs auf der
                gleichen Route. Nach jedem PIREP wird der Counter um 1 erhöht
                und das Booking bleibt auf <code className="text-gray-700 dark:text-gray-300">Tour
                läuft</code> bis das letzte Leg gefiled ist.
              </p>
            )}
          </section>
        )}

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Aircraft
            </h2>
            {booking.route.aircraft ? (
              <>
                <p className="text-2xl font-mono font-bold">
                  {booking.route.aircraft.registration}
                </p>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  {booking.route.aircraft.type}
                </p>
              </>
            ) : (
              <p className="text-gray-500">—</p>
            )}
          </section>

          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Pilot
            </h2>
            <p className="text-lg font-semibold">
              {booking.user.name ?? 'Unbenannt'}
            </p>
            <p className="text-xs text-gray-500 mt-2">{booking.airline.name}</p>
          </section>

          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Network
            </h2>
            <p className="text-2xl font-bold">
              {booking.intendedNetwork ?? '—'}
            </p>
          </section>
        </div>

        {/* SimBrief — Pattern α core. Decision tree:
            (1) final state → read-only OFP if cached
            (2) no simBriefUsername → settings prompt
            (3) cache exists → OFP summary + Refresh + Re-plan
            (4) else → ready to plan */}
        {isFinalState ? (
          <>
            {booking.flightPlanCache && (
              <OfpSummary cache={booking.flightPlanCache} />
            )}
            {/* Clone-Action — Final-state bookings sind "done". Der User
                will diesen Flug oft nochmal fliegen (z.B. Daily-Routine
                oder PIREP wurde gefiled, neuer Booking für morgen). Der
                Button erstellt eine Kopie mit gleicher Route + intended
                Network, aber genullt scheduledDeparture (User wählt neue
                Zeit). Active-booking-guard in cloneBooking() blockiert
                falls der User noch ein offenes Booking hat. */}
            <section className="mt-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
              <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">
                Diesen Flug nochmal fliegen
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                Erstellt eine Kopie mit gleicher Route und Aircraft.
                Geplante Abflugzeit wird zurückgesetzt — du wählst eine
                neue Zeit (oder lässt sie leer).
              </p>
              <form action={cloneAction}>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm font-medium transition"
                >
                  ↻ Booking klonen
                </button>
              </form>
            </section>
          </>
        ) : !booking.user.simBriefUsername ? (
          <section className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-yellow-400 mb-3">
              SimBrief noch nicht eingerichtet
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              Trage deinen SimBrief-Benutzernamen in den Settings ein um Pattern α
              nutzen zu können.
            </p>
            <Link
              href="/settings"
              className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm transition"
            >
              → Settings öffnen
            </Link>
          </section>
        ) : booking.flightPlanCache ? (
          <OfpSummary
            cache={booking.flightPlanCache}
            actions={
              <div className="flex flex-col gap-3 w-full">
                <div className="flex gap-3">
                  <form action={refreshAction}>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                    >
                      ↻ Refresh OFP
                    </button>
                  </form>
                  {patternZFields ? (
                    <SimBriefDispatchForm
                      fields={patternZFields}
                      referralPage={`/bookings/${booking.id}`}
                      buttonLabel="Plan again →"
                      buttonClassName="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                    />
                  ) : (
                    dispatchUrl && (
                      <a
                        href={dispatchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                      >
                        Plan again →
                      </a>
                    )
                  )}
                </div>
                {/* Pattern Z fallback hint — symmetric with the fresh-booking
                    case below. Pattern Z's vendored simbrief.apiv1.js shows
                    a native browser alert() if window.open() returns null,
                    which is dismissible but doesn't tell the user how to
                    proceed. This inline link gives them the escape hatch
                    explicitly: a regular target="_blank" anchor isn't
                    affected by popup-blockers because it's user-initiated
                    navigation, not scripted window.open(). */}
                {patternZFields && dispatchUrl && (
                  <p className="text-xs text-gray-500">
                    Popup blockiert?{' '}
                    <a
                      href={dispatchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      Im neuen Tab öffnen (Pattern α)
                    </a>{' '}
                    und danach &quot;Refresh OFP&quot; klicken.
                  </p>
                )}
              </div>
            }
          />
        ) : (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Flight Plan
            </h2>
            {patternZFields ? (
              <>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  Klicke auf &quot;Generate Flight Plan&quot;. Ein kleines
                  Popup-Fenster öffnet sich für SimBrief — sobald der Plan
                  fertig ist schließt es sich automatisch und du landest
                  wieder hier.
                </p>
                <SimBriefDispatchForm
                  fields={patternZFields}
                  referralPage={`/bookings/${booking.id}`}
                />
                {dispatchUrl && (
                  <p className="text-xs text-gray-500 mt-3">
                    Popup-Blocker aktiv?{' '}
                    <a
                      href={dispatchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      Im neuen Tab öffnen (Pattern α)
                    </a>{' '}
                    und danach &quot;Refresh OFP&quot; klicken.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  Klicke auf &quot;Plan via SimBrief&quot; um deinen Flight
                  Plan auf simbrief.com zu erstellen.
                </p>
                {dispatchUrl && (
                  <a
                    href={dispatchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded font-medium transition"
                  >
                    Plan via SimBrief →
                  </a>
                )}
                <p className="text-xs text-gray-500 mt-3">
                  Öffnet einen neuen Tab. Nach dem Generieren auf SimBrief klicke
                  unten &quot;Refresh OFP&quot; um den Plan zu laden.
                </p>
              </>
            )}
            <form
              action={refreshAction}
              className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800"
            >
              <button
                type="submit"
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                ↻ Refresh OFP
              </button>
            </form>
          </section>
        )}

        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Metadaten
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Erstellt
              </p>
              <p className="text-gray-700 dark:text-gray-300">
                {new Date(booking.createdAt).toLocaleString('de-DE')}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Läuft ab
              </p>
              <p className="text-gray-700 dark:text-gray-300">
                {new Date(booking.expiresAt).toLocaleString('de-DE')}
              </p>
            </div>
            {booking.scheduledDeparture && (
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Geplante Abflugzeit
                </p>
                <p className="text-gray-700 dark:text-gray-300">
                  {new Date(booking.scheduledDeparture).toLocaleString('de-DE', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  })}
                  <span className="ml-2 text-xs text-gray-500 font-mono">
                    (
                    {new Date(booking.scheduledDeparture).toLocaleString('de-DE', {
                      timeZone: 'UTC',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    Z)
                  </span>
                </p>
              </div>
            )}
            {booking.dispatchedAt && (
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Dispatched
                </p>
                <p className="text-gray-700 dark:text-gray-300">
                  {new Date(booking.dispatchedAt).toLocaleString('de-DE')}
                </p>
              </div>
            )}
            {booking.cancelledAt && (
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Storniert
                </p>
                <p className="text-gray-700 dark:text-gray-300">
                  {new Date(booking.cancelledAt).toLocaleString('de-DE')}
                </p>
              </div>
            )}
            {booking.cancellationReason && (
              <div className="col-span-2">
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Stornierungsgrund
                </p>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {booking.cancellationReason}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Cancel-Booking action — only available for active bookings.
            Server-side state-guard in cancelBooking() also rejects non-
            cancellable states, so this is just UI hygiene (don't render
            buttons for actions that won't work). Final-state bookings
            already display Stornierungsgrund + Storniert-am in metadata
            above; nothing more to do for them. */}
        {!isFinalState && (
          <section className="mt-8 flex justify-end">
            <CancelBookingDialog
              bookingId={booking.id}
              flightNumber={booking.route.flightNumber}
            />
          </section>
        )}
      </div>
    </main>
  );
}
