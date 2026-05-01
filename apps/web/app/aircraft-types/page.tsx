import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { AircraftTypeBrowser } from './aircraft-type-browser';

/**
 * AircraftType Catalog Browse Page. Mirrors /airports/page.tsx pattern —
 * server-component fetches all active types, client-component handles
 * filter/search. Phase-1 catalog has ~150 seeded ICAO doc-8643 entries
 * + airline-proposed additions, all client-side filterable.
 *
 * Access: any logged-in user can browse. Submit gate is on the request
 * page (requires airline-admin).
 */
export default async function AircraftTypesBrowsePage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!user) redirect('/');

  const isAdmin = user.role?.name === 'admin';
  const canRequest = isAdmin && !!user.airlineId;

  const types = await prisma.aircraftType.findMany({
    where: { active: true },
    orderBy: [{ verified: 'desc' }, { manufacturer: 'asc' }, { icaoType: 'asc' }],
    select: {
      id: true,
      icaoType: true,
      name: true,
      manufacturer: true,
      category: true,
      rangeNm: true,
      capacityPax: true,
      cruiseSpeedKt: true,
      fuelBurnKgH: true,
      verified: true,
    },
  });

  const verifiedCount = types.filter((t) => t.verified).length;
  const unverifiedCount = types.length - verifiedCount;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Aircraft-Types</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {types.length} Types · {verifiedCount} verified ·{' '}
              {unverifiedCount} unverified
            </p>
          </div>
          <div className="flex gap-2">
            {canRequest && (
              <Link
                href="/aircraft-types/request"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-semibold transition"
              >
                + Neuen Type vorschlagen
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

        <AircraftTypeBrowser types={types} />
      </div>
    </main>
  );
}
