import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  listSceneries,
  listDistinctProviders,
  getSceneryCounts,
  prisma,
  type SceneryFilter,
} from '@vam/db';

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Public scenery catalog.
 *
 * Zeigt alle kuratierten scenery-empfehlungen in einem grid mit filter-
 * UI (provider, airport-prefix, price-tier, airline-affiliation).
 *
 * # Filter-pattern
 *
 * Filter-state lebt in URL searchparams — kein client-state, kein
 * useState. Submit per <form method=GET>, der server rendert mit den
 * neuen searchparams die gefilterte liste. Vorteile:
 *   - Filter-state ist shareable (URL-link kopieren teilt die view)
 *   - Browser-back navigiert sauber zwischen filter-zuständen
 *   - SSR-friendly, kein hydration-mismatch-risiko
 *   - Reload ruft denselben view auf (no client-state-loss)
 *
 * # MVP-scope
 *
 * Schmal halten — der Scenery-model hat im aktuellen schema nur 7
 * felder (name, airportIcao, provider, url, free, airlineId, createdAt).
 * Card zeigt name + airport + provider + price-badge. Detail-page
 * (/sceneries/[id]) zeigt einfach alles formatiert mit metadata. Kein
 * description, kein image, kein simulator-tag — schema-erweiterung
 * wäre eigene welle.
 *
 * Auth: member-only (login redirect), wie awards-catalog. Sceneries-
 * info ist nicht sensitive aber die admin-link rendering braucht die
 * session sowieso.
 */
export default async function SceneriesCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await searchParams;
  const filter: SceneryFilter = {};

  // Provider-filter: trim+lowercase im backend, hier raw übernehmen
  const providerParam = typeof params.provider === 'string' ? params.provider.trim() : '';
  if (providerParam) filter.provider = providerParam;

  // Airport-filter: trim, accept any length (substring match)
  const airportParam = typeof params.airport === 'string' ? params.airport.trim() : '';
  if (airportParam) filter.airportIcao = airportParam;

  // Price-tier
  const priceParam = typeof params.price === 'string' ? params.price : '';
  if (priceParam === 'free' || priceParam === 'paid') filter.priceTier = priceParam;

  // Airline-filter — drei modi (siehe SceneryFilter-typ).
  const airlineParam = typeof params.airline === 'string' ? params.airline : '';
  if (airlineParam === 'global') {
    filter.airlineId = 'global';
  } else if (airlineParam && airlineParam !== 'all') {
    filter.airlineId = airlineParam;
  }
  // default ("all" oder undefined) → kein airline-filter

  // Parallel fetch: list, providers (für filter-dropdown), counts (für
  // summary-banner), airlines (für filter-dropdown), user-role (für
  // admin-link). Cheap-enough — Scenery + Airline tables sind klein.
  const [sceneries, providers, counts, airlines, currentUser] = await Promise.all([
    listSceneries(filter),
    listDistinctProviders(),
    getSceneryCounts(),
    prisma.airline.findMany({
      select: { id: true, name: true, iata: true, icao: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: { select: { name: true } } },
    }),
  ]);
  const isAdmin = currentUser?.role?.name === 'admin';

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
            <h1 className="text-3xl font-bold">Sceneries</h1>
            {isAdmin && (
              <Link
                href="/admin/sceneries"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition"
              >
                Verwalten
              </Link>
            )}
          </div>
          <p className="text-gray-500 dark:text-gray-400">
            Kuratierte Add-on-Empfehlungen für Routen die wir fliegen.
          </p>
          <p className="text-sm mt-3 text-gray-600 dark:text-gray-400">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {counts.free}
            </span>{' '}
            kostenlos ·{' '}
            <span className="font-semibold text-blue-700 dark:text-blue-400">
              {counts.paid}
            </span>{' '}
            paid · {counts.total} insgesamt
          </p>
        </header>

        {/* Filter-Form als <form method="GET"> für SSR-friendly state */}
        <form
          method="GET"
          className="mb-6 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg flex flex-wrap gap-3 items-end"
        >
          <div className="flex-1 min-w-[140px]">
            <label
              htmlFor="airport"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
            >
              Airport (ICAO)
            </label>
            <input
              type="text"
              id="airport"
              name="airport"
              defaultValue={airportParam}
              placeholder="ED, EDDF..."
              className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase"
              maxLength={4}
            />
          </div>

          <div className="flex-1 min-w-[140px]">
            <label
              htmlFor="provider"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
            >
              Provider
            </label>
            <select
              id="provider"
              name="provider"
              defaultValue={providerParam}
              className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
            >
              <option value="">Alle</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[140px]">
            <label
              htmlFor="price"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
            >
              Preis
            </label>
            <select
              id="price"
              name="price"
              defaultValue={priceParam}
              className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
            >
              <option value="">Alle</option>
              <option value="free">Kostenlos</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label
              htmlFor="airline"
              className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
            >
              Airline
            </label>
            <select
              id="airline"
              name="airline"
              defaultValue={airlineParam || 'all'}
              className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm"
            >
              <option value="all">Alle (inkl. global)</option>
              <option value="global">Nur globale</option>
              {airlines.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.iata ?? a.icao ?? '–'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition"
            >
              Filtern
            </button>
            {(providerParam || airportParam || priceParam || airlineParam) && (
              <Link
                href="/sceneries"
                className="px-4 py-1.5 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded text-sm font-medium transition"
              >
                Reset
              </Link>
            )}
          </div>
        </form>

        {sceneries.length === 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              {counts.total === 0
                ? 'Noch keine Sceneries im Katalog.'
                : 'Keine Sceneries die zu diesen Filtern passen.'}
            </p>
            {counts.total === 0 && isAdmin && (
              <p className="text-sm text-gray-500">
                Als Admin kannst du{' '}
                <Link
                  href="/admin/sceneries"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  hier die erste anlegen
                </Link>
                .
              </p>
            )}
          </section>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sceneries.map((s) => (
              <Link
                key={s.id}
                href={`/sceneries/${s.id}`}
                className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-indigo-400 dark:hover:border-indigo-600 rounded-lg p-4 transition"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-base leading-tight flex-1">
                    {s.name}
                  </h3>
                  <span
                    className={
                      s.free
                        ? 'shrink-0 text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                        : 'shrink-0 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                    }
                  >
                    {s.free ? 'Kostenlos' : 'Paid'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                  {s.airportIcao && (
                    <span className="font-mono uppercase px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                      {s.airportIcao}
                    </span>
                  )}
                  {s.provider && (
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                      {s.provider}
                    </span>
                  )}
                  {s.airline && (
                    <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded">
                      {s.airline.iata ?? s.airline.icao ?? s.airline.name}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
