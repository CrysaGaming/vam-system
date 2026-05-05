import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  prisma,
  getActiveLicenses,
  licenseDisplayName,
  getOrCreateWallet,
  PASS_MARK_PERCENT,
  type LicenseType,
} from '@vam/db';
import { EnrollmentForm } from '../enrollment-form';
import { EnrollmentManagement } from '../enrollment-management';
import { TheoryExamCard } from '../theory-exam-card';

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Pilot-side flight-school detail-page (Welle 13E-12).
 *
 * Drei haupt-szenarien:
 *   A) Pilot hat KEIN running enrollment für diese schule
 *      → enrollment-form mit license-dropdown (filtered: angeboten ∧ noch
 *        nicht in pilot's active-licenses)
 *   B) Pilot hat EIN running enrollment hier
 *      → progress-block mit hours + cost + management-form
 *      → buy-hours form
 *      → withdraw-button
 *   C) Pilot hat ein PASSED/FAILED/WITHDRAWN enrollment hier
 *      → history-block mit final state
 *      → enrollment-form falls noch andere licenses verfügbar
 *
 * Multi-enrollments-pro-schule sind erlaubt (verschiedene license-typen
 * gleichzeitig). Der pilot kann z.B. parallel PPL und Night-Rating
 * machen. Wir zeigen ALLE running enrollments für diese schule, plus
 * die enrollment-form für die noch verfügbaren licenses.
 *
 * params ist Promise (Next 16 — siehe userMemories), daher await vor
 * destructuring.
 */
export default async function FlightSchoolDetailPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: { select: { careerEnabled: true } } },
  });
  if (!user) redirect('/');

  const hasCareer = !!(user.careerEnabled && user.airline?.careerEnabled);
  if (!hasCareer) {
    redirect('/settings#profile');
  }

  const school = await prisma.flightSchool.findUnique({
    where: { id },
    include: {
      airport: { select: { name: true, city: true, country: true } },
      _count: { select: { enrollments: true } },
    },
  });
  if (!school) notFound();

  // Wenn die schule inaktiv ist und der pilot KEIN running enrollment hier
  // hat, zeigen wir die page als read-only "schule deaktiviert"-state.
  // Wenn der pilot HIER einen running enrollment hat, lassen wir ihn die
  // page sehen damit er hours buchen oder withdraw machen kann (siehe
  // schema-policy: existing enrollments dürfen weiter laufen).

  const [allEnrollmentsHere, activeLicenses, userWallet] = await Promise.all([
    prisma.flightSchoolEnrollment.findMany({
      where: { userId: user.id, schoolId: id },
      orderBy: { enrolledAt: 'desc' },
      include: {
        // Letzte 5 attempts pro enrollment für die TheoryExamCard.
        // findMany im include unterstützt orderBy + take wie eine top-level
        // query. Sortiert DESC by startedAt damit die neuesten oben sind.
        theoryAttempts: {
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            startedAt: true,
            submittedAt: true,
            scorePercent: true,
            passed: true,
          },
        },
      },
    }),
    getActiveLicenses(user.id),
    getOrCreateWallet({ ownerType: 'USER', ownerUserId: user.id }),
  ]);

  const runningEnrollments = allEnrollmentsHere.filter(
    (e) => e.status === 'IN_PROGRESS' || e.status === 'EXAM_SCHEDULED',
  );
  const pastEnrollments = allEnrollmentsHere.filter(
    (e) =>
      e.status === 'PASSED' ||
      e.status === 'FAILED' ||
      e.status === 'WITHDRAWN',
  );

  // Available licenses für die enrollment-form: schule.offered ∩ NOT(active)
  // ∩ NOT(running). Wenn der pilot eine license hat ODER grade dafür ein
  // running enrollment hat, blendet der dropdown das aus.
  const activeLicenseTypes = new Set(activeLicenses.map((l) => l.type));
  const runningLicenseTypes = new Set(runningEnrollments.map((e) => e.licenseType));
  const availableLicenseTypes = school.offeredLicenses.filter(
    (t) => !activeLicenseTypes.has(t) && !runningLicenseTypes.has(t),
  );

  const walletBalance = Number(userWallet.balance);

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/flight-schools"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
        >
          ← Zurück zu Flugschulen
        </Link>
      </div>

      {/* Header */}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {school.name}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              <span className="font-mono font-semibold">
                {school.airportIcao}
              </span>{' '}
              · {school.airport.name}
              {school.airport.city ? `, ${school.airport.city}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-base font-semibold text-amber-600 dark:text-amber-400">
              ★ {school.rating.toFixed(1)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {school._count.enrollments}{' '}
              {school._count.enrollments === 1 ? 'Pilot' : 'Pilots'}{' '}
              eingeschrieben
            </p>
          </div>
        </div>
        {!school.active && (
          <div className="mt-3 px-3 py-2 rounded border bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs">
            ⚠️ Diese Flugschule ist nicht mehr aktiv. Neue Einschreibungen sind
            nicht möglich. Bestehende Enrollments können weitergeführt werden.
          </div>
        )}
      </header>

      {/* Description */}
      {school.description && (
        <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <p className="text-sm whitespace-pre-line">{school.description}</p>
        </section>
      )}

      {/* Tarife */}
      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Tarife
        </h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-500 uppercase tracking-wider">
              Theorie
            </p>
            <p className="font-mono font-bold text-lg mt-1">
              {Number(school.hourlyRateGround).toFixed(0)}
              <span className="text-xs text-gray-500 ml-1">VAM$/h</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-500 uppercase tracking-wider">
              Flug
            </p>
            <p className="font-mono font-bold text-lg mt-1">
              {Number(school.hourlyRateAir).toFixed(0)}
              <span className="text-xs text-gray-500 ml-1">VAM$/h</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-500 uppercase tracking-wider">
              Sim
            </p>
            <p className="font-mono font-bold text-lg mt-1">
              {school.hourlyRateSim
                ? `${Number(school.hourlyRateSim).toFixed(0)} `
                : '— '}
              {school.hourlyRateSim && (
                <span className="text-xs text-gray-500">VAM$/h</span>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Angebotene Lizenzen */}
      <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Angebotene Lizenzen
        </h2>
        <div className="flex flex-wrap gap-2">
          {school.offeredLicenses.map((lic) => (
            <span
              key={lic}
              className={`px-2 py-1 rounded text-xs font-mono ${
                activeLicenseTypes.has(lic)
                  ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 line-through'
                  : runningLicenseTypes.has(lic)
                    ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
              }`}
              title={
                activeLicenseTypes.has(lic)
                  ? 'Du hast diese Lizenz bereits'
                  : runningLicenseTypes.has(lic)
                    ? 'Aktuell in Bearbeitung'
                    : 'Verfügbar zur Einschreibung'
              }
            >
              {lic}
            </span>
          ))}
        </div>
      </section>

      {/* Running enrollments — eine card pro running enrollment */}
      {runningEnrollments.map((e) => (
        <section
          key={e.id}
          className="mb-6 bg-indigo-50 dark:bg-indigo-500/5 border border-indigo-200 dark:border-indigo-500/30 rounded-lg p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold">
                Aktuelles Training: {licenseDisplayName(e.licenseType)}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Eingeschrieben am{' '}
                {e.enrolledAt.toLocaleDateString('de-DE')} · Status{' '}
                {e.status === 'IN_PROGRESS' ? 'Laufend' : 'Prüfung anstehend'}
              </p>
            </div>
          </div>

          {/* Hours-progress */}
          <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
            <ProgressTile label="Theorie" hours={e.hoursTheory} />
            <ProgressTile label="Flug" hours={e.hoursPractical} />
            <ProgressTile label="Sim" hours={e.hoursSim} />
          </div>

          <div className="text-xs text-gray-600 dark:text-gray-400 mb-4">
            Bisher gezahlt:{' '}
            <span className="font-mono font-semibold">
              {Number(e.totalCostPaid).toFixed(2)} VAM$
            </span>
          </div>

          <h3 className="text-sm font-semibold mb-2">Trainings-Stunden buchen</h3>
          <EnrollmentManagement
            enrollmentId={e.id}
            hourlyRateGround={Number(school.hourlyRateGround)}
            hourlyRateAir={Number(school.hourlyRateAir)}
            hourlyRateSim={
              school.hourlyRateSim ? Number(school.hourlyRateSim) : null
            }
            walletBalance={walletBalance}
          />

          {/* Theory-Exam-section pro running enrollment (Welle 13E-13c).
              Aktive sind active-attempt + recent-attempts vom enrollment-
              include. Active = der erste attempt mit submittedAt=null.
              recentAttempts werden direkt durchgereicht. */}
          <div className="mt-6">
            <TheoryExamCard
              enrollmentId={e.id}
              schoolId={school.id}
              theoryExamPassedAt={e.theoryExamPassedAt}
              theoryExamScore={e.theoryExamScore}
              attemptCount={e.theoryExamAttempts}
              activeAttemptId={
                e.theoryAttempts.find((a) => a.submittedAt === null)?.id ?? null
              }
              recentAttempts={e.theoryAttempts}
              passMarkPercent={PASS_MARK_PERCENT}
            />
          </div>
        </section>
      ))}

      {/* Enrollment-form — wenn es noch verfügbare licenses gibt UND die
          schule active ist (sonst keine neuen einschreibungen). */}
      {school.active && availableLicenseTypes.length > 0 && (
        <section className="mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
          <h2 className="text-base font-semibold mb-3">
            {runningEnrollments.length > 0
              ? 'Weitere Lizenz dazu'
              : 'Einschreiben'}
          </h2>
          <EnrollmentForm
            schoolId={school.id}
            availableLicenseTypes={availableLicenseTypes}
          />
        </section>
      )}

      {/* Wenn alle angebotenen licenses entweder running oder bereits
          active sind: info-banner statt enrollment-form. */}
      {school.active &&
        availableLicenseTypes.length === 0 &&
        runningEnrollments.length === 0 && (
          <section className="mb-6 bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Du hast bereits alle angebotenen Lizenzen dieser Schule (oder hast
            sie aktuell in Bearbeitung).
          </section>
        )}

      {/* Past-enrollments-history */}
      {pastEnrollments.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Vergangene Trainings
          </h2>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            {pastEnrollments.map((e) => (
              <PastEnrollmentRow key={e.id} enrollment={e} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function ProgressTile({ label, hours }: { label: string; hours: number }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
      <p className="text-xs text-gray-500 dark:text-gray-500 uppercase tracking-wider">
        {label}
      </p>
      <p className="font-mono font-bold text-lg mt-1">
        {hours.toFixed(1)}
        <span className="text-xs text-gray-500 ml-1">h</span>
      </p>
    </div>
  );
}

function PastEnrollmentRow({
  enrollment,
}: {
  enrollment: {
    id: string;
    licenseType: LicenseType;
    status: string;
    enrolledAt: Date;
    withdrawnAt: Date | null;
    withdrawnReason: string | null;
    totalCostPaid: { toString(): string };
  };
}) {
  const statusLabel: Record<string, string> = {
    PASSED: '✓ Bestanden',
    FAILED: '✗ Nicht bestanden',
    WITHDRAWN: '⊗ Abgebrochen',
  };
  const statusColor: Record<string, string> = {
    PASSED: 'text-green-700 dark:text-green-400',
    FAILED: 'text-red-700 dark:text-red-400',
    WITHDRAWN: 'text-gray-500 dark:text-gray-500',
  };
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">
            {licenseDisplayName(enrollment.licenseType)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Eingeschrieben{' '}
            {enrollment.enrolledAt.toLocaleDateString('de-DE')}
            {enrollment.withdrawnAt &&
              ` · Beendet ${enrollment.withdrawnAt.toLocaleDateString('de-DE')}`}
          </p>
          {enrollment.withdrawnReason && (
            <p className="text-xs text-gray-500 dark:text-gray-500 italic mt-1">
              „{enrollment.withdrawnReason}"
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p
            className={`text-xs font-semibold ${statusColor[enrollment.status] ?? ''}`}
          >
            {statusLabel[enrollment.status] ?? enrollment.status}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 font-mono mt-0.5">
            {Number(enrollment.totalCostPaid).toFixed(2)} VAM$
          </p>
        </div>
      </div>
    </div>
  );
}
