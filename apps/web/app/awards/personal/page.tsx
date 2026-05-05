import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getUserAwards } from '@vam/db';
import { AwardBadge } from '../award-badge';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Personal awards view ("Meine Awards").
 *
 * Zeigt nur die awards die der eingeloggte user erworben hat,
 * sortiert nach awardedAt desc (neueste zuerst). Reduzierte ablenkung
 * vs der full-catalog-view.
 *
 * Empty-state: wenn der user noch keinen award hat, zeigen wir einen
 * call-to-action zur catalog-page wo er sieht was es so gibt.
 *
 * Layout: 2-col grid (compact-size badges) auf desktop+, 1-col mobile.
 * Compact-mode passt besser hier weil die awards als persönliche
 * collection gefühlt werden sollen, nicht als marketplace.
 */
export default async function PersonalAwardsPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const userAwards = await getUserAwards(session.user.id);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <Link
            href="/awards"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 mb-2"
          >
            ← Alle Awards
          </Link>
          <h1 className="text-3xl font-bold">Meine Awards</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {userAwards.length === 0
              ? 'Du hast noch keine Awards erworben.'
              : userAwards.length === 1
                ? '1 award erhalten'
                : `${userAwards.length} awards erhalten`}
          </p>
        </header>

        {userAwards.length === 0 ? (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-6xl mb-4" aria-hidden="true">
              🏆
            </p>
            <h2 className="text-lg font-semibold mb-2">
              Noch keine Awards
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
              Awards werden vom Airline-Admin manuell vergeben — z.B. für
              karriere-meilensteine wie "100 Flugstunden" oder "PMDG-Master".
              Schau dir den Catalog an um zu sehen was alles möglich ist.
            </p>
            <Link
              href="/awards"
              className="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition"
            >
              Awards-Catalog ansehen →
            </Link>
          </section>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {userAwards.map((ua) => (
              <AwardBadge
                key={ua.id}
                award={ua.award}
                earned={true}
                awardedAt={ua.awardedAt}
                size="compact"
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
