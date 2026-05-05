import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma, listSceneries } from '@vam/db';
import {
  CreateSceneryForm,
  EditSceneryForm,
  DeleteSceneryButton,
  type AirlineOption,
} from './admin-forms';

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Admin sceneries management.
 *
 * Admin-only (role.name === 'admin'). Listet alle sceneries mit
 * inline-edit (in collapsible <details>) + delete-button + "Detail →"-
 * link zu /admin/sceneries/[id] für eine focused-edit-page.
 *
 * # Pattern
 *
 * Spiegelt /admin/awards/page.tsx fast 1:1 — die awards-page ist die
 * referenz-implementation. Unterschiede:
 *   - Sceneries haben keine "vergeben"-flow (kein per-pilot grant —
 *     scenery-empfehlungen sind catalog-content, nicht achievements)
 *   - Stattdessen "Detail"-link auf eine separate edit-page
 *   - Free/paid-summary statt recipient-counts in der header-zeile
 *
 * # Auth-guard
 *
 * Defense-in-depth: redirect für non-admin (auch wenn user durch URL
 * eintippen herkommt). Server-actions würden eh rejecten, aber wir
 * wollen nicht die ganze list rendern bevor ein non-admin erkennt
 * dass er hier nicht hingehört.
 */
export default async function AdminSceneriesPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    redirect('/dashboard');
  }

  // Parallel fetch: alle sceneries (kein filter — admin sieht immer
  // alles), airlines für die airline-select-dropdowns.
  const [sceneries, airlinesRaw] = await Promise.all([
    listSceneries({ airlineId: 'all' }),
    prisma.airline.findMany({
      select: { id: true, name: true, iata: true, icao: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Type-cast: prisma's nullable iata/icao matched bereits AirlineOption,
  // aber explicit cast macht das contract klar.
  const airlines: AirlineOption[] = airlinesRaw;

  // Counts für header-summary
  const total = sceneries.length;
  const freeCount = sceneries.filter((s) => s.free).length;
  const paidCount = total - freeCount;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Sceneries-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Add-on-empfehlungen pflegen für den public scenery-catalog.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/sceneries"
              className="px-4 py-2 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-900 dark:text-indigo-100 rounded text-sm transition"
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
            der admin häufiger sceneries verwaltet als neue anlegt. */}
        <details className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
          <summary className="cursor-pointer p-4 font-medium hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg">
            + Neue Scenery anlegen
          </summary>
          <div className="p-4 pt-0 border-t border-gray-200 dark:border-gray-800">
            <CreateSceneryForm airlines={airlines} />
          </div>
        </details>

        {/* Sceneries-liste */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">
              Definierte Sceneries
            </h2>
            <span className="text-xs text-gray-500">
              {total === 0
                ? 'Noch keine'
                : `${total} gesamt · ${freeCount} kostenlos · ${paidCount} paid`}
            </span>
          </header>

          {total === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400 mb-2">
                Noch keine Sceneries im Katalog.
              </p>
              <p className="text-sm text-gray-500">
                Klick auf &quot;Neue Scenery anlegen&quot; um die erste zu erstellen.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {sceneries.map((scenery) => (
                <li key={scenery.id} className="p-6">
                  <div className="flex items-start gap-4 flex-wrap">
                    {/* Scenery-info links */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap mb-2">
                        <h3 className="font-semibold text-base leading-tight">
                          {scenery.name}
                        </h3>
                        <span
                          className={
                            scenery.free
                              ? 'shrink-0 text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                              : 'shrink-0 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                          }
                        >
                          {scenery.free ? 'Kostenlos' : 'Paid'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400 mb-2">
                        {scenery.airportIcao && (
                          <span className="font-mono uppercase px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                            {scenery.airportIcao}
                          </span>
                        )}
                        {scenery.provider && (
                          <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                            {scenery.provider}
                          </span>
                        )}
                        {scenery.airline && (
                          <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded">
                            {scenery.airline.iata ??
                              scenery.airline.icao ??
                              scenery.airline.name}
                          </span>
                        )}
                        {!scenery.airlineId && (
                          <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                            Global
                          </span>
                        )}
                      </div>
                      {scenery.url && (
                        <p className="text-xs text-gray-500 truncate">
                          {scenery.url}
                        </p>
                      )}
                    </div>

                    {/* Action-buttons rechts */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Link
                        href={`/admin/sceneries/${scenery.id}`}
                        className="px-3 py-1.5 text-xs bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-900 dark:text-indigo-100 rounded font-medium transition"
                      >
                        Details →
                      </Link>
                      <DeleteSceneryButton
                        sceneryId={scenery.id}
                        sceneryName={scenery.name}
                        variant="compact"
                      />
                    </div>
                  </div>

                  {/* Edit-form als collapsible — bewusst nicht auto-expanded
                      damit die liste übersichtlich bleibt. Nutzer der
                      mehr fokus braucht klickt auf "Details →". */}
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs text-indigo-600 dark:text-indigo-400 hover:underline inline-block">
                      Inline bearbeiten
                    </summary>
                    <div className="mt-3 pl-4 border-l-2 border-gray-200 dark:border-gray-800">
                      <EditSceneryForm scenery={scenery} airlines={airlines} />
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
