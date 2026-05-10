import Link from 'next/link';
import { prisma } from '@vam/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Track 4 #49 (Section I) — Admin Quick-Actions.
 *
 * # Was ist das?
 *
 * Aktionsleiste oben auf /admin: zeigt offene catalog-requests + reviewed
 * today als deep-links. Vorher musste der admin auf "Catalog-Requests"
 * klicken um zu sehen ob was offen ist — jetzt steht's direkt auf der
 * landing als zahl + link.
 *
 * # Drei zellen
 *
 *   1. **Offene Airport-Requests** — count status in (Submitted,
 *      UnderReview). Link → /admin/requests.
 *   2. **Offene Aircraft-Type-Requests** — same shape.
 *   3. **Heute entschieden** — count über beide tabellen mit
 *      reviewedAt >= today-start (lokale TZ via JS Date). Feel-good-
 *      KPI ("ich hab heute X durch").
 *
 * # Render-strategie
 *
 * Wenn beide pending-zahlen 0 sind → grüner "alles clean" status,
 * card ist trotzdem da (wird sonst beim neu-aufpoppen übersehen).
 * Heute-entschieden bleibt 0 auch wenn pending 0 — das ist OK, ist
 * eine andere dimension.
 *
 * # Auth-scope
 *
 * Diese widget rendert NUR in /admin (system-admin-landing). Page
 * gated bereits via requireAdminPage, also keine extra-checks hier.
 * Counts sind plattform-weit weil catalog-requests global sind.
 *
 * # Revalidate
 *
 * Erbt von page (revalidate = 30s). Reicht — pending-requests
 * verändern sich nicht im sekunden-takt.
 */
async function getQuickActionData() {
  // Today-start in der server-TZ. Da der server in UTC läuft und
  // VAM-airlines weltweit sind, ist "heute" hier UTC-heute. Das ist
  // OK für ein "feel-good"-metric; ein ehrlicher per-admin-TZ-shift
  // wäre overengineered und würde client-side rendering brauchen.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [pendingAirports, pendingAircraftTypes, decidedAirportsToday, decidedAircraftTypesToday] =
    await Promise.all([
      prisma.airportRequest.count({
        where: { status: { in: ['Submitted', 'UnderReview'] } },
      }),
      prisma.aircraftTypeRequest.count({
        where: { status: { in: ['Submitted', 'UnderReview'] } },
      }),
      prisma.airportRequest.count({
        where: {
          status: { in: ['Approved', 'Rejected'] },
          reviewedAt: { gte: todayStart },
        },
      }),
      prisma.aircraftTypeRequest.count({
        where: {
          status: { in: ['Approved', 'Rejected'] },
          reviewedAt: { gte: todayStart },
        },
      }),
    ]);

  return {
    pendingAirports,
    pendingAircraftTypes,
    decidedToday: decidedAirportsToday + decidedAircraftTypesToday,
    totalPending: pendingAirports + pendingAircraftTypes,
  };
}

export async function AdminQuickActions() {
  const { pendingAirports, pendingAircraftTypes, decidedToday, totalPending } =
    await getQuickActionData();

  const allClear = totalPending === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden="true">⚡</span>
          <span>Quick-Actions</span>
        </CardTitle>
        <CardDescription>
          Offene Aufgaben & heutige Aktivität auf einen Blick.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/admin/requests"
            className="group block rounded-md border border-gray-200 dark:border-gray-800 p-4 hover:border-primary hover:shadow-sm transition"
          >
            <div className="flex items-baseline justify-between">
              <p className="text-xs uppercase tracking-wider text-gray-500">
                Airport-Requests
              </p>
              <span aria-hidden="true">🛬</span>
            </div>
            <p
              className={`mt-2 text-3xl font-bold ${
                pendingAirports > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-400 dark:text-gray-600'
              }`}
            >
              {pendingAirports}
            </p>
            <p className="text-xs text-gray-500 mt-1 group-hover:text-primary transition">
              {pendingAirports === 0 ? 'keine offen' : 'warten auf review →'}
            </p>
          </Link>

          <Link
            href="/admin/requests"
            className="group block rounded-md border border-gray-200 dark:border-gray-800 p-4 hover:border-primary hover:shadow-sm transition"
          >
            <div className="flex items-baseline justify-between">
              <p className="text-xs uppercase tracking-wider text-gray-500">
                Aircraft-Type-Requests
              </p>
              <span aria-hidden="true">✈️</span>
            </div>
            <p
              className={`mt-2 text-3xl font-bold ${
                pendingAircraftTypes > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-400 dark:text-gray-600'
              }`}
            >
              {pendingAircraftTypes}
            </p>
            <p className="text-xs text-gray-500 mt-1 group-hover:text-primary transition">
              {pendingAircraftTypes === 0 ? 'keine offen' : 'warten auf review →'}
            </p>
          </Link>

          <div className="rounded-md border border-gray-200 dark:border-gray-800 p-4 bg-gray-50/50 dark:bg-gray-900/30">
            <div className="flex items-baseline justify-between">
              <p className="text-xs uppercase tracking-wider text-gray-500">
                Heute entschieden
              </p>
              <span aria-hidden="true">✅</span>
            </div>
            <p
              className={`mt-2 text-3xl font-bold ${
                decidedToday > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-400 dark:text-gray-600'
              }`}
            >
              {decidedToday}
            </p>
            <p className="text-xs text-gray-500 mt-1">requests reviewt</p>
          </div>
        </div>

        {allClear && (
          <p className="mt-4 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <span aria-hidden="true">🎉</span>
            <span>Alle catalog-requests sind reviewt — nichts wartet.</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
