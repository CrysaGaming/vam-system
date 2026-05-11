import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { Prisma, prisma } from '@vam/db';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';

/**
 * Track 4 #73 (Section N) — Routes-Liste mit Distance-Filter
 *
 * URL-driven filter analog zur bookings-list (#15):
 *   - `q`: text-search auf flightNumber + departure/arrival ICAO
 *   - `band`: preset-band (short/medium/long/ultra) — quick-pick
 *   - `minNm` + `maxNm`: custom-range — fine-control
 *
 * # Band vs. custom-range precedence
 *
 * Band-preset überschreibt custom-range NICHT — beide werden zusammen
 * angewandt (AND-verknüpft). Wenn der user "Medium" wählt (500-1500nm)
 * und dann minNm=800 setzt, sieht er routes von 800-1500nm. Wenn die
 * werte sich widersprechen (band=short=≤500 aber minNm=1000), gibt's
 * keine treffer — der user sieht den empty-state und kann den filter
 * resetten.
 *
 * Diese verhalten ist intuitiver als "letzter wins" weil der user beide
 * UI-elemente bewusst befüllt hat. Reset-link in der UI macht's
 * recovery-easy.
 *
 * # Aviation distance-bands
 *
 * Standard-airline-industry classification:
 *   Short-haul    < 500 NM    (regional, intra-europe)
 *   Medium-haul   500-1500 NM (intra-continental)
 *   Long-haul     1500-3500 NM (transcontinental)
 *   Ultra-long    > 3500 NM   (intercontinental)
 *
 * Werte als constants damit chip-labels + filter-logic synchron bleiben.
 */

type DistanceBand = 'short' | 'medium' | 'long' | 'ultra';

const BAND_CONFIG: Record<DistanceBand, { label: string; min: number; max: number | null }> = {
  short: { label: 'Short ≤500 NM', min: 0, max: 500 },
  medium: { label: 'Medium 500-1500 NM', min: 500, max: 1500 },
  long: { label: 'Long 1500-3500 NM', min: 1500, max: 3500 },
  ultra: { label: 'Ultra >3500 NM', min: 3500, max: null },
};

const BAND_KEYS: DistanceBand[] = ['short', 'medium', 'long', 'ultra'];

function parseBand(raw: unknown): DistanceBand | null {
  if (typeof raw !== 'string') return null;
  return (BAND_KEYS as string[]).includes(raw) ? (raw as DistanceBand) : null;
}

/** Parse a positive integer from a URL param. Returns null if invalid/missing/negative. */
function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export default async function Routes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await searchParams;
  const textQuery = typeof params.q === 'string' ? params.q.trim() : '';
  const band = parseBand(params.band);
  const customMin = parsePositiveInt(params.minNm);
  const customMax = parsePositiveInt(params.maxNm);

  // User-airline ermitteln um routes airline-scoped zu filtern. Vor dem
  // 2026-05-03 fix wurden ALLE routes über alle airlines gezeigt — ein
  // pilot von Leav Aviation sah auch Lufthansa-routes. Cross-airline-leak
  // war ein bug, kein feature: jede airline pflegt ihre routes selbst, und
  // pilots fliegen nur ihre eigene airline. Wenn user keiner airline an-
  // gehört, ist die liste leer (kein redirect — die page zeigt einfach
  // empty-state mit hint).
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });

  if (!user?.airlineId) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
        <div className="max-w-[100rem] mx-auto">
          <EmptyState
            icon="🛫"
            title="Keine Airline-Zuordnung"
            description="Du bist noch keiner Airline beigetreten. Bitte einen Admin um eine Einladung."
            primaryAction={{ label: '← Dashboard', href: '/dashboard' }}
          />
        </div>
      </main>
    );
  }

  // Effektive distance-bounds: band + custom-range werden zusammengeführt.
  // Beide AND-verknüpft → engster gemeinsamer bereich. Wenn band gesetzt
  // ist, nehmen wir die band-bounds als initial-werte und ÜBERSCHREIBEN
  // sie mit den custom-werten wenn die enger sind (nicht wider-
  // sprechend). Beispiel:
  //   band=medium (500-1500) + minNm=800 → effective: 800-1500
  //   band=short (≤500) + maxNm=300 → effective: 0-300
  //   band=short (≤500) + minNm=1000 → effective: 1000-500 = leer
  // Die "leer"-fälle erzeugen eine prisma-query die garantiert 0 treffer
  // returned — UI zeigt empty-state mit reset-link.
  const bandMin = band ? BAND_CONFIG[band].min : 0;
  const bandMax = band ? BAND_CONFIG[band].max : null;
  const effectiveMin = Math.max(bandMin, customMin ?? 0);
  // Max: wenn beide null → unbegrenzt; sonst Math.min der definierten.
  const effectiveMax: number | null =
    bandMax === null && customMax === null
      ? null
      : bandMax === null
        ? customMax
        : customMax === null
          ? bandMax
          : Math.min(bandMax, customMax);

  // Build where-clause. distanceNm-filter wird nur gesetzt wenn min > 0
  // ODER max !== null — sonst wäre's eine pass-through-clause.
  const distanceFilter: Prisma.IntFilter | undefined =
    effectiveMin > 0 || effectiveMax !== null
      ? {
          ...(effectiveMin > 0 && { gte: effectiveMin }),
          ...(effectiveMax !== null && { lte: effectiveMax }),
        }
      : undefined;

  const baseWhere: Prisma.RouteWhereInput = {
    active: true,
    airlineId: user.airlineId,
  };

  const filteredWhere: Prisma.RouteWhereInput = {
    ...baseWhere,
    ...(distanceFilter && { distanceNm: distanceFilter }),
    ...(textQuery && {
      OR: [
        { flightNumber: { contains: textQuery, mode: 'insensitive' } },
        { departure: { icao: { contains: textQuery, mode: 'insensitive' } } },
        { arrival: { icao: { contains: textQuery, mode: 'insensitive' } } },
      ],
    }),
  };

  const filterActive =
    textQuery !== '' || band !== null || customMin !== null || customMax !== null;

  const [routes, totalUnfiltered] = await Promise.all([
    prisma.route.findMany({
      where: filteredWhere,
      include: {
        departure: true,
        arrival: true,
        airline: true,
      },
      orderBy: { flightNumber: 'asc' },
    }),
    filterActive
      ? prisma.route.count({ where: baseWhere })
      : Promise.resolve(-1),
  ]);

  const totalForHeader = filterActive ? totalUnfiltered : routes.length;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Routes</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {totalForHeader}{' '}
              {totalForHeader === 1 ? 'aktive Strecke' : 'aktive Strecken'}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <RoutesFilterBar
          textQuery={textQuery}
          band={band}
          customMin={customMin}
          customMax={customMax}
          filterActive={filterActive}
          visibleCount={routes.length}
          totalUnfiltered={totalUnfiltered}
        />

        {routes.length === 0 ? (
          filterActive ? (
            <EmptyState
              variant="info"
              icon="🔍"
              title="Keine Routen entsprechen dem Filter"
              description="Setze den Filter zurück oder erweitere den Distanz-Bereich."
              primaryAction={{ label: 'Filter zurücksetzen', href: '/routes' }}
            />
          ) : (
            <EmptyState
              icon="🛫"
              title="Noch keine Routen"
              description="Diese Airline hat noch keine aktiven Strecken. Ein Admin kann sie unter Airline-Admin pflegen."
              primaryAction={{ label: '← Dashboard', href: '/dashboard' }}
            />
          )
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Flug</th>
                  <th className="px-4 py-3">Von</th>
                  <th className="px-4 py-3">Nach</th>
                  <th className="px-4 py-3 text-right">Distanz</th>
                  <th className="px-4 py-3 text-right">Dauer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {routes.map((route) => (
                  <tr
                    key={route.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition"
                  >
                    <td className="px-4 py-3 font-mono font-semibold">
                      {route.flightNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{route.departure.icao}</div>
                      <div className="text-xs text-gray-500">
                        {route.departure.city}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{route.arrival.icao}</div>
                      <div className="text-xs text-gray-500">
                        {route.arrival.city}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300 tabular-nums">
                      {route.distanceNm} nm
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300 tabular-nums">
                      {Math.floor(route.estimatedMinutes / 60)}h{' '}
                      {route.estimatedMinutes % 60}min
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * URL-builder. Preserves orthogonal axes — wenn der user nur ein band
 * ändert, bleiben textQuery + custom-range erhalten. Wenn newBand=null
 * passed wird, droppen wir den band-param (für "Alle"-chip + reset-link).
 */
function buildRoutesUrl(
  current: {
    textQuery: string;
    band: DistanceBand | null;
    customMin: number | null;
    customMax: number | null;
  },
  override: Partial<{
    textQuery: string;
    band: DistanceBand | null;
    customMin: number | null;
    customMax: number | null;
  }>,
): string {
  const merged = { ...current, ...override };
  const usp = new URLSearchParams();
  if (merged.textQuery) usp.set('q', merged.textQuery);
  if (merged.band) usp.set('band', merged.band);
  if (merged.customMin !== null) usp.set('minNm', String(merged.customMin));
  if (merged.customMax !== null) usp.set('maxNm', String(merged.customMax));
  const qs = usp.toString();
  return qs ? `/routes?${qs}` : '/routes';
}

interface RoutesFilterBarProps {
  textQuery: string;
  band: DistanceBand | null;
  customMin: number | null;
  customMax: number | null;
  filterActive: boolean;
  visibleCount: number;
  totalUnfiltered: number;
}

function RoutesFilterBar({
  textQuery,
  band,
  customMin,
  customMax,
  filterActive,
  visibleCount,
  totalUnfiltered,
}: RoutesFilterBarProps) {
  const filterCtx = { textQuery, band, customMin, customMax };
  return (
    <div className="mb-6 space-y-3">
      {/* Text-search form. method=GET → SSR re-render. hidden inputs
          carry band + customMin/customMax durch damit submission die
          orthogonale axe nicht verliert (siehe bookings/page.tsx
          FilterBar für mehr context zum pattern). */}
      <form method="GET" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={textQuery}
          placeholder="Suche: Flugnummer oder ICAO…"
          className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
        />
        {band && <input type="hidden" name="band" value={band} />}
        {customMin !== null && (
          <input type="hidden" name="minNm" value={customMin} />
        )}
        {customMax !== null && (
          <input type="hidden" name="maxNm" value={customMax} />
        )}
        <button
          type="submit"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition"
        >
          Suchen
        </button>
      </form>

      {/* Distance-band chip-row. Quick-presets für die häufigsten use-
          cases. Custom-range darunter für fine-tuning. */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs uppercase tracking-wider text-gray-500 mr-1">
          Distanz:
        </span>
        <FilterChip
          label="Alle"
          href={buildRoutesUrl(filterCtx, {
            band: null,
            customMin: null,
            customMax: null,
          })}
          active={!band && customMin === null && customMax === null}
        />
        {BAND_KEYS.map((k) => (
          <FilterChip
            key={k}
            label={BAND_CONFIG[k].label}
            // Beim chip-click clearen wir custom-range damit das band
            // alleine wirkt — ohne reset könnte ein altes min/max das
            // band-result verfälschen. Wenn der user fine-tunen will,
            // tippt er danach in die number-inputs.
            href={buildRoutesUrl(filterCtx, {
              band: band === k ? null : k,
              customMin: null,
              customMax: null,
            })}
            active={band === k}
          />
        ))}
      </div>

      {/* Custom-range form. Zwei number-inputs für minNm/maxNm. method=GET
          identisch zum search-form. */}
      <form method="GET" className="flex gap-2 items-center flex-wrap">
        <span className="text-xs uppercase tracking-wider text-gray-500">
          Bereich:
        </span>
        <input
          type="number"
          name="minNm"
          min="0"
          step="50"
          defaultValue={customMin ?? ''}
          placeholder="min NM"
          className="w-24 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 tabular-nums"
        />
        <span className="text-gray-500">–</span>
        <input
          type="number"
          name="maxNm"
          min="0"
          step="50"
          defaultValue={customMax ?? ''}
          placeholder="max NM"
          className="w-24 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 tabular-nums"
        />
        {textQuery && <input type="hidden" name="q" value={textQuery} />}
        {band && <input type="hidden" name="band" value={band} />}
        <button
          type="submit"
          className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
        >
          Anwenden
        </button>
      </form>

      {/* Filter-status-row. Selbe pattern wie in bookings-list — only
          render when filter is active, zeigt counts + single-click reset. */}
      {filterActive && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {visibleCount} / {totalUnfiltered}{' '}
          {totalUnfiltered === 1 ? 'Route sichtbar' : 'Routen sichtbar'} ·{' '}
          <Link
            href="/routes"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            × Filter zurücksetzen
          </Link>
        </p>
      )}
    </div>
  );
}

interface FilterChipProps {
  label: string;
  href: string;
  active: boolean;
}

function FilterChip({ label, href, active }: FilterChipProps) {
  // Selbe chip-styling wie in bookings/page.tsx für visuelle konsistenz.
  const base =
    'px-3 py-1 rounded-full text-xs font-medium border transition whitespace-nowrap';
  const inactive =
    'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';
  const activeStyle = 'bg-indigo-600 text-white border-indigo-600';
  return (
    <Link href={href} className={`${base} ${active ? activeStyle : inactive}`}>
      {label}
    </Link>
  );
}
