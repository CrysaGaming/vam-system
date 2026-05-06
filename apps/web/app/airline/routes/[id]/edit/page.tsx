import { notFound  } from 'next/navigation';
import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { RouteForm } from '../../route-form';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * /airline/routes/[id]/edit — wrapper für RouteForm im edit-mode. Lädt
 * die existing route + airports und gibt sie als initial-values an die
 * form weiter.
 *
 * Ownership-check: route muss zur airline des admins gehören. Bei
 * mismatch (foreign route) → notFound() statt redirect, damit die url
 * nicht verraten wird ob die route überhaupt existiert (information-
 * leak prevention).
 *
 * Note: params ist ein Promise in Next.js 15+ — wir awaiten es bevor
 * destructuring.
 */
export default async function EditRoutePage({ params }: Props) {
  const { id } = await params;

  const user = await requireAirlineManagerWithAirlinePage();
  const route = await prisma.route.findUnique({
    where: { id },
    include: {
      departure: {
        select: {
          id: true,
          icao: true,
          iata: true,
          name: true,
          city: true,
          country: true,
          latitude: true,
          longitude: true,
        },
      },
      arrival: {
        select: {
          id: true,
          icao: true,
          iata: true,
          name: true,
          city: true,
          country: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });

  // Existence- + ownership-check kombiniert. notFound() statt redirect
  // damit foreign-route-URLs nicht als "exists but forbidden" leaken.
  if (!route || route.airlineId !== user.airlineId) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Route bearbeiten</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              <span className="font-mono">{route.flightNumber}</span> ·{' '}
              <span className="font-mono">{route.departure.icao}</span> →{' '}
              <span className="font-mono">{route.arrival.icao}</span>
            </p>
          </div>
          <Link
            href="/airline/routes"
            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition"
          >
            ← Zurück
          </Link>
        </header>

        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <RouteForm
            mode={{
              kind: 'edit',
              routeId: route.id,
              initialFlightNumber: route.flightNumber,
              initialDeparture: route.departure,
              initialArrival: route.arrival,
              initialAircraftTypeIcao: route.aircraftTypeIcao,
              initialEstimatedMinutes: route.estimatedMinutes,
              initialDistanceNm: route.distanceNm,
              initialActive: route.active,
            }}
          />
        </div>
      </div>
    </main>
  );
}
