import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { createBooking, createBookingFromScheduledFlight } from '../actions';

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

  // Parallel fetch: routes for free-flight, slots for scheduled-section.
  const [routes, scheduledSlots] = await Promise.all([
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
  ]);

  async function submitBooking(formData: FormData) {
    'use server';

    const session = await auth();
    if (!session?.user?.id) redirect('/');

    const routeId = formData.get('routeId');
    const networkRaw = formData.get('intendedNetwork');
    const scheduledRaw = formData.get('scheduledDeparture');

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

    const result = await createBooking({
      routeId,
      intendedNetwork,
      scheduledDeparture,
    });

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
