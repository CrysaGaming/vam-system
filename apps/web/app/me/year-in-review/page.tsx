import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

/**
 * Track 4 #57 (Section K): Year-in-Review page.
 *
 * Spotify-Wrapped-style retrospektive für den aktuellen pilot. Aggregiert
 * den januar..dezember des aktuellen jahres (oder eines explizit via
 * ?year=2024 query-param angegebenen).
 *
 * Aggregations alle aus PIREP table (status=Approved):
 *   - Total: flights count + flight-hours sum
 *   - Top-route: meistgeflogene departure→arrival kombination
 *   - Longest flight: einzel-PIREP mit max flightTimeMin
 *   - Most-flown aircraft: meistgenutzter aircraft-type
 *   - Top-airport: meistangeflogener arrival-airport
 *   - Monatlicher distribution (für mini-chart): flights pro monat
 *
 * Layout: hero-card mit jahr + total-stats, dann grid mit den "wins".
 * Bewusst NICHT komplex animiert/swipe-bar wie Spotify-Wrapped — wir
 * sind ein dashboard, kein consumer-app. Klare cards die man scrollen
 * kann reichen.
 *
 * Empty-state: pilot ohne PIREPs im jahr → freundliche message + link
 * zurück zum dashboard. Kein peinliches "0 flights" hero.
 */
export default async function YearInReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const params = await searchParams;
  const requestedYear = params.year ? parseInt(params.year, 10) : NaN;
  const year = Number.isFinite(requestedYear)
    ? requestedYear
    : new Date().getFullYear();

  // Jahres-grenzen: 01.01. 00:00 bis 01.01. nächstes-jahr 00:00 (lokale TZ).
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true },
  });
  if (!user) redirect('/');

  // === Aggregations ===
  // Alle queries parallel via Promise.all für one-roundtrip-latency. Jede
  // query ist self-contained und unabhängig von den anderen.
  const [
    totalStats,
    routeGroups,
    longestFlight,
    aircraftGroups,
    airportGroups,
    monthlyGroups,
  ] = await Promise.all([
    prisma.pirep.aggregate({
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: yearStart, lt: yearEnd },
      },
      _count: { _all: true },
      _sum: { flightTimeMin: true },
    }),

    prisma.pirep.groupBy({
      by: ['routeId'],
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: yearStart, lt: yearEnd },
        routeId: { not: null },
      },
      _count: { routeId: true },
      orderBy: { _count: { routeId: 'desc' } },
      take: 1,
    }),

    prisma.pirep.findFirst({
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: yearStart, lt: yearEnd },
        flightTimeMin: { not: null },
      },
      include: { departure: true, arrival: true, aircraft: true, route: true },
      orderBy: { flightTimeMin: 'desc' },
    }),

    prisma.pirep.groupBy({
      by: ['aircraftId'],
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: yearStart, lt: yearEnd },
        aircraftId: { not: null },
      },
      _count: { aircraftId: true },
      orderBy: { _count: { aircraftId: 'desc' } },
      take: 1,
    }),

    prisma.pirep.groupBy({
      by: ['arrivalId'],
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: yearStart, lt: yearEnd },
      },
      _count: { arrivalId: true },
      orderBy: { _count: { arrivalId: 'desc' } },
      take: 1,
    }),

    // Monthly distribution: Prisma groupBy unterstützt keine date-bucketing
    // nativ. Wir fetchen alle submittedAt-werte und reducen JS-side. Bei
    // < 500 flights/jahr ist das fine; bei power-user mit 2000+/jahr immer
    // noch <50ms.
    prisma.pirep.findMany({
      where: {
        userId: user.id,
        status: 'Approved',
        submittedAt: { gte: yearStart, lt: yearEnd },
      },
      select: { submittedAt: true },
    }),
  ]);

  const totalFlights = totalStats._count._all;
  const totalHours = (totalStats._sum.flightTimeMin ?? 0) / 60;

  // Dereference top-route to full route+airport objects
  const topRouteId = routeGroups[0]?.routeId;
  const topRoute = topRouteId
    ? await prisma.route.findUnique({
        where: { id: topRouteId },
        include: { departure: true, arrival: true },
      })
    : null;
  const topRouteCount = routeGroups[0]?._count.routeId ?? 0;

  const topAircraftId = aircraftGroups[0]?.aircraftId;
  const topAircraft = topAircraftId
    ? await prisma.aircraft.findUnique({
        where: { id: topAircraftId },
        include: { aircraftType: true },
      })
    : null;
  const topAircraftCount = aircraftGroups[0]?._count.aircraftId ?? 0;

  const topAirportId = airportGroups[0]?.arrivalId;
  const topAirport = topAirportId
    ? await prisma.airport.findUnique({ where: { id: topAirportId } })
    : null;
  const topAirportCount = airportGroups[0]?._count.arrivalId ?? 0;

  // Monthly buckets (0-indexed)
  const monthlyBuckets = Array<number>(12).fill(0);
  for (const p of monthlyGroups) {
    const m = p.submittedAt.getMonth();
    monthlyBuckets[m]++;
  }
  const maxMonthly = Math.max(...monthlyBuckets, 1); // /1 statt /0 guard

  const monthNames = [
    'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
    'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
  ];

  const currentYear = new Date().getFullYear();
  const canShowNext = year < currentYear;
  const prevYear = year - 1;
  const nextYear = year + 1;

  // === Empty-state ===
  if (totalFlights === 0) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
        <div className="max-w-2xl mx-auto">
          <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
            <Link
              href="/dashboard"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Dashboard
            </Link>
            <h1 className="text-3xl font-bold mt-4">🎁 Year-in-Review {year}</h1>
          </header>
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-6xl mb-4">📅</p>
            <h2 className="text-xl font-semibold mb-2">
              Keine Flüge in {year}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Du hast in diesem Jahr noch keine genehmigten PIREPs eingereicht.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              <Link
                href={`/me/year-in-review?year=${prevYear}`}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
              >
                ← {prevYear}
              </Link>
              <Link
                href="/pireps/new"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
              >
                Ersten Flug einreichen →
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/me/year-in-review?year=${prevYear}`}
              className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-xs transition"
            >
              ← {prevYear}
            </Link>
            {canShowNext && (
              <Link
                href={`/me/year-in-review?year=${nextYear}`}
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-xs transition"
              >
                {nextYear} →
              </Link>
            )}
          </div>
        </header>

        {/* Hero — jahr + total stats */}
        <section className="relative bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-lg p-8 mb-6 text-white overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute -bottom-12 -right-12 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none"
          />
          <div className="relative">
            <p className="text-sm uppercase tracking-widest opacity-80 mb-2">
              🎁 Year-in-Review
            </p>
            <h1 className="text-5xl md:text-6xl font-bold tabular-nums mb-6">
              {year}
            </h1>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-5xl font-bold tabular-nums">{totalFlights}</p>
                <p className="text-sm opacity-80 mt-1">Flüge in {year}</p>
              </div>
              <div>
                <p className="text-5xl font-bold tabular-nums">
                  {totalHours.toFixed(1)}
                  <span className="text-2xl font-normal opacity-70 ml-1">h</span>
                </p>
                <p className="text-sm opacity-80 mt-1">in der Luft</p>
              </div>
            </div>
          </div>
        </section>

        {/* Wins-grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {topRoute && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
              <p className="text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-semibold mb-3">
                🛫 Lieblings-Route
              </p>
              <p className="text-2xl font-mono font-bold mb-1">
                {topRoute.departure.icao}
                <span className="text-gray-400 mx-2">→</span>
                {topRoute.arrival.icao}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {topRoute.flightNumber} · {topRouteCount}× geflogen
              </p>
            </section>
          )}

          {longestFlight && longestFlight.flightTimeMin && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
              <p className="text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-semibold mb-3">
                ⏱️ Längster Flug
              </p>
              <p className="text-2xl font-bold mb-1 tabular-nums">
                {Math.floor(longestFlight.flightTimeMin / 60)}h{' '}
                {longestFlight.flightTimeMin % 60}min
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                {longestFlight.departure.icao} → {longestFlight.arrival.icao}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                {longestFlight.aircraft?.registration ?? '—'} ·{' '}
                {longestFlight.submittedAt.toLocaleDateString('de-DE', {
                  day: 'numeric',
                  month: 'short',
                })}
              </p>
            </section>
          )}

          {topAircraft && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
              <p className="text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-semibold mb-3">
                ✈️ Lieblings-Flieger
              </p>
              <p className="text-2xl font-bold mb-1">
                {topAircraft.aircraftType?.icaoType ?? topAircraft.registration}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {topAircraft.registration} · {topAircraftCount}× genutzt
              </p>
              {topAircraft.aircraftType?.name && (
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  {topAircraft.aircraftType.name}
                </p>
              )}
            </section>
          )}

          {topAirport && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
              <p className="text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-semibold mb-3">
                🏙️ Meist angeflogen
              </p>
              <p className="text-2xl font-mono font-bold mb-1">
                {topAirport.icao}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {topAirport.name}
                {topAirport.city && ` · ${topAirport.city}`}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                {topAirportCount}× gelandet
              </p>
            </section>
          )}
        </div>

        {/* Monthly bar chart */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <p className="text-xs uppercase tracking-widest text-indigo-600 dark:text-indigo-400 font-semibold mb-4">
            📈 Aktivität pro Monat
          </p>
          <div className="flex items-end justify-between gap-2 h-32">
            {monthlyBuckets.map((count, idx) => {
              // Höhe als prozent von max. Min 4px damit auch 0-monate eine
              // sichtbare baseline haben — sonst wirkt's wie "missing data".
              const heightPct = (count / maxMonthly) * 100;
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center gap-1 min-w-0"
                >
                  <p className="text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400">
                    {count}
                  </p>
                  <div
                    className="w-full bg-gradient-to-t from-indigo-500 to-purple-400 rounded-t transition-all"
                    style={{
                      height: `max(4px, ${heightPct}%)`,
                    }}
                    aria-label={`${count} Flüge im ${monthNames[idx]}`}
                  />
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                    {monthNames[idx]}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
