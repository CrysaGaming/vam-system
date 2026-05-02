import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { RequestsQueue } from './requests-queue';

/**
 * Admin Request-Queue. Combined view of open AirportRequests + AircraftType-
 * Requests. Phase 1 single-tenant: same admin role gates submit AND approve;
 * Phase 2 will introduce a dedicated system-admin distinction so airline-
 * admins cannot self-approve.
 *
 * Defense-in-depth — server actions also check requireSystemAdmin, so even
 * if a non-admin loads this page, mutations are blocked.
 */
export default async function AdminRequestsPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    redirect('/dashboard');
  }

  // Open requests = Submitted + UnderReview. Approved/Rejected go into a
  // separate "Recent Decisions" section (TODO Phase 1.x — for now we show
  // only the queue).
  const [airportRequests, aircraftTypeRequests] = await Promise.all([
    prisma.airportRequest.findMany({
      where: { status: { in: ['Submitted', 'UnderReview'] } },
      orderBy: { submittedAt: 'asc' },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        requestedAirline: { select: { id: true, icao: true, name: true } },
      },
    }),
    prisma.aircraftTypeRequest.findMany({
      where: { status: { in: ['Submitted', 'UnderReview'] } },
      orderBy: { submittedAt: 'asc' },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        requestedAirline: { select: { id: true, icao: true, name: true } },
      },
    }),
  ]);

  const totalOpen = airportRequests.length + aircraftTypeRequests.length;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">
              Request-Queue
              {totalOpen > 0 && (
                <span className="ml-3 px-3 py-1 text-sm font-semibold rounded-full bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                  {totalOpen} offen
                </span>
              )}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              Airline-Vorschläge für neue Airports + Aircraft-Types. Approve oder reject.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <RequestsQueue
          airportRequests={airportRequests}
          aircraftTypeRequests={aircraftTypeRequests}
        />
      </div>
    </main>
  );
}
