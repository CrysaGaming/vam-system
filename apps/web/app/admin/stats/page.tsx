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

  // === Track 4 #48 (Section I): Approval-Rate + 7-day-window KPIs ===
  // Approval-rate ist die quote Approved / (Approved + Rejected) — nur
  // genehmigt/abgelehnt zählen mit, "Submitted" (noch pending) ist NICHT
  // im divisor, weil die nicht-entschiedenen-pireps die rate sonst nach
  // oben drücken würden (wir wissen ja noch nicht ob sie genehmigt werden).
  // Wenn die airline nur Submitted-pireps hat, ist die rate undefiniert
  // → wir zeigen "—" als display-value.
  //
  // 7-day-window: Anzahl Submitted-Pireps in den letzten 7 Tagen. Egal
  // welcher status — admins wollen sehen wie viel grade angekommen ist.
  // Hilft beim moderieren ("oh, diese woche viel zu tun").
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [approvedCount, rejectedCount, recent7dCount] = await Promise.all([
    prisma.pirep.count({ where: { airlineId, status: 'Approved' } }),
    prisma.pirep.count({ where: { airlineId, status: 'Rejected' } }),
    prisma.pirep.count({
      where: { airlineId, submittedAt: { gte: sevenDaysAgo } },
    }),
  ]);

  const reviewedTotal = approvedCount + rejectedCount;
  const approvalRate =
    reviewedTotal > 0
      ? `${Math.round((approvedCount / reviewedTotal) * 100)}%`
      : '—';
  // Color-coding: >=90% grün, >=70% gelb, <70% rot — gibt admins beim
  // glance einen status. "—" bleibt neutral.
  const approvalRateColor =
    reviewedTotal === 0
      ? 'text-gray-900 dark:text-white'
      : approvedCount / reviewedTotal >= 0.9
        ? 'text-emerald-600 dark:text-emerald-400'
        : approvedCount / reviewedTotal >= 0.7
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400';

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
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Statistiken</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline?.name} · Admin-Dashboard
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
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
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Total Flüge
            </p>
            <p className="text-4xl font-bold">{totalFlights}</p>
            <p className="text-xs text-gray-500 mt-1">eingereichte PIREPs</p>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Total Stunden
            </p>
            <p className="text-4xl font-bold">{totalHours}</p>
            <p className="text-xs text-gray-500 mt-1">geflogen (genehmigt)</p>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Aktive Piloten
            </p>
            <p className="text-4xl font-bold">{activePilots}</p>
            <p className="text-xs text-gray-500 mt-1">mit ≥ 1 Flug</p>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Ø Flugzeit
            </p>
            <p className="text-4xl font-bold">{avgTime}</p>
            <p className="text-xs text-gray-500 mt-1">pro PIREP</p>
          </div>

          {/* Track 4 #48: Approval-Rate KPI — die quote Approved/(Approved+Rejected). */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Approval-Rate
            </p>
            <p className={`text-4xl font-bold ${approvalRateColor}`}>
              {approvalRate}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {reviewedTotal > 0
                ? `${approvedCount}/${reviewedTotal} entschieden`
                : 'noch nichts entschieden'}
            </p>
          </div>

          {/* Track 4 #48: 7-Tage-Fenster KPI — wie viele PIREPs sind diese woche reingekommen. */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Letzte 7 Tage
            </p>
            <p className="text-4xl font-bold">{recent7dCount}</p>
            <p className="text-xs text-gray-500 mt-1">PIREPs eingereicht</p>
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