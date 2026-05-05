import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getSceneryById, prisma } from '@vam/db';

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Scenery detail-page.
 *
 * Zeigt alle felder einer scenery formatiert mit "Open URL"-CTA. Im
 * MVP-schema sehr schmal — wenn schema-erweiterung später (description,
 * image, simulator-tags) kommt, wird diese page reicher.
 *
 * Auth: member-only wie der catalog. Admin-link zum edit-flow wenn role.
 */
export default async function SceneryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const { id } = await params;
  const scenery = await getSceneryById(id);
  if (!scenery) notFound();

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: { select: { name: true } } },
  });
  const isAdmin = currentUser?.role?.name === 'admin';

  // Format created-at als locale-string. Server-rendered, deutsche locale.
  const createdAtFormatted = scenery.createdAt.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/sceneries"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 inline-block"
        >
          ← Zurück zum Katalog
        </Link>

        <article className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 sm:p-8">
          <header className="mb-6">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-2">
              <h1 className="text-3xl font-bold leading-tight">
                {scenery.name}
              </h1>
              <span
                className={
                  scenery.free
                    ? 'shrink-0 text-xs px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 font-medium'
                    : 'shrink-0 text-xs px-2.5 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 font-medium'
                }
              >
                {scenery.free ? 'Kostenlos' : 'Paid'}
              </span>
            </div>
            {scenery.airline && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Empfohlen von{' '}
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {scenery.airline.name}
                </span>
              </p>
            )}
          </header>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {scenery.airportIcao && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                  Flughafen
                </dt>
                <dd className="font-mono text-lg">{scenery.airportIcao}</dd>
              </div>
            )}
            {scenery.provider && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                  Provider
                </dt>
                <dd className="text-base">{scenery.provider}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                Hinzugefügt
              </dt>
              <dd className="text-base">{createdAtFormatted}</dd>
            </div>
            {scenery.airline && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                  Airline
                </dt>
                <dd className="text-base">
                  {scenery.airline.iata ?? scenery.airline.icao ?? '–'}
                </dd>
              </div>
            )}
          </dl>

          {scenery.url ? (
            <a
              href={scenery.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition"
            >
              <span>Zum Provider →</span>
            </a>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              Kein Direkt-Link hinterlegt — Provider googeln.
            </p>
          )}

          {isAdmin && (
            <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
              <Link
                href={`/admin/sceneries/${scenery.id}`}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Bearbeiten →
              </Link>
            </div>
          )}
        </article>
      </div>
    </main>
  );
}
