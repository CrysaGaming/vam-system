import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { ScheduleTemplateForm } from '../../schedule-template-form';

/**
 * /airline/schedule/[id]/edit — Template bearbeiten.
 *
 * Multi-tenant 404: template existiert nicht ODER gehört zu anderer
 * airline. Beide cases als 404 (kein info-leak).
 */
export default async function EditScheduleTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: { select: { name: true } } },
  });

  const allowedRoles = ['admin', 'airline-admin', 'instructor'];
  if (
    !user?.role ||
    !allowedRoles.includes(user.role.name) ||
    !user.airlineId ||
    !user.airline
  ) {
    redirect('/dashboard');
  }

  const { id: templateId } = await params;
  const template = await prisma.scheduleTemplate.findUnique({
    where: { id: templateId },
    include: {
      route: { select: { flightNumber: true } },
      _count: { select: { scheduledFlights: true } },
    },
  });

  if (!template || template.airlineId !== user.airlineId) {
    notFound();
  }

  // Routes + aircraft für die select-felder. Mirrors new/page.tsx pattern.
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
              Schedule-Template bearbeiten
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} —{' '}
              <span className="font-mono">{template.route.flightNumber}</span>
              {template.label && ` · ${template.label}`}
            </p>
          </div>
        </header>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <ScheduleTemplateForm
            mode={{
              kind: 'edit',
              templateId: template.id,
              initialRouteId: template.routeId,
              initialLabel: template.label,
              initialDaysOfWeek: template.daysOfWeek,
              initialDepartureMinuteUtc: template.departureMinuteUtc,
              initialValidFrom: template.validFrom,
              initialValidUntil: template.validUntil,
              initialPreferredAircraftId: template.preferredAircraftId,
              initialActive: template.active,
            }}
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

        {/* Hinweis wenn instances bereits existieren */}
        {template._count.scheduledFlights > 0 && (
          <aside className="mt-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-300">
            <p>
              <strong>Hinweis:</strong> Dieses template hat bereits{' '}
              {template._count.scheduledFlights}{' '}
              {template._count.scheduledFlights === 1
                ? 'generierte instanz'
                : 'generierte instances'}
              . Änderungen an wochentagen oder uhrzeit ändern{' '}
              <em>nicht</em> die schon erstellten instances. Wenn du das willst,
              musst du sie über die instance-übersicht (kommt 7B-3) manuell
              löschen und neu generieren.
            </p>
          </aside>
        )}
      </div>
    </main>
  );
}
