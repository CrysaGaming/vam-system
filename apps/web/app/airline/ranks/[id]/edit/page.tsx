import { notFound  } from 'next/navigation';
import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { RankForm } from '../../rank-form';

/**
 * /airline/ranks/[id]/edit — Edit-page für einen einzelnen Rang.
 *
 * Auth-gate spiegelt actions.ts. Multi-tenant: rank muss zur airline des
 * actors gehören, sonst 404. Same pattern wie /airline/aircraft/[id]/edit.
 */
export default async function EditRankPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const { id: rankId } = await params;
  const rank = await prisma.rank.findUnique({
    where: { id: rankId },
    include: { _count: { select: { users: true } } },
  });

  // Multi-tenant 404: rank existiert nicht ODER gehört zu anderer airline.
  // Beide cases werden als 404 gerendert (kein info-leak welches der zwei
  // gründe ist). Same pattern wie aircraft/[id]/edit.
  if (!rank || rank.airlineId !== user.airlineId) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <Link
              href="/airline/ranks"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Zurück zur Rang-Übersicht
            </Link>
            <h1 className="text-3xl font-bold tracking-tight mt-2">
              Rang bearbeiten
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} —{' '}
              <span className="font-mono">{rank.name}</span>
            </p>
          </div>
        </header>

        {/* Edit-form */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <RankForm
            mode={{
              kind: 'edit',
              rankId: rank.id,
              initialName: rank.name,
              initialMinFlightHours: rank.minFlightHours,
              initialOrder: rank.order,
            }}
          />
        </div>

        {/* Hinweis wenn piloten zugeordnet sind */}
        {rank._count.users > 0 && (
          <aside className="mt-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-300">
            <p>
              <strong>Hinweis:</strong> {rank._count.users}{' '}
              {rank._count.users === 1 ? 'Pilot hat' : 'Piloten haben'}{' '}
              aktuell diesen Rang. Änderungen am Namen oder am
              minFlightHours-Threshold wirken sich sofort auf alle
              betroffenen Piloten aus.
            </p>
            <p className="mt-2">
              Wenn du <code>minFlightHours</code> erhöhst und einige
              Piloten den neuen Threshold nicht mehr erreichen, behalten
              sie ihren Rang trotzdem (kein automatisches Demote). Erst
              bei einem manuellen &ldquo;Ränge neu auswerten&rdquo; werden
              Demote-changes durchgeführt.
            </p>
          </aside>
        )}
      </div>
    </main>
  );
}
