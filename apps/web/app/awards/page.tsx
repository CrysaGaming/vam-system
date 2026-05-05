import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listAwardsWithCounts, getUserAwardIds } from '@vam/db';
import { AwardBadge } from './award-badge';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Public awards catalog.
 *
 * Zeigt alle definierten awards in einem grid. Eingeloggte user sehen
 * pro award ob sie ihn schon haben (earned-badge auf der card). Plus
 * recipient-counts pro award ("X piloten haben das") als scarcity-
 * indicator.
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
 * scheinlich <30 — keine pagination nötig.
 */
export default async function AwardsCatalogPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const currentUserId = session.user.id;

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

  const earnedCount = awards.filter((a) => earnedIds.has(a.id)).length;
  const totalCount = awards.length;

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

        {awards.length === 0 ? (
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {awards.map((award) => {
              const earned = earnedIds.has(award.id);
              return (
                <div key={award.id} className="relative">
                  <AwardBadge award={award} earned={earned} />
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
