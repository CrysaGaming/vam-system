import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma, Prisma } from '@vam/db';
import Link from 'next/link';
import { AirportBrowser } from './airport-browser';

/**
 * Airport Catalog Browse Page (post-OurAirports-import).
 *
 * Architektur: Server-side filter + pagination via URL searchParams. Bei
 * 85k airports ist client-side full-list-loading nicht mehr akzeptabel —
 * stattdessen liest die Page searchParams aus, baut eine Prisma where-clause,
 * und liefert paginierte ergebnisse. URL ist shareable + back-button-friendly.
 *
 * URL-params:
 *   ?type=large_airport,medium_airport  (comma-separated multi-select)
 *   ?continent=EU                        (single-select)
 *   ?country=DE                          (ISO 2-letter)
 *   ?scheduled=true                      (only scheduled-service airports)
 *   ?q=frankfurt                         (free-text search: name/icao/iata/city)
 *   ?page=1                              (1-indexed)
 *
 * Default-state (keine params): zeigt large+medium airports mit scheduled
 * service. Das ist die "commercial subset" die für VAM-routes relevant ist
 * (~5k entries statt 85k). User kann den filter aufweichen.
 *
 * Access: any logged-in user can browse. Submit-request gate ist auf der
 * /airports/request page (requires airline-admin).
 */

const PAGE_SIZE = 50;

const KNOWN_TYPES = [
  'large_airport',
  'medium_airport',
  'small_airport',
  'heliport',
  'seaplane_base',
  'balloonport',
  'closed',
] as const;

const KNOWN_CONTINENTS = ['NA', 'EU', 'AS', 'AF', 'OC', 'SA', 'AN'] as const;

interface SearchParams {
  type?: string;
  continent?: string;
  country?: string;
  scheduled?: string;
  q?: string;
  page?: string;
}

export default async function AirportsBrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!user) redirect('/');

  const isAdmin = user.role?.name === 'admin';
  const canRequest = isAdmin && !!user.airlineId;

  const params = await searchParams;

  // ───── Parse + validate searchParams ─────
  // Type-filter: erlaubt nur known-types, ignoriert garbage
  const selectedTypes = (params.type ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is (typeof KNOWN_TYPES)[number] =>
      (KNOWN_TYPES as readonly string[]).includes(t),
    );

  const selectedContinent =
    params.continent &&
    (KNOWN_CONTINENTS as readonly string[]).includes(params.continent)
      ? params.continent
      : null;

  // Country: 2-letter ISO code, uppercased
  const selectedCountry = params.country
    ? params.country.trim().toUpperCase().slice(0, 2) || null
    : null;

  const scheduledOnly = params.scheduled === 'true';

  // Free-text search query
  const query = (params.q ?? '').trim();

  // Pagination
  const pageNum = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const skip = (pageNum - 1) * PAGE_SIZE;

  // ───── Determine if "default state" (no user-set filters) ─────
  // Wenn user keine filters gesetzt hat, wenden wir defaults an: nur
  // large+medium + scheduled. Das verhindert dass die initial-page 85k
  // entries paginiert (was zwar funktional ok wäre, aber überflutet den user).
  const hasAnyUserFilter =
    selectedTypes.length > 0 ||
    selectedContinent !== null ||
    selectedCountry !== null ||
    params.scheduled !== undefined ||
    query.length > 0;

  const effectiveTypes = hasAnyUserFilter
    ? selectedTypes.length > 0
      ? selectedTypes
      : null // user has other filters but no type filter → all types
    : ['large_airport', 'medium_airport']; // default subset

  const effectiveScheduledOnly = hasAnyUserFilter
    ? scheduledOnly
    : true; // default: only scheduled

  // ───── Build Prisma where-clause ─────
  const where: Prisma.AirportWhereInput = {
    active: true,
  };

  if (effectiveTypes !== null) {
    where.type = { in: effectiveTypes };
  }
  if (selectedContinent) {
    where.continent = selectedContinent;
  }
  if (selectedCountry) {
    where.country = selectedCountry;
  }
  if (effectiveScheduledOnly) {
    where.scheduledService = true;
  }
  if (query) {
    // Search across icao, iata, name, city — case-insensitive contains
    where.OR = [
      { icao: { contains: query, mode: 'insensitive' } },
      { iata: { contains: query, mode: 'insensitive' } },
      { name: { contains: query, mode: 'insensitive' } },
      { city: { contains: query, mode: 'insensitive' } },
    ];
  }

  // ───── Query airports + total count + total-in-db (for "x of y") ─────
  const [airports, totalMatching, totalInDb] = await Promise.all([
    prisma.airport.findMany({
      where,
      orderBy: [{ verified: 'desc' }, { type: 'asc' }, { icao: 'asc' }],
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        icao: true,
        iata: true,
        name: true,
        city: true,
        country: true,
        latitude: true,
        longitude: true,
        elevation: true,
        verified: true,
        type: true,
        continent: true,
        scheduledService: true,
      },
    }),
    prisma.airport.count({ where }),
    prisma.airport.count({ where: { active: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalMatching / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      <div className="max-w-[100rem] mx-auto p-4 sm:p-6 lg:p-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Airport-Katalog</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalMatching.toLocaleString('de')} airports gefunden{' '}
              {hasAnyUserFilter && (
                <span className="text-gray-400 dark:text-gray-500">
                  · von {totalInDb.toLocaleString('de')} insgesamt
                </span>
              )}
            </p>
          </div>
          {canRequest && (
            <Link
              href="/airports/request"
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500"
            >
              + Neuen Airport vorschlagen
            </Link>
          )}
        </div>

        <AirportBrowser
          airports={airports}
          totalMatching={totalMatching}
          currentPage={pageNum}
          totalPages={totalPages}
          pageSize={PAGE_SIZE}
          filters={{
            types: selectedTypes,
            continent: selectedContinent,
            country: selectedCountry,
            scheduledOnly: hasAnyUserFilter ? scheduledOnly : true,
            query,
          }}
          isDefaultState={!hasAnyUserFilter}
        />
      </div>
    </div>
  );
}
