import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import {
  createBooking,
  createBookingFromScheduledFlight,
  createBookingFromTemplate,
  deleteBookingTemplate,
  saveBookingTemplate,
} from '../actions';
import { RouteSuggestions } from './route-suggestions';

/**
 * /bookings/new — Pilot-facing booking-creation (Welle 1 + Welle 7 commit 7C).
 *
 * Two sections, top-down:
 *   1. "Geplante Flüge" (only shown if airline has bookable scheduled flights):
 *      shows the next ~14 days of available ScheduledFlight slots with a
 *      one-click "Buchen"-button per slot. Booking inherits route + departure
 *      from the slot. No network selector — user can set that on the booking
 *      detail page after creation if needed (YAGNI for 7C).
 *   2. "Free Flight" (always shown): the original Welle-1 form — pick any
 *      active route, optionally set network + scheduled departure manually.
 *
 * If the user already has an active booking, BOTH paths fail server-side at
 * the action layer (active-booking-guard). We don't pre-disable the UI here
 * because re-rendering when state changes elsewhere is expensive and the
 * error message is informative enough.
 *
 * Slot selection: only Planned + bookingId=null + departureTime > now,
 * limited to next 14 days. Sorted ascending by departureTime. Cap at 50
 * rows for v1 — if an airline routinely has more than that bookable in
 * 14 days they probably want a dedicated browse-page (out of scope).
 */
export default async function NewBooking() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: true },
  });
  if (!user || !user.airline) redirect('/dashboard');

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Parallel fetch: routes for free-flight, slots for scheduled-section,
  // templates for the user's personal-shortcuts-section (option #67).
  const [routes, scheduledSlots, templates] = await Promise.all([
    prisma.route.findMany({
      where: { airlineId: user.airline.id, active: true },
      include: { departure: true, arrival: true, aircraft: true },
      orderBy: { flightNumber: 'asc' },
    }),
    prisma.scheduledFlight.findMany({
      where: {
        airlineId: user.airline.id,
        status: 'Planned',
        bookingId: null,
        departureTime: { gte: now, lte: horizonEnd },
      },
      include: {
        route: {
          select: {
            flightNumber: true,
            departure: { select: { icao: true } },
            arrival: { select: { icao: true } },
          },
        },
        preferredAircraft: { select: { registration: true, type: true } },
      },
      orderBy: { departureTime: 'asc' },
      take: 50,
    }),
    // Pilot's personal booking-templates. Newest first so frequently-used
    // ones float to the top after being saved or re-instantiated (updatedAt
    // would also work but createdAt is stable and good enough for v1).
    prisma.bookingTemplate.findMany({
      where: { userId: user.id, airlineId: user.airline.id },
      include: {
        route: {
          select: {
            flightNumber: true,
            departure: { select: { icao: true } },
            arrival: { select: { icao: true } },
            aircraft: { select: { type: true, registration: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  async function submitBooking(formData: FormData) {
    'use server';

    const session = await auth();
    if (!session?.user?.id) redirect('/');

    const routeId = formData.get('routeId');
    const networkRaw = formData.get('intendedNetwork');
    const scheduledRaw = formData.get('scheduledDeparture');
    const legCountRaw = formData.get('legCount');

    if (typeof routeId !== 'string' || routeId === '') {
      throw new Error('Route is required');
    }

    const intendedNetwork =
      networkRaw === 'VATSIM' || networkRaw === 'IVAO'
        ? networkRaw
        : undefined;

    // datetime-local liefert "YYYY-MM-DDTHH:mm" ohne Sekunden + ohne TZ.
    // new Date() interpretiert das als LOCAL time des Servers/Clients —
    // weil Server-Action server-side läuft (Berlin: CEST), wäre das ein
    // Bug-Magnet. Stattdessen: User-Browser sendet local-time string,
    // wir behandeln das als "User-meant-this-instant-in-his-tz" und
    // serialisieren via toISOString() zu UTC. Server's TZ darf egal sein
    // weil new Date('2026-05-01T14:30') auf jedem Node-Server denselben
    // ms-Wert relative zu lokaler TZ liefert — und das ist genau was wir
    // wollen wenn der Server in Berlin läuft (was er tut). Falls Server
    // mal global gehosted wird → datepicker auf Client-Component umstellen
    // und String mit explizitem TZ-Offset senden.
    const scheduledDeparture =
      typeof scheduledRaw === 'string' && scheduledRaw !== ''
        ? new Date(scheduledRaw).toISOString()
        : undefined;

    // Multi-leg tour-count (option #17 UI). Parse to integer, clamp at the
    // schema's [1, 10] range so a tampered form can't bypass server-side
    // validation. Empty/absent → undefined → schema default of 1, identical
    // to legacy single-flight booking.
    const legCount =
      typeof legCountRaw === 'string' && legCountRaw !== ''
        ? Math.max(1, Math.min(10, parseInt(legCountRaw, 10) || 1))
        : undefined;

    const result = await createBooking({
      routeId,
      intendedNetwork,
      scheduledDeparture,
      legCount,
    });

    // Option #67: optional "save as template" checkbox in the same form.
    // We save the template AFTER createBooking succeeds so the user only
    // ends up with a template if the flight itself was actually creatable
    // (no active-booking-guard violation, route still exists, etc.). If
    // saveBookingTemplate throws (e.g., 20-template-limit reached), we
    // swallow + log — the booking is already created and we don't want to
    // redirect-then-throw which would orphan the user on an error page.
    // The redirect below proceeds either way; user can re-save the template
    // from a future booking if they care.
    const saveAsTemplate = formData.get('saveAsTemplate');
    const templateLabel = formData.get('templateLabel');
    if (
      saveAsTemplate === 'on' &&
      typeof templateLabel === 'string' &&
      templateLabel.trim() !== ''
    ) {
      try {
        await saveBookingTemplate({
          label: templateLabel,
          routeId,
          intendedNetwork,
          legCount,
        });
      } catch (err) {
        // Best-effort: don't block redirect on template-save failure.
        // E.g., user hit the 20-template-limit — booking is still valid.
        console.warn('[bookings/new] saveBookingTemplate failed:', err);
      }
    }

    redirect(`/bookings/${result.id}`);
  }

  async function submitScheduledBooking(formData: FormData) {
    'use server';

    const session = await auth();
    if (!session?.user?.id) redirect('/');

    const scheduledFlightId = formData.get('scheduledFlightId');
    if (typeof scheduledFlightId !== 'string' || scheduledFlightId === '') {
      throw new Error('Scheduled flight ID is required');
    }

    const result = await createBookingFromScheduledFlight({
      scheduledFlightId,
    });

    redirect(`/bookings/${result.id}`);
  }

  // Option #67: instantiate booking from template (one-click).
  async function submitTemplateInstantiate(formData: FormData) {
    'use server';

    const session = await auth();
    if (!session?.user?.id) redirect('/');

    const templateId = formData.get('templateId');
    if (typeof templateId !== 'string' || templateId === '') {
      throw new Error('Template ID is required');
    }

    const result = await createBookingFromTemplate({ templateId });
    redirect(`/bookings/${result.id}`);
  }

  // Option #67: delete template (no redirect — page re-renders fresh list).
  async function submitTemplateDelete(formData: FormData) {
    'use server';

    const session = await auth();
    if (!session?.user?.id) redirect('/');

    const templateId = formData.get('templateId');
    if (typeof templateId !== 'string' || templateId === '') {
      throw new Error('Template ID is required');
    }

    await deleteBookingTemplate({ templateId });
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Neues Booking</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Booking für {user.airline.name}
            </p>
          </div>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Abbrechen
          </Link>
        </header>

        {/* Track 5 #17 (Section D) — Route-Suggester. Smart "wo flieg
            ich als nächstes hin"-suggestions ab pilot's currentLocationIcao
            (Welle 4) mit aircraft-availability + familiarity scoring.
            Conditional: section hidden wenn kein location resolvable
            ODER keine routes ab diesem airport. Quick-book "Buchen"-button
            pro card via createBooking server-action. */}
        <RouteSuggestions userId={user.id} airlineId={user.airline.id} />

        {/* Section 0 (option #67): Templates — only when pilot has ≥1 saved */}
        {templates.length > 0 && (
          <section className="mb-8">
            <div className="mb-4">
              <h2 className="text-xl font-semibold">💾 Aus Vorlage</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Deine gespeicherten Buchungsvorlagen — ein Klick erstellt eine
                neue Buchung mit denselben Werten. {templates.length} von 20
                belegt.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {t.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                        {t.route.flightNumber} · {t.route.departure.icao} →{' '}
                        {t.route.arrival.icao}
                      </div>
                    </div>
                    <form action={submitTemplateDelete} className="shrink-0">
                      <input type="hidden" name="templateId" value={t.id} />
                      <button
                        type="submit"
                        title="Vorlage löschen"
                        aria-label="Vorlage löschen"
                        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 opacity-60 group-hover:opacity-100 transition"
                      >
                        ✕
                      </button>
                    </form>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {t.intendedNetwork && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
                        {t.intendedNetwork}
                      </span>
                    )}
                    {t.legCount > 1 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                        {t.legCount} Legs
                      </span>
                    )}
                    {t.route.aircraft && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        {t.route.aircraft.type}
                      </span>
                    )}
                  </div>

                  <form action={submitTemplateInstantiate}>
                    <input type="hidden" name="templateId" value={t.id} />
                    <button
                      type="submit"
                      className="w-full px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition"
                    >
                      🔁 Buchen
                    </button>
                  </form>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              <span className="text-xs text-gray-400 dark:text-gray-600 uppercase tracking-wider">
                Oder
              </span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
          </section>
        )}

        {/* Section 1: Scheduled flights — only when there are bookable slots */}
        {scheduledSlots.length > 0 && (
          <section className="mb-8">
            <div className="mb-4">
              <h2 className="text-xl font-semibold">Geplante Flüge</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Wähle einen flug aus dem schedule deiner airline. Route und
                abflugzeit werden automatisch übernommen. Zeigt die nächsten 14
                tage.
              </p>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-gray-800/50">
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      <th className="px-4 py-3">Datum</th>
                      <th className="px-4 py-3">Zeit (UTC)</th>
                      <th className="px-4 py-3">Flug</th>
                      <th className="px-4 py-3">Aircraft</th>
                      <th className="px-4 py-3 text-right">Aktion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {scheduledSlots.map((s) => (
                      <tr
                        key={s.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition"
                      >
                        <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 tabular-nums">
                          {ymdUtc(s.departureTime)}
                          <div className="text-[10px] text-gray-400 dark:text-gray-600">
                            {WEEKDAY_SHORT_DE[isoWeekdayUtc(s.departureTime)]}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-gray-700 dark:text-gray-300">
                          {hhmmUtc(s.departureTime)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-mono font-semibold">
                            {s.route.flightNumber}
                          </div>
                          <div className="text-xs text-gray-500 font-mono">
                            {s.route.departure.icao} → {s.route.arrival.icao}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400">
                          {s.preferredAircraft ? (
                            <>
                              <div className="font-mono">
                                {s.preferredAircraft.registration}
                              </div>
                              <div className="text-gray-400 dark:text-gray-600 font-mono">
                                {s.preferredAircraft.type}
                              </div>
                            </>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600 italic">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <form action={submitScheduledBooking}>
                            <input
                              type="hidden"
                              name="scheduledFlightId"
                              value={s.id}
                            />
                            <button
                              type="submit"
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition"
                            >
                              Buchen
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
              <span className="text-xs text-gray-400 dark:text-gray-600 uppercase tracking-wider">
                Oder
              </span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            </div>
          </section>
        )}

        {/* Section 2: Free Flight — always shown */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Free Flight</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Wähle eine route und plane deine eigene abflugzeit.
            </p>
          </div>

          <form action={submitBooking} className="space-y-6">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 space-y-5">
              <div>
                <label
                  htmlFor="routeId"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Route
                </label>
                <select
                  id="routeId"
                  name="routeId"
                  required
                  defaultValue=""
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- Route wählen --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.flightNumber} · {r.departure.icao} → {r.arrival.icao}
                      {r.aircraft &&
                        ` · ${r.aircraft.type} ${r.aircraft.registration}`}
                    </option>
                  ))}
                </select>
                {routes.length === 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-2">
                    Keine aktiven Routes verfügbar — Admin muss Routes hinzufügen.
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="intendedNetwork"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Network (optional)
                </label>
                <select
                  id="intendedNetwork"
                  name="intendedNetwork"
                  defaultValue=""
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— Kein Network —</option>
                  <option value="VATSIM">VATSIM</option>
                  <option value="IVAO">IVAO</option>
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  Falls du im Online-Network fliegst. Hint für UI/Filter — actual
                  Network kommt vom PIREP/LiveSession.
                </p>
              </div>

              <div>
                <label
                  htmlFor="scheduledDeparture"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Geplante Abflugzeit (optional)
                </label>
                <input
                  type="datetime-local"
                  id="scheduledDeparture"
                  name="scheduledDeparture"
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Wird als <code className="text-gray-600 dark:text-gray-400">date/deph/depm</code>{' '}
                  an SimBrief übergeben damit METAR/TAF zur richtigen Zeit gezogen
                  werden. Eingabe in deiner lokalen Zeitzone — wird intern als UTC
                  gespeichert.
                </p>
              </div>

              {/* Multi-leg tour input (option #17). Default 1 = legacy single-
                  flight booking — most pilots leave this untouched and won't
                  notice the field. legCount > 1 turns the booking into a
                  same-route-N-times tour: the booking stays InProgress
                  between PIREP files until legsCompleted reaches legCount.
                  Use cases: round-trip practice ("4× EDDF→LEMD-EDDF this
                  weekend"), training repetition, multi-day position-flight
                  exercises. The "same route" limitation is documented inline
                  so pilots don't try to use this for true multi-destination
                  tours (which would need a v2 BookingLeg model). */}
              <div>
                <label
                  htmlFor="legCount"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Tour: Anzahl Legs (optional)
                </label>
                <input
                  type="number"
                  id="legCount"
                  name="legCount"
                  min={1}
                  max={10}
                  defaultValue={1}
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
                <p className="text-xs text-gray-500 mt-2">
                  Standardmäßig <code className="text-gray-600 dark:text-gray-400">1</code> = einzelner
                  Flug. Wenn du dieselbe Route mehrfach hintereinander fliegen
                  willst (z.B. 4× EDDF→LEMD), trag die Anzahl ein. Das Booking
                  bleibt zwischen den Legs auf <code className="text-gray-600 dark:text-gray-400">Tour
                  läuft</code> und schließt erst nach dem letzten PIREP. Max
                  10 Legs pro Booking. Für Touren mit verschiedenen Routen leg
                  bitte separate Bookings an.
                </p>
              </div>

              {/* Option #67: Save as template (optional). Checkbox controls
                  whether the booking-create flow ALSO persists a re-usable
                  template for future one-click instantiation. Label is shown
                  in the "Aus Vorlage"-section at the top of this page after
                  next render. Limit 20 templates per pilot — server-action
                  swallows ZodError silently if hit (best-effort). */}
              <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="saveAsTemplate"
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    💾 Als Vorlage speichern
                  </span>
                </label>
                <div className="mt-2 ml-6">
                  <input
                    type="text"
                    name="templateLabel"
                    maxLength={50}
                    placeholder="z.B. Daily MUC-FRA Morning"
                    className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Optional. Wird nur gespeichert wenn die Checkbox aktiv ist.
                    Max. 50 Zeichen. Du kannst bis zu 20 Vorlagen pro Pilot
                    speichern.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={routes.length === 0}
              className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
            >
              Booking erstellen
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers (local — could move to @/lib/datetime if reused elsewhere)
// ─────────────────────────────────────────────────────────────────────────

function ymdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hhmmUtc(date: Date): string {
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function isoWeekdayUtc(date: Date): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

const WEEKDAY_SHORT_DE: Record<number, string> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
  7: 'So',
};
