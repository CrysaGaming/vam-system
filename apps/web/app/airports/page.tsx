import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { AirportBrowser } from './airport-browser';

/**
 * Airport Catalog Browse Page. Shows ALL airports (verified + unverified) so
 * airline-admins can find what they need before deciding to request a new
 * one. Filter/search is done client-side over a fully-loaded list — for
 * Phase 1 with O(15-1000) airports this is fine; if catalog grows past
 * ~10k entries we'll add server-side pagination.
 *
 * Access: any logged-in user can browse. Submit-request gate is on the
 * /airports/request page (requires airline-admin).
 */
export default async function AirportsBrowsePage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!user) redirect('/');

  const isAdmin = user.role?.name === 'admin';
  const canRequest = isAdmin && !!user.airlineId;

  const airports = await prisma.airport.findMany({
    where: { active: true },
    orderBy: [{ verified: 'desc' }, { icao: 'asc' }],
    select: {
      id: true,
      icao: true,
      iata: true,
      name: true,
      city: true,
      country: true,
      latitude: true,
      longitude: true,
      elevation: true,
      verified: true,
    },
  });

  const verifiedCount = airports.filter((a) => a.verified).length;
  const unverifiedCount = airports.length - verifiedCount;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Airport-Katalog</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {airports.length} Airports · {verifiedCount} verified ·{' '}
              {unverifiedCount} unverified
            </p>
          </div>
          <div className="flex gap-2">
            {canRequest && (
              <Link
                href="/airports/request"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-semibold transition"
              >
                + Neuen Airport vorschlagen
              </Link>
            )}
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        <AirportBrowser airports={airports} />
      </div>
    </main>
  );
}
