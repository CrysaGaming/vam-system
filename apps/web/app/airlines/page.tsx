import { prisma } from '@vam/db';
import { AirlineDirectory } from './airline-directory';

/**
 * /airlines — Public airline directory (Welle 8 commit 8B-3).
 *
 * Lists every airline with `publicVisible=true`. No auth required — top-level
 * discovery page that any visitor can browse.
 *
 * Track 4 #35 (Section G): Search + sort moved to client-side. Server hydrates
 * the full payload (≤ 5kb für ~100 airlines), client filters/sorts instantly
 * ohne URL-state oder round-trips. Sort-Optionen: name (default), hubs-desc,
 * aircraft-desc.
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
          <AirlineDirectory airlines={airlines} />
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
