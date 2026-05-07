import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PirepFlowTimeline } from './_components/pirep-flow-timeline';
import { TopRoutes } from './_components/top-routes';
import { RecentBookingsPipeline } from './_components/recent-bookings-pipeline';

/**
 * Airline-Admin-Dashboard — Track 3 #11.2.5 Foundation-Slice.
 *
 * Skelett-Landing für /airline/dashboard. Bewusst SEPARAT von
 * /airline/page.tsx (= AirlineSettingsForm + MemberTable) angelegt damit
 * der refactor non-destruktiv ist:
 *   - /airline             → bleibt Settings-Form (existing)
 *   - /airline/dashboard   → neu: Übersicht/Cards/Stats
 *
 * Falls später entschieden wird /airline soll das Dashboard sein, ist's
 * ein leichter rename + redirect — kein refactor der existing settings-
 * page nötig.
 *
 * # Status
 *
 * Skelett — Cards für die existing /airline/* sub-routes als Navigation,
 * KPI-platzhalter für member-count und einen TODO-bereich für widgets
 * (PIREP-flow-stats, fleet-utilization, etc.). Die echten widgets
 * kommen in v1-full (3-4 Wochen scope).
 *
 * # Auth
 *
 * AIRLINE_MANAGER_ROLES synchron mit AppShell.canManageAirline. Wer
 * keine airline hat, geht zu /dashboard (selbe logik wie /airline).
 * Statistik-conditionals sind v2 — heute werden alle cards gezeigt
 * und einzelne sub-routes gaten weiter (z.B. /airline/finance braucht
 * economy-toggle-on).
 */
export default async function AirlineDashboardPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  if (!user.airline) {
    redirect('/dashboard');
  }

  const airline = user.airline;
  const airlineId = airline.id;

  const [memberCount, fleetCount, routeCount, pendingPireps] = await Promise.all([
    prisma.user.count({ where: { airlineId } }),
    prisma.aircraft.count({ where: { airlineId } }),
    prisma.route.count({ where: { airlineId } }),
    prisma.pirep.count({ where: { airlineId, status: 'Submitted' } }),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold">Airline-Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {airline.name} · {airline.icao}
            {airline.iata && ` · ${airline.iata}`}
          </p>
        </header>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4">Überblick</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Personal" value={memberCount} />
            <KpiCard label="Fleet" value={fleetCount} />
            <KpiCard label="Routen" value={routeCount} />
            <KpiCard label="PIREPs zur Prüfung" value={pendingPireps} highlight={pendingPireps > 0} />
          </div>
        </section>

        <PirepFlowTimeline airlineId={airlineId} />

        <RecentBookingsPipeline airlineId={airlineId} />

        <TopRoutes airlineId={airlineId} />

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4">Verwaltung</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardCard
              href="/airline"
              icon="🏢"
              title="Settings & Member"
              description="Airline-Stammdaten, Branding, Member-Liste, Invites."
            />
            <DashboardCard
              href="/airline/hubs"
              icon="📍"
              title="Hubs"
              description="Multi-Hub-System, Pilot-Zuweisungen."
            />
            <DashboardCard
              href="/airline/aircraft"
              icon="🛩️"
              title="Aircraft"
              description="Einzelne Flugzeuge — Status, Position, Lifecycle."
            />
            <DashboardCard
              href="/airline/fleet"
              icon="📊"
              title="Fleet-Übersicht"
              description="Aggregierte Flotte nach Type + Subfleet."
            />
            <DashboardCard
              href="/airline/routes"
              icon="🛣️"
              title="Routen"
              description="Route-CRUD, CSV-Bulk-Import."
            />
            <DashboardCard
              href="/airline/schedule"
              icon="🕒"
              title="Schedule"
              description="Schedule-Templates und Instance-Generator."
            />
            <DashboardCard
              href="/airline/pilots"
              icon="👥"
              title="Personal"
              description="Personnel-Management, Lizenzen, Type-Ratings."
            />
            <DashboardCard
              href="/airline/ranks"
              icon="🏅"
              title="Ränge"
              description="Rank-CRUD, Auto-Promotion-Regeln."
            />
            <DashboardCard
              href="/airline/finance"
              icon="💼"
              title="Finanzen"
              description="Airline-Wallet, Transaktionen, Statistik (Economy-Toggle erforderlich)."
            />
          </div>
        </section>

        <TodoSection />
      </div>
    </main>
  );
}

interface KpiCardProps {
  label: string;
  value: number;
  highlight?: boolean;
}

function KpiCard({ label, value, highlight = false }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="px-6">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </div>
        <div className={`mt-1 text-3xl font-semibold ${highlight ? 'text-primary' : ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

interface DashboardCardProps {
  href: string;
  icon: string;
  title: string;
  description: string;
}

function DashboardCard({ href, icon, title, description }: DashboardCardProps) {
  return (
    <Link href={href} className="block group">
      <Card className="h-full transition group-hover:border-primary group-hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span aria-hidden="true">{icon}</span>
            <span>{title}</span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

/**
 * Platzhalter-section für die verbleibenden widgets aus
 * docs/vision/admin-dashboards-vision.md Section 7.3. Phase B Operations-
 * Widgets werden inkrementell ge-shipped — siehe _components/* für die
 * bereits live widgets. Verbleibend: fleet-utilization, recent-bookings,
 * pilot-ranking-airline-scoped.
 */
function TodoSection() {
  return (
    <section className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold mb-2">
        🚧 Weitere Operations-Widgets
        <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Phase B in progress
        </span>
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
        Phase B widgets-progress: PIREP-Flow-Timeline ✅, Booking-Pipeline ✅,
        Top-Routen ✅. Verbleibend: Fleet-Utilization, Pilot-Ranking-Board
        (airline-scoped). Spec:{' '}
        <code className="text-xs">docs/vision/admin-dashboards-vision.md</code> §7.3.
      </p>
    </section>
  );
}
