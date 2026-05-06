import Link from 'next/link';
import { prisma } from '@vam/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Vision §9.2.15 — Bulk-Import-Wizards (Discovery-Hub).
 *
 * # Was ist hier — und was nicht
 *
 * Dieses widget ist die DISCOVERY-card die admin/airline-admin zu den
 * existing bulk-import-tools navigiert. Die TOOLS selbst (CSV-upload,
 * preview, confirm-flow) leben in den verlinkten pages — die wurden
 * bereits in vorherigen tickets implementiert (Welle 6, see commit-
 * history).
 *
 * Bewusst NICHT in v1:
 *   - Cross-airline catalog-bulk-import (Airports, Aircraft-Types) als
 *     admin-level tool. Airline-admins können einzelne entries via
 *     `/airports/request` und `/aircraft-types/request` anfragen, aber
 *     das ist 1-by-1. Eine bulk-CSV-import für catalog-data ist eigenes
 *     ticket — siehe placeholder-cards unten mit "v2"-tag.
 *   - Pilots-bulk-import (user-creation): security-sensibel weil
 *     accounts erstellen + airline-zuordnen passwort-reset-emails
 *     triggern muss. Eigenes ticket mit security-review.
 *   - Migrations-helper für phpVMS/vAMSYS: braucht reverse-engineering
 *     der quell-schemas. Eigenes ticket pro source-system.
 *
 * # Pending-counts
 *
 * Zeigt count der pending catalog-requests (AirportRequest +
 * AircraftTypeRequest) in einem hint — das gibt admin einen "es liegt
 * was im review-queue"-signal ohne dass er extra zur /admin/requests-
 * page klicken muss.
 */
export async function BulkImportHub() {
  const [pendingAirports, pendingAircraftTypes] = await Promise.all([
    prisma.airportRequest.count({
      where: { status: { in: ['Submitted', 'UnderReview'] } },
    }),
    prisma.aircraftTypeRequest.count({
      where: { status: { in: ['Submitted', 'UnderReview'] } },
    }),
  ]);
  const totalPending = pendingAirports + pendingAircraftTypes;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span aria-hidden="true">📦</span>
              <span>Bulk-Import-Tools</span>
            </CardTitle>
            <CardDescription>
              CSV-Import für mehrere airline-records auf einmal — plus
              catalog-request-queue für cross-airline content.
            </CardDescription>
          </div>
          {totalPending > 0 && (
            <Link
              href="/admin/requests"
              className="shrink-0 text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition"
              title="Catalog-Requests zur review"
            >
              {totalPending} pending review
            </Link>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Existing airline-level tools — funktional. */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Airline-level (verfügbar)
          </p>
          <ImportLink
            href="/airline/routes/import"
            icon="🛫"
            label="Routes-CSV"
            hint="DEP, ARR, Aircraft, Frequenz pro zeile"
          />
          <ImportLink
            href="/airline/aircraft/import"
            icon="✈️"
            label="Aircraft-CSV"
            hint="Registration, Type, Home-ICAO, Status pro zeile"
          />
        </div>

        {/* Catalog-level tools — placeholders, eigene tickets. */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Catalog-level (geplant)
          </p>
          <ImportLink
            href="/airports/request"
            icon="🌍"
            label="Airports"
            hint={`einzeln-request via /airports/request${
              pendingAirports > 0 ? ` · ${pendingAirports} pending` : ''
            }`}
            badge="bulk v2"
          />
          <ImportLink
            href="/aircraft-types/request"
            icon="🛩️"
            label="Aircraft-Types"
            hint={`einzeln-request via /aircraft-types/request${
              pendingAircraftTypes > 0 ? ` · ${pendingAircraftTypes} pending` : ''
            }`}
            badge="bulk v2"
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Mini link-row für die import-tool-liste. Drei spalten: icon, label+hint,
 * optional badge. Hover-state vom übergeordneten card-design abgehoben
 * (eigener gray-100 wash) damit die rows als interactive lesbar sind.
 */
function ImportLink({
  href,
  icon,
  label,
  hint,
  badge,
}: {
  href: string;
  icon: string;
  label: string;
  hint: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2 rounded border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:border-primary transition"
    >
      <span className="shrink-0 text-xl" aria-hidden="true">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{hint}</p>
      </div>
      {badge && (
        <span className="shrink-0 text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
          {badge}
        </span>
      )}
    </Link>
  );
}
