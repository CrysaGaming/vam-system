import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { AirportRequestForm } from './airport-request-form';

/**
 * Submit page for an Airport-Catalog request. Airline-admins propose a new
 * airport which goes into the request-queue for system-admin review. See
 * /admin/requests for the queue.
 *
 * Gate: requires role='admin' AND airline assignment (matches the server
 * action's requireAirlineAdmin gate).
 *
 * Phase 1 single-tenant simplification — both admin and system-admin are
 * the same role currently, see actions.ts for the Phase 2 split plan.
 */
export default async function AirportRequestPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });
  if (!user) redirect('/');

  if (!user.role || user.role.name !== 'admin') {
    redirect('/airports');
  }
  if (!user.airlineId) {
    redirect('/airports');
  }

  // List user's own pending requests for context — avoids confusion when
  // re-submitting (duplicate-detection will reject it server-side).
  const myPendingRequests = await prisma.airportRequest.findMany({
    where: {
      requestedById: user.id,
      status: { in: ['Submitted', 'UnderReview'] },
    },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      icao: true,
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
            <h1 className="text-3xl font-bold">Neuen Airport vorschlagen</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Vorschlag geht an die System-Admins zur Review. Du wirst
              benachrichtigt sobald approve oder reject stattfindet.
            </p>
          </div>
          <Link
            href="/airports"
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
                  {r.icao} – {r.name}{' '}
                  <span className="text-yellow-600 dark:text-yellow-400">
                    [{r.status}]
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <AirportRequestForm
          airlineIcao={user.airline?.icao ?? null}
          airlineName={user.airline?.name ?? null}
        />
      </div>
    </main>
  );
}
