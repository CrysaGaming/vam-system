import { notFound  } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';
import { requireAdminPage } from '@/lib/roles';
import { FlightSchoolForm } from '../school-form';
import { ActiveToggleButton } from '../active-toggle';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Edit-page für eine einzelne FlightSchool (Welle 13E-11).
 *
 * System-admin-only (gleiche gate wie list-page). Lädt die existing
 * school + ihren airport + enrollment-count, befüllt das form-component
 * im edit-mode.
 *
 * Sticky-info-block oben mit metadata (createdAt, enrollment-count,
 * status-toggle) damit der admin sieht "wie viele pilots sind grade
 * eingeschrieben?" bevor er größere änderungen macht (z.B. tarife
 * hochsetzt). Active-toggle hier zugänglich für ein-klick-deaktivierung
 * ohne zurück zur list-page.
 *
 * params ist Promise in Next 16 (siehe userMemories) — daher await
 * vor dem destructuring.
 */
export default async function EditFlightSchoolPage({ params }: Props) {
  const { id } = await params;

  const currentUser = await requireAdminPage();
  const school = await prisma.flightSchool.findUnique({
    where: { id },
    include: {
      airport: { select: { name: true, city: true, country: true } },
      _count: { select: { enrollments: true } },
    },
  });

  if (!school) {
    notFound();
  }

  // Decimal → string für form-fields. Der prisma-client liefert Decimal-
  // objekte, das form erwartet plain-strings (regex-validierung). toString()
  // produziert "150" oder "150.50" je nach precision — passt zum
  // form-pattern.
  const initial = {
    id: school.id,
    name: school.name,
    airportIcao: school.airportIcao,
    rating: school.rating,
    offeredLicenses: school.offeredLicenses,
    hourlyRateGround: school.hourlyRateGround.toString(),
    hourlyRateAir: school.hourlyRateAir.toString(),
    hourlyRateSim: school.hourlyRateSim?.toString() ?? null,
    description: school.description,
    logoUrl: school.logoUrl,
  };

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/admin/flight-schools"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
        >
          ← Zurück zu Flugschulen
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {school.name}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              <span className="font-mono font-semibold">{school.airportIcao}</span>{' '}
              · {school.airport.name}
              {school.airport.city ? `, ${school.airport.city}` : ''}
            </p>
          </div>
          <ActiveToggleButton schoolId={school.id} active={school.active} />
        </div>
      </div>

      {/* Meta-stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 text-xs">
        <MetaCard
          label="Eingeschriebene Pilots"
          value={school._count.enrollments.toString()}
        />
        <MetaCard label="Rating" value={`★ ${school.rating.toFixed(1)}`} />
        <MetaCard
          label="Erstellt"
          value={school.createdAt.toLocaleDateString('de-DE')}
        />
        <MetaCard
          label="Geändert"
          value={school.updatedAt.toLocaleDateString('de-DE')}
        />
      </div>

      {/* Form */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Stammdaten bearbeiten</h2>
        <FlightSchoolForm mode="edit" initial={initial} />
      </div>
    </main>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
      <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="font-semibold mt-0.5 text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
