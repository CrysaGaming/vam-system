import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { ScheduleTemplateForm } from '../schedule-template-form';

/**
 * /airline/schedule/new — Neues template anlegen.
 *
 * Server-component lädt die routes + aircraft der eigenen airline für
 * die select-felder im form. Active routes werden zuerst sortiert
 * (admin will normalerweise eine active route nutzen).
 */
export default async function NewScheduleTemplatePage() {
  const user = await requireAirlineManagerWithAirlinePage();
  const [routes, aircraft] = await Promise.all([
    prisma.route.findMany({
      where: { airlineId: user.airlineId },
      include: {
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
      },
      orderBy: [{ active: 'desc' }, { flightNumber: 'asc' }],
    }),
    prisma.aircraft.findMany({
      where: { airlineId: user.airlineId, status: 'ACTIVE' },
      select: { id: true, registration: true, type: true },
      orderBy: [{ registration: 'asc' }],
    }),
  ]);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <Link
              href="/airline/schedule"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Zurück zur Schedule-Übersicht
            </Link>
            <h1 className="text-3xl font-bold tracking-tight mt-2">
              Neues Schedule-Template
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name}
            </p>
          </div>
        </header>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <ScheduleTemplateForm
            mode={{ kind: 'create' }}
            routes={routes.map((r) => ({
              id: r.id,
              flightNumber: r.flightNumber,
              departureIcao: r.departure.icao,
              arrivalIcao: r.arrival.icao,
              active: r.active,
            }))}
            aircraft={aircraft}
          />
        </div>
      </div>
    </main>
  );
}
