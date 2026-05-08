import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listAwardsWithCounts, getUserAwardIds } from '@vam/db';
import { AwardBadge } from './award-badge';
import { annotateFamilies } from './tier-detection';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Public awards catalog.
 *
 * Zeigt alle definierten awards in einem grid. Eingeloggte user sehen
 * pro award ob sie ihn schon haben (earned-badge auf der card). Plus
 * recipient-counts pro award ("X piloten haben das") als scarcity-
 * indicator.
 *
 * # Track 4 #16 (Section C polish) — Filter + tier-progression
 *
 * URL-driven filter (matches sceneries / events / bookings):
 *   - `?q=<text>` — name + description text-search
 *   - `?filter=earned|open` — earned-state filter chip
 *
 * Plus: Awards die zu einer tier-family gehören (Bronze/Silber/Gold-
 * progression mit gleichem name-prefix) zeigen einen segmented
 * progress-bar im badge. Detection läuft heuristisch über Name-suffix —
 * keine schema-änderung nötig (siehe tier-detection.ts).
 *
 * Auth: page selbst ist member-only (login redirect → /). Awards
 * informationen sind nicht "geheim", aber für die earned-overlay
 * brauchen wir die session, und das matched dem rest der app
 * (most pages sind eh member-only nach login).
 *
 * Layout: 3-col grid auf desktop, 2-col tablet, 1-col mobile. Stats-
 * banner oben mit "X awards earned von Y total". Link zu /awards/personal
 * für eigene-awards-only-view, plus admin-link wenn role=admin.
 *
 * Performance: zwei queries parallel (listAwardsWithCounts + getUserAwardIds).
 * Set-lookup für earned-check ist O(1) per item, also linear in awards-
 * anzahl. Bei 100+ awards ggf. pagination, aber im MVP haben wir wahr-
 * scheinlich <30 — keine pagination nötig. Filter läuft in-memory nach
 * dem fetch (auch O(n)) — angemessen für die kleinen dataset-größen.
 */
export default async function AwardsCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const currentUserId = session.user.id;

  const params = await searchParams;
  const textQuery =
    typeof params.q === 'string' ? params.q.trim() : '';
  const filterParam =
    typeof params.filter === 'string' ? params.filter : '';
  const filterMode: 'all' | 'earned' | 'open' =
    filterParam === 'earned' || filterParam === 'open' ? filterParam : 'all';

  // Parallel fetch: alle awards + earned-set des current users.
  const [awards, earnedIds] = await Promise.all([
    listAwardsWithCounts(),
    getUserAwardIds(currentUserId),
  ]);

  // User-role check für admin-link rendering. Cheap-enough als zusätzliche
  // query — eine page-load extra ms ist's wert für die UX.
  const { prisma } = await import('@vam/db');
  const currentUser = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { role: { select: { name: true } } },
  });
  const isAdmin = currentUser?.role?.name === 'admin';

  const totalCount = awards.length;
  const earnedCount = awards.filter((a) => earnedIds.has(a.id)).length;

  // Family-annotation läuft auf der UNFILTERED liste — sonst würden
  // Bronze + Silber als "1/1" displayed wenn der filter Gold rausgewfen
  // hat. Family-progression ist eine eigenschaft der gesamt-collection,
  // nicht der gefilterten subset.
  const families = annotateFamilies(awards, earnedIds);

  // Apply filters in-memory. Awards-collection ist klein genug
  // (typisch <30, max ~100), daher rechtfertigt sich der unfiltered-
  // fetch + in-memory-filter — und wir brauchen die unfiltered total
  // für den counter sowieso.
  const lcQuery = textQuery.toLowerCase();
  const filteredAwards = awards.filter((award) => {
    if (filterMode === 'earned' && !earnedIds.has(award.id)) return false;
    if (filterMode === 'open' && earnedIds.has(award.id)) return false;
    if (lcQuery) {
      const inName = award.name.toLowerCase().includes(lcQuery);
      const inDesc = (award.description ?? '')
        .toLowerCase()
        .includes(lcQuery);
      if (!inName && !inDesc) return false;
    }
    return true;
  });

  const filterActive = textQuery !== '' || filterMode !== 'all';

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-2">
            <h1 className="text-3xl font-bold">Awards</h1>
            <div className="flex gap-2">
              <Link
                href="/awards/personal"
                className="px-4 py-2 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-100 rounded text-sm font-medium transition"
              >
                Meine Awards →
              </Link>
              {isAdmin && (
                <Link
                  href="/admin/awards"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition"
                >
                  Verwalten
                </Link>
              )}
            </div>
          </div>
          <p className="text-gray-500 dark:text-gray-400">
            Merit-badges für Pilot-Karriere-Meilensteine.
          </p>
          <p className="text-sm mt-3">
            <span className="font-semibold text-amber-700 dark:text-amber-400">
              {earnedCount}
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              {' '}
              von {totalCount} awards erhalten
            </span>
            {totalCount > 0 && (
              <span className="text-gray-500 dark:text-gray-500 ml-2">
                ({Math.round((earnedCount / totalCount) * 100)}%)
              </span>
            )}
          </p>
        </header>

        {totalCount > 0 && (
          <FilterBar
            textQuery={textQuery}
            filterMode={filterMode}
            filterActive={filterActive}
            visibleCount={filteredAwards.length}
            totalCount={totalCount}
          />
        )}

        {totalCount === 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              Noch keine Awards definiert.
            </p>
            {isAdmin && (
              <p className="text-sm text-gray-500">
                Als Admin kannst du{' '}
                <Link
                  href="/admin/awards"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  hier den ersten Award anlegen
                </Link>
                .
              </p>
            )}
          </section>
        ) : filteredAwards.length === 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Keine Awards entsprechen dem Filter.
            </p>
            <Link
              href="/awards"
              className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded font-medium transition text-white"
            >
              Filter zurücksetzen
            </Link>
          </section>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAwards.map((award) => {
              const earned = earnedIds.has(award.id);
              const family = families.get(award.id) ?? null;
              return (
                <div key={award.id} className="relative">
                  <AwardBadge award={award} earned={earned} family={family} />
                  {/* Recipient-count overlay rechts unten — kleiner muted-text
                      mit "X piloten" oder "1 pilot". Bewusst NICHT in der
                      AwardBadge-component selbst weil die count-info nur im
                      catalog relevant ist (nicht auf profile, nicht im
                      admin-picker). */}
                  <div
                    className="absolute bottom-2 right-2 text-xs text-gray-500 dark:text-gray-500 bg-white/80 dark:bg-gray-900/80 backdrop-blur px-2 py-0.5 rounded pointer-events-none"
                    aria-label={`${award.recipientCount} piloten haben diesen award erhalten`}
                  >
                    {award.recipientCount === 0
                      ? 'noch niemand'
                      : award.recipientCount === 1
                        ? '1 pilot'
                        : `${award.recipientCount} piloten`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * URL builder für filter-chip + search-form. Preserveiert den orthogonalen
 * axis: search-text bleibt wenn man den filter-mode wechselt, filter-mode
 * bleibt wenn man search submitted (über hidden input im form).
 */
function buildAwardsUrl(
  textQuery: string,
  newFilterMode: 'all' | 'earned' | 'open',
): string {
  const usp = new URLSearchParams();
  if (textQuery) usp.set('q', textQuery);
  if (newFilterMode !== 'all') usp.set('filter', newFilterMode);
  const qs = usp.toString();
  return qs ? `/awards?${qs}` : '/awards';
}

interface FilterBarProps {
  textQuery: string;
  filterMode: 'all' | 'earned' | 'open';
  filterActive: boolean;
  visibleCount: number;
  totalCount: number;
}

function FilterBar({
  textQuery,
  filterMode,
  filterActive,
  visibleCount,
  totalCount,
}: FilterBarProps) {
  return (
    <div className="mb-6 space-y-3">
      {/*
        Search form — plain HTML form, method=GET. SSR re-rendert mit
        dem neuen ?q-param. Hidden input für filter-mode preserveiert
        den active chip beim submit.
      */}
      <form method="GET" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={textQuery}
          placeholder="Suche: Name oder Beschreibung…"
          className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm focus:outline-none focus:border-amber-500 dark:focus:border-amber-400"
        />
        {filterMode !== 'all' && (
          <input type="hidden" name="filter" value={filterMode} />
        )}
        <button
          type="submit"
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium transition"
        >
          Suchen
        </button>
      </form>

      {/* Earned/open filter chips */}
      <div className="flex gap-2 flex-wrap items-center">
        <FilterChip
          label="Alle"
          href={buildAwardsUrl(textQuery, 'all')}
          active={filterMode === 'all'}
        />
        <FilterChip
          label="Erhalten"
          href={buildAwardsUrl(textQuery, 'earned')}
          active={filterMode === 'earned'}
          accentClass="bg-amber-500 text-white border-amber-500"
        />
        <FilterChip
          label="Offen"
          href={buildAwardsUrl(textQuery, 'open')}
          active={filterMode === 'open'}
          accentClass="bg-gray-600 text-white border-gray-600 dark:bg-gray-700 dark:border-gray-700"
        />
      </div>

      {filterActive && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {visibleCount} / {totalCount}{' '}
          {totalCount === 1 ? 'Award sichtbar' : 'Awards sichtbar'} ·{' '}
          <Link
            href="/awards"
            className="text-amber-600 dark:text-amber-400 hover:underline"
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
  accentClass?: string;
}

function FilterChip({ label, href, active, accentClass }: FilterChipProps) {
  const base =
    'px-3 py-1 rounded-full text-xs font-medium border transition whitespace-nowrap';
  const inactive =
    'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';
  const activeAccent =
    accentClass ?? 'bg-indigo-600 text-white border-indigo-600';
  return (
    <Link href={href} className={`${base} ${active ? activeAccent : inactive}`}>
      {label}
    </Link>
  );
}
