import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma, getSceneryById } from '@vam/db';
import {
  EditSceneryForm,
  DeleteSceneryButton,
  type AirlineOption,
} from '../admin-forms';

/**
 * Track 1 #3 (Sceneries-Catalog UI, 9.2.4) — Admin scenery edit-detail.
 *
 * Focused edit-page für eine einzelne scenery. Anders als die inline-
 * edit in /admin/sceneries (collapsible <details>) kriegt man hier den
 * vollen platz für formular + delete + metadata-anzeige.
 *
 * Nicht-existent → notFound() (rendered 404). Delete-redirect navigiert
 * zurück auf /admin/sceneries (definiert in deleteSceneryAction).
 */
export default async function AdminSceneryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    redirect('/dashboard');
  }

  const { id } = await params;

  const [scenery, airlinesRaw] = await Promise.all([
    getSceneryById(id),
    prisma.airline.findMany({
      select: { id: true, name: true, iata: true, icao: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!scenery) notFound();

  const airlines: AirlineOption[] = airlinesRaw;

  // Format created-at als locale-string für metadata-display.
  const createdAtFormatted = scenery.createdAt.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/admin/sceneries"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 inline-block"
        >
          ← Zurück zur Liste
        </Link>

        <header className="mb-6">
          <h1 className="text-2xl font-bold mb-1">{scenery.name}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Hinzugefügt am {createdAtFormatted}
            {scenery.airline && (
              <>
                {' · airline-spezifisch ('}
                <span className="text-amber-700 dark:text-amber-400">
                  {scenery.airline.name}
                </span>
                {')'}
              </>
            )}
            {!scenery.airlineId && ' · global'}
          </p>
        </header>

        {/* Edit-form section */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-4">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Bearbeiten
          </h2>
          <EditSceneryForm scenery={scenery} airlines={airlines} />
        </section>

        {/* Public-link section: convenience-link um die public-detail
            anzuschauen wie sie für users aussieht. */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium">Öffentliche Detail-Ansicht</p>
            <p className="text-xs text-gray-500">
              So sehen piloten diese scenery im catalog.
            </p>
          </div>
          <Link
            href={`/sceneries/${scenery.id}`}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded font-medium transition"
          >
            Öffnen →
          </Link>
        </section>

        {/* Danger-zone */}
        <section className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-red-700 dark:text-red-400 mb-2">
            Danger zone
          </h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
            Diese Aktion kann nicht rückgängig gemacht werden. Die Scenery
            wird permanent aus dem Katalog entfernt.
          </p>
          <DeleteSceneryButton
            sceneryId={scenery.id}
            sceneryName={scenery.name}
          />
        </section>
      </div>
    </main>
  );
}
