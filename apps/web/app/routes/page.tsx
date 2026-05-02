import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

export default async function Routes() {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const routes = await prisma.route.findMany({
    where: { active: true },
    include: {
      departure: true,
      arrival: true,
      airline: true,
    },
    orderBy: { flightNumber: 'asc' },
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Routes</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{routes.length} aktive Strecken</p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800/50">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Flug</th>
                <th className="px-4 py-3">Von</th>
                <th className="px-4 py-3">Nach</th>
                <th className="px-4 py-3 text-right">Distanz</th>
                <th className="px-4 py-3 text-right">Dauer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {routes.map((route) => (
                <tr key={route.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition">
                  <td className="px-4 py-3 font-mono font-semibold">{route.flightNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{route.departure.icao}</div>
                    <div className="text-xs text-gray-500">{route.departure.city}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{route.arrival.icao}</div>
                    <div className="text-xs text-gray-500">{route.arrival.city}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{route.distanceNm} nm</td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                    {Math.floor(route.estimatedMinutes / 60)}h {route.estimatedMinutes % 60}min
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
