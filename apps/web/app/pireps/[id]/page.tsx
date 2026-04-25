import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

export default async function PirepDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const { id } = await params;

  const pirep = await prisma.pirep.findUnique({
    where: { id },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      airline: true,
      user: {
        include: { rank: true },
      },
    },
  });

  if (!pirep) {
    notFound();
  }

  // Authorization: nur eigene PIREPs ansehen (oder später: Instructors/Admins)
  if (pirep.userId !== session.user.id) {
    redirect('/pireps');
  }

  // Flugzeit formatieren
  const hours = Math.floor((pirep.flightTimeMin ?? 0) / 60);
  const mins = (pirep.flightTimeMin ?? 0) % 60;
  const flightTime =
    pirep.flightTimeMin === null
      ? '—'
      : hours > 0
        ? `${hours}h ${mins}min`
        : `${mins}min`;

  // Status-Styling
  const statusStyles =
    pirep.status === 'Approved'
      ? 'bg-green-500/10 border-green-500/30 text-green-400'
      : pirep.status === 'Rejected'
        ? 'bg-red-500/10 border-red-500/30 text-red-400'
        : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400';

  const statusLabel =
    pirep.status === 'Approved'
      ? 'Genehmigt'
      : pirep.status === 'Rejected'
        ? 'Abgelehnt'
        : 'Eingereicht';

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-800">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold font-mono">
                {pirep.route?.flightNumber ?? 'PIREP'}
              </h1>
              <span
                className={`px-3 py-1 rounded text-xs font-semibold border ${statusStyles}`}
              >
                {statusLabel}
              </span>
            </div>
            <p className="text-gray-400 text-sm">
              Eingereicht am{' '}
              {new Date(pirep.submittedAt).toLocaleString('de-DE', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>
          <Link
            href="/pireps"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
          >
            ← Alle PIREPs
          </Link>
        </header>

        {/* Route - groß und prominent */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between gap-8">
            <div className="text-center flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Departure
              </p>
              <p className="text-3xl font-bold font-mono">{pirep.departure.icao}</p>
              <p className="text-sm text-gray-400 mt-3">{pirep.departure.name}</p>
              {pirep.departure.city && (
                <p className="text-xs text-gray-500 mt-1">{pirep.departure.city}</p>
              )}
            </div>

            <div className="flex-1 max-w-xs">
              <div className="border-t-2 border-dashed border-gray-700 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gray-900 px-3">
                  <span className="text-2xl">✈️</span>
                </div>
              </div>
              <p className="text-center text-sm text-gray-400 mt-5">
                {pirep.route?.distanceNm ? `${pirep.route.distanceNm} nm` : '—'}
              </p>
            </div>

            <div className="text-center flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Arrival
              </p>
              <p className="text-3xl font-bold font-mono">{pirep.arrival.icao}</p>
              <p className="text-sm text-gray-400 mt-3">{pirep.arrival.name}</p>
              {pirep.arrival.city && (
                <p className="text-xs text-gray-500 mt-1">{pirep.arrival.city}</p>
              )}
            </div>
          </div>
        </section>

        {/* Aircraft + Pilot + Stats */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Aircraft
            </h2>
            {pirep.aircraft ? (
              <>
                <p className="text-2xl font-mono font-bold">
                  {pirep.aircraft.registration}
                </p>
                <p className="text-gray-400 mt-1">{pirep.aircraft.type}</p>
                {pirep.aircraft.homeIcao && (
                  <p className="text-xs text-gray-500 mt-2">
                    Home: {pirep.aircraft.homeIcao}
                  </p>
                )}
              </>
            ) : (
              <p className="text-gray-500">—</p>
            )}
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Pilot
            </h2>
            <p className="text-lg font-semibold">
              {pirep.user.name ?? 'Unbenannt'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {pirep.user.rank?.name ?? 'Kein Rang'}
            </p>
            <p className="text-xs text-gray-500 mt-2">{pirep.airline.name}</p>
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Flugzeit
            </h2>
            <p className="text-3xl font-bold">{flightTime}</p>
            <p className="text-xs text-gray-500 mt-2">
              State: <span className="text-gray-400">{pirep.state}</span>
            </p>
            <p className="text-xs text-gray-500">
              Network: <span className="text-gray-400">{pirep.network}</span>
            </p>
          </section>
        </div>

        {/* Performance-Stats */}
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
            Performance
          </h2>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Treibstoff
              </p>
              <p className="text-xl font-semibold">
                {pirep.fuelUsedKg !== null ? `${pirep.fuelUsedKg} kg` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Landing Rate
              </p>
              <p className="text-xl font-semibold">
                {pirep.landingRateFpm !== null
                  ? `${pirep.landingRateFpm} fpm`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Distanz
              </p>
              <p className="text-xl font-semibold">
                {pirep.route?.distanceNm
                  ? `${pirep.route.distanceNm} nm`
                  : '—'}
              </p>
            </div>
          </div>
        </section>

        {/* Bemerkungen (falls vorhanden) */}
        {pirep.remarks && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Bemerkungen
            </h2>
            <p className="text-gray-300 whitespace-pre-wrap">{pirep.remarks}</p>
          </section>
        )}

        {/* Rejection Reason (falls Rejected) */}
        {pirep.status === 'Rejected' && pirep.rejectionReason && (
          <section className="bg-red-500/5 border border-red-500/30 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-red-400 mb-4">
              Ablehnungsgrund
            </h2>
            <p className="text-red-300 whitespace-pre-wrap">
              {pirep.rejectionReason}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}