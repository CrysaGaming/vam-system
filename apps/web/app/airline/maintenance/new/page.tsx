/**
 * Welle L / L3 — /airline/maintenance/new page.
 */

import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import NewMaintenanceForm from './_form';

export const dynamic = 'force-dynamic';

export default async function NewMaintenancePage() {
  const user = await requireAirlineManagerWithAirlinePage();

  const aircrafts = await prisma.aircraft.findMany({
    where: { airlineId: user.airlineId, status: 'ACTIVE' },
    orderBy: { registration: 'asc' },
    select: { id: true, registration: true, type: true },
    take: 200,
  });

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl">
        <nav className="mb-4 text-xs">
          <Link
            href="/airline/maintenance"
            className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            ← Zurück zur Maintenance-Liste
          </Link>
        </nav>
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="text-2xl font-bold">Neues Maintenance-Event</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plane wartung für ein aircraft. Status startet als Scheduled.
          </p>
        </header>
        {aircrafts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Keine aktiven aircraft in deiner fleet. Lege erst aircraft an unter{' '}
            <Link
              href="/airline/aircraft"
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              /airline/aircraft
            </Link>
            .
          </div>
        ) : (
          <NewMaintenanceForm aircrafts={aircrafts} />
        )}
      </div>
    </main>
  );
}
