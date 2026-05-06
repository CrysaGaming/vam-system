import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdminPage } from '@/lib/roles';
import { ActivePilotsCounter } from './_widgets/active-pilots-counter';
import { PilotBirthdayCalendar } from './_widgets/pilot-birthday-calendar';
import { PirepHeatmap } from './_widgets/pirep-heatmap';
import { DiscordPirepBroadcast } from './_widgets/discord-pirep-broadcast';
import { PilotRankingBoard } from './_widgets/pilot-ranking-board';

/**
 * Track 3 #11.2.5 v1-Full Innovation-Items aus
 * docs/vision/admin-dashboards-vision.md §9. Top-10 mix (S+M+L) wird
 * inkrementell hier eingebaut. Status pro item:
 *
 *   1. ✅ 9.1.13 Active-Pilots-Counter (Live)            [S]
 *   2. ✅ 9.1.14 Pilot-Birthday-Calendar                 [S]
 *   3. ✅ 9.1.1  PIREP-Heatmaps                          [S]
 *   4. ✅ 9.2.10 Realtime-Discord-PIREP-Embed            [M]
 *   5. ✅ 9.2.5  Pilot-Ranking-Board mit Filtern         [M]
 *   6. ⏳ 9.2.15 Bulk-Import-Wizards                     [M]
 *   7. ⏳ 9.3.5  Awards-Crafting-System                  [L]
 *   8. ⏳ 9.3.10 Notification-Center (In-App)            [L]
 *   9. ⏳ 9.3.16 Tour-Calendar mit Saisonalen-Events     [L]
 *  10. ⏳ 9.3.20 Airport-Detail-Pages mit Live-Stats     [L]
 */

/**
 * Page-segment-config: `revalidate = 30` heißt der nächste request
 * nach 30s+ rendert frische daten (für die live-aktivität-widgets).
 * Die page bleibt SSR (dynamic auth-gate) aber die DB-queries werden
 * für 30s gecached. Bei page-visit wird der counter also "fast live"
 * (max 30s alt). Echtes WebSocket-push ist separates ticket §9.2.1.
 */
export const revalidate = 30;

/**
 * Server-Admin-Dashboard — Track 3 #11.2.5.
 *
 * # Status
 *
 * Verzeichnis-landing-page (`<DashboardCard>`-grid zu sub-routes) +
 * incremental ergänzt mit den Top-10-Innovation-Items aus vision-doc
 * §9 (siehe header-checklist oben). Pro neu gebautem widget wird die
 * `<InnovationItems />`-section unten erweitert.
 *
 * # Auth
 *
 * Nur für isAdmin (system-rolle). instructor + airline-admin haben
 * eigene dashboards/sections und sollen hier nicht landen — die
 * sub-routes (/admin/stats etc.) gaten teilweise weiter (instructor
 * darf z.B. PIREPs zur Prüfung sehen). Hier auf der Landing strikt
 * admin-only weil das gesamte ressort gemeint ist.
 */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const resolvedSearchParams = await searchParams;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold">Server-Admin</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Plattform-weite Verwaltung — System-Settings, Cross-Airline-Tools, Catalog-Curation
          </p>
        </header>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4">Verwaltung</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardCard
              href="/admin/stats"
              icon="📊"
              title="Statistiken"
              description="Plattform-KPIs, Flight-Time-Trends, Top-Routen, aktive Piloten."
            />
            <DashboardCard
              href="/admin/pilots"
              icon="👥"
              title="Alle Piloten"
              description="Cross-Airline-Pilotenverzeichnis mit Filter, Bulk-Aktionen, Rollen-Zuweisung."
            />
            <DashboardCard
              href="/admin/roles"
              icon="🔐"
              title="Rollen"
              description="Rollen-Definitionen + Permission-Strings (System-weit)."
            />
            <DashboardCard
              href="/admin/requests"
              icon="📥"
              title="Catalog-Requests"
              description="Airport- und Aircraft-Type-Anfragen reviewen und verifizieren."
            />
            <DashboardCard
              href="/admin/awards"
              icon="🏆"
              title="Awards"
              description="Award-Katalog + manuelle Vergabe."
            />
            <DashboardCard
              href="/admin/sceneries"
              icon="🗺️"
              title="Sceneries"
              description="Scenery-Katalog kuratieren (Cross-Sim, Cross-Airline)."
            />
            <DashboardCard
              href="/admin/events"
              icon="📅"
              title="Events"
              description="Plattform-Events erstellen und verwalten (VA-wide oder per Airline)."
            />
            <DashboardCard
              href="/admin/flight-schools"
              icon="🎓"
              title="Flugschulen"
              description="Cross-Airline-NPC-Flugschulen pflegen (Career-Mode-Foundation)."
            />
          </div>
        </section>

        <InnovationItems searchParams={resolvedSearchParams} />
      </div>
    </main>
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
 * Innovation-Items — Top-10 widgets für /admin (vision-doc §9). Wird
 * inkrementell befüllt; siehe header-status oben für check-list. Layout
 * mischt full-width zeilen (für viz-heavy widgets wie heatmaps) mit
 * grid-zeilen (für stat-cards). Pro neuem widget: imports + ein
 * `<WidgetX />` einfügen + status-comment im header anpassen.
 *
 * # searchParams-prop
 *
 * Wird von der page durchgereicht. Die meisten widgets ignorieren das,
 * aber `<PilotRankingBoard />` liest filter-keys (rank_mode, rank_period,
 * rank_aircraft) für seine GET-form-controls.
 */
function InnovationItems({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <section className="space-y-6">
      <header className="flex items-baseline gap-3 border-b border-gray-200 dark:border-gray-800 pb-2">
        <h2 className="text-lg font-semibold">Innovation-Items</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          5 / 10 — Track 3 #11.2.5 v1-Full
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivePilotsCounter />
        <PilotBirthdayCalendar />
        <DiscordPirepBroadcast />
        <PilotRankingBoard searchParams={searchParams} />
      </div>

      <PirepHeatmap />
    </section>
  );
}
