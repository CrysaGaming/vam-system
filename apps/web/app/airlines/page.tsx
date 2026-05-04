import { prisma } from '@vam/db';
import Link from 'next/link';

/**
 * /airlines — Public airline directory (Welle 8 commit 8B-3).
 *
 * Lists every airline with `publicVisible=true`, alphabetically by name.
 * No auth required — this is a top-level discovery page that any visitor
 * can browse to find an airline's public profile (/a/[icao]).
 *
 * Per-card content:
 *   - Logo or ICAO-fallback block (same pattern as /a/[icao] hero)
 *   - Name (linked to /a/[icao])
 *   - Tagline if set
 *   - ICAO + optional IATA chips
 *   - Hub count + fleet count (small stats line)
 *   - Subtle accent border-left in airline.primaryColor for visual variety
 *
 * Out-of-scope for v1:
 *   - Search/filter — YAGNI until we cross ~50 airlines
 *   - Pagination — same threshold
 *   - Sorting beyond alphabetical — could add "newest", "most flights" etc.
 *     once there's data to sort by
 *
 * Caching: revalidatePath('/airlines') is NOT (yet) called from
 * updateAirlineSettings, so changes to publicVisible / branding may
 * take up to the default Next.js cache window to appear here. Acceptable
 * for v1 — directory is not high-traffic and a few minutes of staleness
 * is fine. If/when we add it: 1-line addition to the action.
 */
export default async function AirlinesDirectoryPage() {
  const airlines = await prisma.airline.findMany({
    where: { publicVisible: true },
    select: {
      id: true,
      icao: true,
      iata: true,
      name: true,
      logoUrl: true,
      tagline: true,
      primaryColor: true,
      _count: { select: { hubs: true, aircraft: true } },
    },
    orderBy: { name: 'asc' },
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold tracking-tight">Airlines</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {airlines.length === 0
              ? 'Noch keine öffentlichen airlines.'
              : `${airlines.length} ${airlines.length === 1 ? 'airline' : 'airlines'} im verzeichnis`}
          </p>
        </header>

        {airlines.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {airlines.map((a) => {
              const accent = a.primaryColor ?? '#4F46E5';
              return (
                <li key={a.id}>
                  <Link
                    href={`/a/${a.icao}`}
                    className="block h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:shadow-md transition overflow-hidden"
                  >
                    <div className="flex h-full">
                      {/* Accent stripe in airline brand color */}
                      <div
                        className="w-1 flex-shrink-0"
                        style={{ backgroundColor: accent }}
                        aria-hidden="true"
                      />
                      <div className="flex-1 p-4 flex flex-col gap-3">
                        <div className="flex items-start gap-3">
                          {a.logoUrl ? (
                            // <img> wrapped in <picture> per project convention
                            // (Next 16 + Turbopack <picture> stripping issue).
                            <picture>
                              <img
                                src={a.logoUrl}
                                alt={`${a.name} Logo`}
                                className="h-12 w-12 rounded object-contain bg-gray-100 dark:bg-gray-800 p-1 flex-shrink-0"
                              />
                            </picture>
                          ) : (
                            <div
                              className="h-12 w-12 rounded flex items-center justify-center text-xs font-bold tracking-tight text-white flex-shrink-0"
                              style={{ backgroundColor: accent }}
                            >
                              {a.icao}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-base truncate">
                              {a.name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                              <span className="font-mono uppercase">
                                {a.icao}
                              </span>
                              {a.iata && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono uppercase">
                                    {a.iata}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {a.tagline && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                            {a.tagline}
                          </p>
                        )}

                        <div className="mt-auto pt-2 flex items-center gap-4 text-[11px] text-gray-500 dark:text-gray-400">
                          <span>
                            <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-300">
                              {a._count.hubs}
                            </span>{' '}
                            {a._count.hubs === 1 ? 'Hub' : 'Hubs'}
                          </span>
                          <span>
                            <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-300">
                              {a._count.aircraft}
                            </span>{' '}
                            Aircraft
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-12 text-center">
      <div className="text-5xl mb-4" aria-hidden="true">
        🛫
      </div>
      <h2 className="text-xl font-semibold mb-2">
        Noch keine öffentlichen airlines
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
        Sobald die ersten airlines auf <code>publicVisible=true</code> stehen,
        erscheinen sie hier.
      </p>
    </div>
  );
}
