import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdminPage } from '@/lib/roles';

/**
 * Server-Admin-Dashboard — Track 3 #11.2.5 Foundation-Slice.
 *
 * Skelett-Landing für /admin. Vorher war /admin ein 404 weil nur sub-
 * routes (/admin/stats, /admin/pilots, etc.) existierten. Diese page
 * hängt das verzeichnis sichtbar zusammen + reserviert einen
 * placeholder-bereich für die Top-10-Innovation-Items aus
 * docs/vision/admin-dashboards-vision.md Section 9.
 *
 * # Status
 *
 * Skelett. Innovation-items-auswahl ist eigenes Design-Gespräch
 * (~30 vision-options sortieren). Die <TodoSection /> unten ist der
 * platzhalter — sobald entschieden wird welche items rein sollen,
 * werden sie inkrementell gegen die platzhalter-cards getauscht.
 *
 * # Auth
 *
 * Nur für isAdmin (system-rolle). instructor + airline-admin haben
 * eigene dashboards/sections und sollen hier nicht landen — die
 * sub-routes (/admin/stats etc.) gaten teilweise weiter (instructor
 * darf z.B. PIREPs zur Prüfung sehen). Hier auf der Landing strikt
 * admin-only weil das gesamte ressort gemeint ist.
 */
export default async function AdminDashboardPage() {
  await requireAdminPage();

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

        <TodoSection />
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
 * Platzhalter-section für die Top-10-Innovation-Items aus
 * docs/vision/admin-dashboards-vision.md Section 9. Die items selbst
 * werden in einem späteren Design-Gespräch ausgewählt — die ~30 vision-
 * options sortieren ist nicht teil des Foundation-Slice. Diese section
 * existiert damit die platzierung in der dashboard-architektur
 * festgenagelt ist und items inkrementell rein können ohne layout-
 * umbau.
 */
function TodoSection() {
  return (
    <section className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold mb-2">
        🚧 Innovation-Items
        <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Top-10 — Auswahl pending
        </span>
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
        Platzhalter für die Top-10-Innovation-Items aus
        {' '}<code className="text-xs">docs/vision/admin-dashboards-vision.md</code> §9.
        Item-Selection ist ein eigenes Design-Gespräch — wenn entschieden,
        kommen die widgets hier rein (Live-Settings-Updates, Multi-User-
        Cursor, Dispatch-AI, Heatmaps, ECAM-Style-Diagnostics, ...).
      </p>
    </section>
  );
}
