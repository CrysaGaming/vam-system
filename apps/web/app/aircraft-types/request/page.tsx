import { prisma } from '@vam/db';
import Link from 'next/link';
import { requireAdminWithAirlinePage } from '@/lib/roles';
import { AircraftTypeRequestForm } from './aircraft-type-request-form';

/**
 * Submit page for an AircraftType-Catalog request. Mirrors
 * /airports/request/page.tsx — airline-admins propose a new aircraft-type
 * which goes into the request-queue for system-admin review.
 *
 * Gate: requires role='admin' AND airline assignment.
 */
export default async function AircraftTypeRequestPage() {
  const user = await requireAdminWithAirlinePage('/aircraft-types');

  const myPendingRequests = await prisma.aircraftTypeRequest.findMany({
    where: {
      requestedById: user.id,
      status: { in: ['Submitted', 'UnderReview'] },
    },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      icaoType: true,
      name: true,
      submittedAt: true,
      status: true,
    },
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Neuen Aircraft-Type vorschlagen</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Vorschlag geht an die System-Admins zur Review. Du wirst
              benachrichtigt sobald approve oder reject stattfindet.
            </p>
          </div>
          <Link
            href="/aircraft-types"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Katalog
          </Link>
        </header>

        {myPendingRequests.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-900/30 rounded-lg">
            <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-2">
              Deine offenen Vorschläge ({myPendingRequests.length})
            </h3>
            <ul className="text-xs text-yellow-700 dark:text-yellow-200 space-y-1">
              {myPendingRequests.map((r) => (
                <li key={r.id} className="font-mono">
                  {r.icaoType} – {r.name}{' '}
                  <span className="text-yellow-600 dark:text-yellow-400">
                    [{r.status}]
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <AircraftTypeRequestForm
          airlineIcao={user.airline?.icao ?? null}
          airlineName={user.airline?.name ?? null}
        />
      </div>
    </main>
  );
}
