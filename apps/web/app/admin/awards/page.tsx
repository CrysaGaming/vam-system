import Link from 'next/link';
import { listAwardsWithCounts } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';
import {
  CreateAwardForm,
  EditAwardForm,
  DeleteAwardButton,
} from './admin-forms';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Admin awards management landing page.
 *
 * Admin-only (role.name === 'admin'). Listet alle definierten awards
 * mit recipient-counts und bietet:
 *   - Create-form (collapsible <details> oben)
 *   - Per-award: edit-form (collapsible), delete-button, "Vergeben"-link
 *     zu /admin/awards/[id] für pilot-grant-flow
 *
 * Auth-guard: defense-in-depth (auch wenn non-admin durch URL-tippen
 * herkommt, server-actions würden eh rejecten — aber wir wollen kein
 * confusing-empty-page-rendering, lieber direkt redirect).
 */
export default async function AdminAwardsPage() {
  await requireAdminPage();

  const awards = await listAwardsWithCounts();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Awards-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Award-typen anlegen + manuell an piloten vergeben.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/awards"
              className="px-4 py-2 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-100 rounded text-sm transition"
            >
              Catalog ansehen
            </Link>
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        {/* Create-form als collapsible details — default-collapsed weil
            der admin häufiger awards verwaltet als neue anlegt. */}
        <details className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
          <summary className="cursor-pointer p-4 font-medium hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg">
            + Neuen Award anlegen
          </summary>
          <div className="p-4 pt-0 border-t border-gray-200 dark:border-gray-800">
            <CreateAwardForm />
          </div>
        </details>

        {/* Award-liste */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Definierte Awards
            </h2>
            <span className="text-xs text-gray-500">
              {awards.length === 0
                ? 'Noch keine'
                : awards.length === 1
                  ? '1 award'
                  : `${awards.length} awards`}
            </span>
          </header>

          {awards.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-2">
                Noch keine Awards definiert.
              </p>
              <p className="text-sm text-gray-500">
                Klick auf "Neuen Award anlegen" um den ersten zu erstellen.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {awards.map((award) => (
                <li key={award.id} className="p-6">
                  <div className="flex items-start gap-4 flex-wrap">
                    {/* Icon-thumb links */}
                    <div className="w-14 h-14 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                      {award.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-content
                        <img
                          src={award.iconUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl" aria-hidden="true">
                          🏆
                        </span>
                      )}
                    </div>

                    {/* Name + description + meta */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base mb-1">
                        {award.name}
                      </h3>
                      {award.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                          {award.description}
                        </p>
                      )}
                      <p className="text-xs text-gray-500">
                        {award.recipientCount === 0
                          ? 'Noch nicht vergeben'
                          : award.recipientCount === 1
                            ? '1 vergabe'
                            : `${award.recipientCount} vergaben`}{' '}
                        · Definiert am{' '}
                        {new Date(award.createdAt).toLocaleDateString('de-DE')}
                      </p>
                    </div>

                    {/* Action-buttons rechts */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Link
                        href={`/admin/awards/${award.id}`}
                        className="px-3 py-1.5 text-xs bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-900 dark:text-amber-100 rounded font-medium transition"
                      >
                        Vergeben →
                      </Link>
                      <DeleteAwardButton
                        awardId={award.id}
                        awardName={award.name}
                        recipientCount={award.recipientCount}
                      />
                    </div>
                  </div>

                  {/* Edit-form als collapsible — bewusst nicht auto-expanded
                      damit die liste übersichtlich bleibt. */}
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-block">
                      Bearbeiten
                    </summary>
                    <div className="mt-3 pl-4 border-l-2 border-gray-200 dark:border-gray-800">
                      <EditAwardForm award={award} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
