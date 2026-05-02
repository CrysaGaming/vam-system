import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { OfpSummary } from '@/components/OfpSummary';
import { ApprovalActions } from './approval-actions';
import { isApproverRole } from '@/lib/roles';

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

  // Current User mit Role
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!currentUser) {
    redirect('/');
  }

  const isApprover = isApproverRole(currentUser.role?.name);

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
      approver: true,
      // Phase 2 #2 follow-up: render the FlightPlanCache (if any) that
      // travelled with the booking → pirep on submit. Cache is null when
      // the PIREP was filed standalone (no matching active booking) or
      // when the matched booking had no SimBrief plan generated.
      flightPlanCache: true,
    },
  });

  if (!pirep) {
    notFound();
  }

  // Authorization:
  // - Eigene PIREPs immer sichtbar
  // - Admin/Instructor: alle PIREPs der eigenen Airline sichtbar
  const isOwn = pirep.userId === currentUser.id;
  const sameAirline = pirep.airlineId === currentUser.airlineId;

  if (!isOwn && !(isApprover && sameAirline)) {
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

  // Show approval actions: nur für approver UND status=Submitted UND nicht eigener PIREP
  const showApprovalActions =
    isApprover && pirep.status === 'Submitted' && !isOwn;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
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
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Eingereicht am{' '}
              {new Date(pirep.submittedAt).toLocaleString('de-DE', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>
          <Link
            href={isApprover && pirep.status === 'Submitted' ? '/pireps/pending' : '/pireps'}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Zurück
          </Link>
        </header>

        {/* Approval Actions (nur für Approver bei Submitted PIREPs) */}
        {showApprovalActions && (
          <div className="mb-8">
            <ApprovalActions pirepId={pirep.id} />
          </div>
        )}

        {/* Approver-Info bei bereits geprüften PIREPs */}
        {pirep.status !== 'Submitted' && pirep.approver && (
          <div
            className={`mb-8 px-6 py-4 rounded-lg border ${
              pirep.status === 'Approved'
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-red-500/5 border-red-500/20'
            }`}
          >
            <p className="text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                {pirep.status === 'Approved' ? 'Genehmigt von' : 'Abgelehnt von'}{' '}
              </span>
              <span className="font-semibold">
                {pirep.approver.name ?? 'Unbenannt'}
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {' '}am{' '}
                {new Date(
                  pirep.status === 'Approved'
                    ? pirep.approvedAt!
                    : pirep.rejectedAt!
                ).toLocaleString('de-DE', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                })}
              </span>
            </p>
          </div>
        )}

        {/* Route - groß und prominent */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between gap-8">
            <div className="text-center flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Departure
              </p>
              <p className="text-3xl font-bold font-mono">{pirep.departure.icao}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">{pirep.departure.name}</p>
              {pirep.departure.city && (
                <p className="text-xs text-gray-500 mt-1">{pirep.departure.city}</p>
              )}
            </div>

            <div className="flex-1 max-w-xs">
              <div className="border-t-2 border-dashed border-gray-300 dark:border-gray-700 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-900 px-3">
                  <span className="text-2xl">✈️</span>
                </div>
              </div>
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-5">
                {pirep.route?.distanceNm ? `${pirep.route.distanceNm} nm` : '—'}
              </p>
            </div>

            <div className="text-center flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-3">
                Arrival
              </p>
              <p className="text-3xl font-bold font-mono">{pirep.arrival.icao}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">{pirep.arrival.name}</p>
              {pirep.arrival.city && (
                <p className="text-xs text-gray-500 mt-1">{pirep.arrival.city}</p>
              )}
            </div>
          </div>
        </section>

        {/* Aircraft + Pilot + Stats */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Aircraft
            </h2>
            {pirep.aircraft ? (
              <>
                <p className="text-2xl font-mono font-bold">
                  {pirep.aircraft.registration}
                </p>
                <p className="text-gray-600 dark:text-gray-400 mt-1">{pirep.aircraft.type}</p>
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

          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Pilot
            </h2>
            <p className="text-lg font-semibold">
              {pirep.user.name ?? 'Unbenannt'}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {pirep.user.rank?.name ?? 'Kein Rang'}
            </p>
            <p className="text-xs text-gray-500 mt-2">{pirep.airline.name}</p>
          </section>

          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Flugzeit
            </h2>
            <p className="text-3xl font-bold">{flightTime}</p>
            <p className="text-xs text-gray-500 mt-2">
              State: <span className="text-gray-500 dark:text-gray-400">{pirep.state}</span>
            </p>
            <p className="text-xs text-gray-500">
              Network: <span className="text-gray-500 dark:text-gray-400">{pirep.network}</span>
            </p>
          </section>
        </div>

        {/* Performance-Stats */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
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
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">
              Bemerkungen
            </h2>
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{pirep.remarks}</p>
          </section>
        )}

        {/* Original Flight Plan — Lifecycle Phase 2 #2 follow-up.
            Renders the FlightPlanCache that was attached to the matching
            booking and transferred to this PIREP at submit-time. Always
            in muted/read-only mode (no actions slot) since the PIREP is
            historical record — no refresh, no re-plan.

            On PIREPs, also passes `actual` so the OfpSummary renders a
            Plan-vs-Actual comparison footer with delta values for block
            time and fuel — the unique-to-PIREP-context enhancement that
            turns the read-only OFP card into a debrief tool. */}
        {pirep.flightPlanCache && (
          <OfpSummary
            cache={pirep.flightPlanCache}
            actual={{
              flightTimeMin: pirep.flightTimeMin,
              fuelUsedKg: pirep.fuelUsedKg,
            }}
          />
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