import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { createBooking } from '../actions';

export default async function NewBooking() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: true },
  });
  if (!user || !user.airline) redirect('/dashboard');

  const routes = await prisma.route.findMany({
    where: { airlineId: user.airline.id, active: true },
    include: { departure: true, arrival: true, aircraft: true },
    orderBy: { flightNumber: 'asc' },
  });

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

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-2xl mx-auto">
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
      </div>
    </main>
  );
}
