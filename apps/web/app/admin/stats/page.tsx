import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { StatsCharts } from './stats-charts';

const ALLOWED_ROLES = ['admin', 'instructor'];

export default async function AdminStats() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });

  if (!user?.role || !ALLOWED_ROLES.includes(user.role.name)) {
    redirect('/dashboard');
  }

  if (!user.airlineId) redirect('/dashboard');

  const airlineId = user.airlineId;

  // === KPIs ===
  const totalFlights = await prisma.pirep.count({
    where: { airlineId },
  });

  const flightTimeAgg = await prisma.pirep.aggregate({
    where: { airlineId, status: 'Approved' },
    _sum: { flightTimeMin: true },
    _avg: { flightTimeMin: true },
  });

  const totalHours = ((flightTimeAgg._sum.flightTimeMin ?? 0) / 60).toFixed(1);
  const avgMinutes = Math.round(flightTimeAgg._avg.flightTimeMin ?? 0);
  const avgHours = Math.floor(avgMinutes / 60);
  const avgMins = avgMinutes % 60;
  const avgTime = avgHours > 0 ? `${avgHours}h ${avgMins}min` : `${avgMins}min`;

  const activePilots = await prisma.user.count({
    where: { airlineId, totalFlights: { gt: 0 } },
  });

  // === Chart 1: Flüge pro Monat (letzte 6 Monate) ===
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const allPireps = await prisma.pirep.findMany({
    where: {
      airlineId,
      submittedAt: { gte: sixMonthsAgo },
    },
    select: { submittedAt: true },
  });

  // Aggregiere nach Monat
  const monthsMap = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'short',
    });
    monthsMap.set(key, 0);
  }

  for (const pirep of allPireps) {
    const key = pirep.submittedAt.toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'short',
    });
    if (monthsMap.has(key)) {
      monthsMap.set(key, monthsMap.get(key)! + 1);
    }
  }

  const flightsPerMonth = Array.from(monthsMap.entries()).map(
    ([month, flights]) => ({
      month,
      flights,
    }),
  );

  // === Chart 2: Top 5 Routen ===
  const routeCounts = await prisma.pirep.groupBy({
    by: ['routeId'],
    where: { airlineId, routeId: { not: null } },
    _count: { routeId: true },
    orderBy: { _count: { routeId: 'desc' } },
    take: 5,
  });

  const topRoutes = await Promise.all(
    routeCounts.map(async (rc) => {
      if (!rc.routeId) return null;
      const route = await prisma.route.findUnique({
        where: { id: rc.routeId },
        include: { departure: true, arrival: true },
      });
      if (!route) return null;
      return {
        route: `${route.flightNumber} ${route.departure.icao}→${route.arrival.icao}`,
        flights: rc._count.routeId,
      };
    }),
  );

  const topRoutesData = topRoutes.filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );

  // === Chart 3: PIREPs nach Status ===
  const statusCounts = await prisma.pirep.groupBy({
    by: ['status'],
    where: { airlineId },
    _count: { status: true },
  });

  const statusLabels: Record<string, string> = {
    Approved: 'Genehmigt',
    Submitted: 'Eingereicht',
    Rejected: 'Abgelehnt',
  };

  const statusData = statusCounts.map((sc) => ({
    status: statusLabels[sc.status] ?? sc.status,
    count: sc._count.status,
  }));

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Statistiken</h1>
            <p className="text-gray-400 text-sm mt-1">
              {user.airline?.name} · Admin-Dashboard
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </header>

        {/* KPI-Cards */}
        <div
          className="grid gap-6 mb-8"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Total Flüge
            </p>
            <p className="text-4xl font-bold">{totalFlights}</p>
            <p className="text-xs text-gray-500 mt-1">eingereichte PIREPs</p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Total Stunden
            </p>
            <p className="text-4xl font-bold">{totalHours}</p>
            <p className="text-xs text-gray-500 mt-1">geflogen (genehmigt)</p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Aktive Piloten
            </p>
            <p className="text-4xl font-bold">{activePilots}</p>
            <p className="text-xs text-gray-500 mt-1">mit ≥ 1 Flug</p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Ø Flugzeit
            </p>
            <p className="text-4xl font-bold">{avgTime}</p>
            <p className="text-xs text-gray-500 mt-1">pro PIREP</p>
          </div>
        </div>

        {/* Charts */}
        <StatsCharts
          flightsPerMonth={flightsPerMonth}
          topRoutes={topRoutesData}
          statusData={statusData}
        />
      </div>
    </main>
  );
}