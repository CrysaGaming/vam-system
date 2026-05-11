import { notFound  } from 'next/navigation';
import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { EditAircraftForm } from './edit-aircraft-form';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * /airline/aircraft/[id]/edit — wrapper für EditAircraftForm. Lädt das
 * existing aircraft + verlinkten aircraftType und gibt sie als initial-
 * values weiter.
 *
 * Ownership-check: aircraft muss zur airline des admins gehören. Bei
 * mismatch (foreign aircraft) → notFound() statt redirect, damit die url
 * nicht verraten wird ob das aircraft überhaupt existiert (information-
 * leak prevention).
 *
 * Status-änderungen NICHT hier — die laufen über die action-buttons-
 * dropdown auf der listing-page (single source of truth, single click).
 *
 * Note: params ist ein Promise in Next.js 15+ — wir awaiten es bevor
 * destructuring.
 */
export default async function EditAircraftPage({ params }: Props) {
  const { id } = await params;

  const user = await requireAirlineManagerWithAirlinePage();
  const aircraft = await prisma.aircraft.findUnique({
    where: { id },
    include: {
      aircraftType: {
        select: { icaoType: true, name: true, manufacturer: true },
      },
    },
  });

  // Existence- + ownership-check kombiniert. notFound() statt redirect
  // damit foreign-aircraft-URLs nicht als "exists but forbidden" leaken.
  if (!aircraft || aircraft.airlineId !== user.airlineId) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Aircraft bearbeiten</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              <span className="font-mono">{aircraft.registration}</span>
              {aircraft.aircraftType && (
                <>
                  {' · '}
                  {aircraft.aircraftType.manufacturer}{' '}
                  {aircraft.aircraftType.name}
                </>
              )}
            </p>
          </div>

          <Link
            href="/airline/aircraft"
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Zurück zur Übersicht
          </Link>
        </header>

        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <EditAircraftForm
            aircraftId={aircraft.id}
            initialRegistration={aircraft.registration}
            initialType={aircraft.type}
            initialAircraftTypeId={aircraft.aircraftTypeId}
            initialAircraftTypeDisplay={
              aircraft.aircraftType
                ? `${aircraft.aircraftType.icaoType} — ${aircraft.aircraftType.manufacturer} ${aircraft.aircraftType.name}`
                : null
            }
            initialHomeIcao={aircraft.homeIcao}
            initialPhotoUrl={aircraft.photoUrl}
          />
        </section>

        <aside className="mt-6 text-sm text-gray-500 dark:text-gray-400">
          <p>
            Status-Änderungen (Wartung, Eingelagert, Außer Dienst) werden
            direkt auf der{' '}
            <Link
              href="/airline/aircraft"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Übersichtsseite
            </Link>{' '}
            über das Status-Dropdown erledigt.
          </p>
        </aside>
      </div>
    </main>
  );
}
