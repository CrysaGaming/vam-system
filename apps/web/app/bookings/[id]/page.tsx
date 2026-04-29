import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma, BookingState } from '@vam/db';
import Link from 'next/link';
import { buildSimBriefDispatchUrl } from '@/lib/simbrief/buildDispatchUrl';
import { buildSimBriefFormFields } from '@/lib/simbrief/buildFormFields';
import { refreshSimBriefOfp, processSimBriefCallback } from '../actions';
import { SimBriefDispatchForm } from './SimBriefDispatchForm';

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
    case 'Cancelled':
      return {
        className: 'bg-red-500/10 border-red-500/30 text-red-400',
        label: 'Storniert',
      };
    case 'Completed':
      return {
        className: 'bg-gray-500/10 border-gray-500/30 text-gray-400',
        label: 'Abgeschlossen',
      };
    case 'Expired':
      return {
        className: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
        label: 'Abgelaufen',
      };
  }
}

function formatBlockTime(min: number | null): string {
  if (min === null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
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
      // Cap message length to avoid pushing pathological errors into the
      // URL bar. The known error throws (zod, static_id mismatch, fetch
      // status, state guard) are all short human-readable strings.
      const raw = err instanceof Error ? err.message : 'Unknown error';
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
        })
      : null;

  const bookingId = booking.id;
  async function refreshAction() {
    'use server';
    await refreshSimBriefOfp({ bookingId });
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
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
            <p className="text-gray-400 text-sm">
              Erstellt am{' '}
              {new Date(booking.createdAt).toLocaleString('de-DE', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
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
              <p className="text-sm text-gray-300 break-words">
                {ofpErrorParam}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Tipp: Falls dieser Fehler bleibt, kannst du den
                Tab-Redirect (Pattern α) als Fallback nutzen.
              </p>
            </div>
            <Link
              href={`/bookings/${booking.id}`}
              className="text-gray-400 hover:text-gray-200 text-sm flex-shrink-0"
            >
              Schließen
            </Link>
          </section>
        )}

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between gap-8">
            <div className="text-center flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Departure
              </p>
              <p className="text-3xl font-bold font-mono">
                {booking.route.departure.icao}
              </p>
              <p className="text-sm text-gray-400 mt-3">
                {booking.route.departure.name}
              </p>
              {booking.route.departure.city && (
                <p className="text-xs text-gray-500 mt-1">
                  {booking.route.departure.city}
                </p>
              )}
            </div>

            <div className="flex-1 max-w-xs">
              <div className="border-t-2 border-dashed border-gray-700 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gray-900 px-3">
                  <span className="text-2xl">✈️</span>
                </div>
              </div>
              <p className="text-center text-sm text-gray-400 mt-5">
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
              <p className="text-sm text-gray-400 mt-3">
                {booking.route.arrival.name}
              </p>
              {booking.route.arrival.city && (
                <p className="text-xs text-gray-500 mt-1">
                  {booking.route.arrival.city}
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Aircraft
            </h2>
            {booking.route.aircraft ? (
              <>
                <p className="text-2xl font-mono font-bold">
                  {booking.route.aircraft.registration}
                </p>
                <p className="text-gray-400 mt-1">
                  {booking.route.aircraft.type}
                </p>
              </>
            ) : (
              <p className="text-gray-500">—</p>
            )}
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Pilot
            </h2>
            <p className="text-lg font-semibold">
              {booking.user.name ?? 'Unbenannt'}
            </p>
            <p className="text-xs text-gray-500 mt-2">{booking.airline.name}</p>
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
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
          booking.flightPlanCache && (
            <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8 opacity-75">
              <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
                OFP Summary
              </h2>
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                    OFP ID
                  </p>
                  <p className="font-mono">{booking.flightPlanCache.ofpId}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                    Block Time
                  </p>
                  <p>{formatBlockTime(booking.flightPlanCache.blockTimeMin)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                    Block Fuel
                  </p>
                  <p>
                    {booking.flightPlanCache.fuelKg
                      ? `${booking.flightPlanCache.fuelKg} kg`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                    Generiert
                  </p>
                  <p>
                    {new Date(
                      booking.flightPlanCache.generatedAt,
                    ).toLocaleString('de-DE')}
                  </p>
                </div>
              </div>
              {booking.flightPlanCache.routeString && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                    Route
                  </p>
                  <p className="font-mono text-sm bg-gray-950 border border-gray-800 rounded p-3 break-all">
                    {booking.flightPlanCache.routeString}
                  </p>
                </div>
              )}
            </section>
          )
        ) : !booking.user.simBriefUsername ? (
          <section className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-yellow-400 mb-3">
              SimBrief noch nicht eingerichtet
            </h2>
            <p className="text-gray-300 mb-4">
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
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              OFP Summary
            </h2>
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  OFP ID
                </p>
                <p className="font-mono">{booking.flightPlanCache.ofpId}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Block Time
                </p>
                <p>{formatBlockTime(booking.flightPlanCache.blockTimeMin)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Block Fuel
                </p>
                <p>
                  {booking.flightPlanCache.fuelKg
                    ? `${booking.flightPlanCache.fuelKg} kg`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Generiert
                </p>
                <p>
                  {new Date(
                    booking.flightPlanCache.generatedAt,
                  ).toLocaleString('de-DE')}
                </p>
              </div>
            </div>
            {booking.flightPlanCache.routeString && (
              <div className="mb-6">
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                  Route
                </p>
                <p className="font-mono text-sm bg-gray-950 border border-gray-800 rounded p-3 break-all">
                  {booking.flightPlanCache.routeString}
                </p>
              </div>
            )}
            <div className="flex gap-3 pt-4 border-t border-gray-800">
              <form action={refreshAction}>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
                >
                  ↻ Refresh OFP
                </button>
              </form>
              {dispatchUrl && (
                <a
                  href={dispatchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
                >
                  Plan again →
                </a>
              )}
            </div>
          </section>
        ) : (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Flight Plan
            </h2>
            {patternZFields ? (
              <>
                <p className="text-gray-400 mb-4">
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
                      className="underline hover:text-gray-300"
                    >
                      Im neuen Tab öffnen (Pattern α)
                    </a>{' '}
                    und danach &quot;Refresh OFP&quot; klicken.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-gray-400 mb-4">
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
              className="mt-6 pt-6 border-t border-gray-800"
            >
              <button
                type="submit"
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
              >
                ↻ Refresh OFP
              </button>
            </form>
          </section>
        )}

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Metadaten
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Erstellt
              </p>
              <p className="text-gray-300">
                {new Date(booking.createdAt).toLocaleString('de-DE')}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Läuft ab
              </p>
              <p className="text-gray-300">
                {new Date(booking.expiresAt).toLocaleString('de-DE')}
              </p>
            </div>
            {booking.dispatchedAt && (
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Dispatched
                </p>
                <p className="text-gray-300">
                  {new Date(booking.dispatchedAt).toLocaleString('de-DE')}
                </p>
              </div>
            )}
            {booking.cancelledAt && (
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Storniert
                </p>
                <p className="text-gray-300">
                  {new Date(booking.cancelledAt).toLocaleString('de-DE')}
                </p>
              </div>
            )}
            {booking.cancellationReason && (
              <div className="col-span-2">
                <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Stornierungsgrund
                </p>
                <p className="text-gray-300 whitespace-pre-wrap">
                  {booking.cancellationReason}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
