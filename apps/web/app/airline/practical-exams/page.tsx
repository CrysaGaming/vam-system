import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  prisma,
  listEnrollmentsAwaitingPracticalReview,
  licenseDisplayName,
  getMinFlightTimeForLicense,
} from '@vam/db';
import { ReviewRow, type PirepInfo } from './review-row';

/**
 * Instructor-side practical-exam review queue (Welle 13E-14c).
 *
 * Zeigt alle enrollments seiner airline die im EXAM_SCHEDULED-state sind
 * UND einen practicalExamPirepId zugewiesen haben (= pilot hat einen
 * prüfungsflug nominiert, wartet auf review).
 *
 * Page-gating (3 layers — siehe finance/page.tsx als template):
 *   1. Auth: redirect '/' wenn keine session
 *   2. Role: AIRLINE_MANAGER_ROLES (admin/airline-admin/instructor) +
 *      airline-zuordnung. redirect '/dashboard' bei mismatch
 *   3. Career: airline.careerEnabled muss true sein. redirect '/airline'
 *      wo der admin den toggle findet (nicht 403 — feature ist nicht
 *      verboten sondern nicht aktiviert)
 *
 * Queue + PIREP-details laden parallel:
 *   - listEnrollmentsAwaitingPracticalReview(airlineId) liefert
 *     enrollments + user+school includes
 *   - Pro enrollment: prisma.pirep.findUnique mit dem zugewiesenen
 *     practicalExamPirepId für PIREP-anzeige (route, dauer, aircraft)
 *   - Promise.all batched die PIREP-fetches damit pages mit 10+ pending
 *     reviews nicht sequentiell laden
 *
 * Bewusst keine paging — die queue sollte selten > ~20 entries haben,
 * weil instructors regelmäßig durch reviews gehen (selbe annahme wie im
 * helper). Falls das mal explodiert: paging hinzufügen via cursor auf
 * updatedAt.
 */
export default async function PracticalExamsReviewPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      role: true,
      airline: { select: { id: true, name: true, icao: true, careerEnabled: true } },
    },
  });

  // Layer 1+2: role + airline. Spiegelt /airline-page-gate.
  const allowedRoles = ['admin', 'airline-admin', 'instructor'];
  if (!user?.role || !allowedRoles.includes(user.role.name) || !user.airline) {
    redirect('/dashboard');
  }

  // Layer 3: airline.careerEnabled. Wenn die airline career nicht aktiviert
  // hat, ist diese page sinnlos. Redirect zu /airline wo der admin den
  // toggle findet (statt 403 — feature ist nicht verboten sondern nicht
  // aktiviert).
  if (!user.airline.careerEnabled) {
    redirect('/airline');
  }

  // TS narrowing — nach dem redirect ist user.airline garantiert non-null.
  const airline = user.airline;

  const enrollments = await listEnrollmentsAwaitingPracticalReview({
    airlineId: airline.id,
  });

  // PIREP-fetches parallel — Promise.all batched alle finds, sonst hätten
  // wir N+1. Für 10 reviews macht das den unterschied zwischen ~50ms und
  // ~500ms. Wir mappen in ein record by enrollmentId für O(1)-lookup
  // beim render.
  const pirepIds = enrollments
    .map((e) => e.practicalExamPirepId)
    .filter((id): id is string => id !== null);

  const pireps = await prisma.pirep.findMany({
    where: { id: { in: pirepIds } },
    select: {
      id: true,
      flightTimeMin: true,
      submittedAt: true,
      approvedAt: true,
      remarks: true,
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      aircraft: { select: { type: true, registration: true } },
    },
  });

  const pirepsById = new Map<string, PirepInfo>();
  for (const p of pireps) {
    pirepsById.set(p.id, {
      id: p.id,
      flightTimeMin: p.flightTimeMin,
      submittedAt: p.submittedAt,
      approvedAt: p.approvedAt,
      remarks: p.remarks,
      departureIcao: p.departure.icao,
      arrivalIcao: p.arrival.icao,
      aircraftType: p.aircraft?.type ?? null,
      aircraftRegistration: p.aircraft?.registration ?? null,
    });
  }

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/airline"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
        >
          ← Zurück zur Airline-Verwaltung
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Praktische Prüfungen — Review-Queue
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {airline.name} ({airline.icao}) · {enrollments.length}{' '}
          {enrollments.length === 1 ? 'Anfrage' : 'Anfragen'} ausstehend
        </p>
      </header>

      {enrollments.length === 0 ? (
        <section className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Keine ausstehenden Prüfungen. Wenn ein Pilot einen Prüfungsflug
            zuweist, erscheint er hier zur Review.
          </p>
        </section>
      ) : (
        <section className="space-y-4">
          {enrollments.map((e) => {
            const pirep = e.practicalExamPirepId
              ? (pirepsById.get(e.practicalExamPirepId) ?? null)
              : null;
            const minFlightTime = getMinFlightTimeForLicense(e.licenseType);
            return (
              <article
                key={e.id}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5"
              >
                {/* Header pro row: pilot-info + license-typ */}
                <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                  <div>
                    <h2 className="text-base font-semibold">
                      {e.user.name ?? 'Unbenannter Pilot'}
                      {e.user.discordId && (
                        <span className="text-xs text-gray-500 dark:text-gray-500 font-mono ml-2">
                          {e.user.discordId}
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                      {licenseDisplayName(e.licenseType)} · {e.school.name} (
                      <span className="font-mono">{e.school.airportIcao}</span>)
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-500 dark:text-gray-500">
                    <p>
                      Versuche bisher:{' '}
                      <span className="font-mono font-semibold">
                        {e.practicalExamAttempts}
                      </span>
                    </p>
                    <p className="mt-0.5">
                      Theorie:{' '}
                      <span className="font-mono">
                        {e.theoryExamScore !== null
                          ? `${e.theoryExamScore.toFixed(0)}%`
                          : '—'}
                      </span>
                    </p>
                  </div>
                </div>

                {/* PIREP-info */}
                {pirep ? (
                  <div className="px-3 py-3 rounded border bg-indigo-50/50 dark:bg-indigo-500/5 border-indigo-200 dark:border-indigo-500/30 mb-4 text-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="font-mono">
                        <span className="font-semibold">
                          {pirep.departureIcao}
                        </span>
                        <span className="text-gray-500 mx-1">→</span>
                        <span className="font-semibold">
                          {pirep.arrivalIcao}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                        {pirep.flightTimeMin} min ·{' '}
                        {pirep.aircraftType ?? 'unknown'}
                        {pirep.aircraftRegistration &&
                          ` (${pirep.aircraftRegistration})`}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-1.5 text-xs">
                      <span className="text-gray-500 dark:text-gray-500">
                        Approved{' '}
                        {pirep.approvedAt
                          ? pirep.approvedAt.toLocaleDateString('de-DE')
                          : '—'}{' '}
                        · Min für {e.licenseType}:{' '}
                        <span className="font-mono">{minFlightTime} min</span>
                      </span>
                      <Link
                        href={`/pireps/${pirep.id}`}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Vollen PIREP ansehen →
                      </Link>
                    </div>
                    {pirep.remarks && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 italic mt-2 whitespace-pre-line">
                        „{pirep.remarks}"
                      </p>
                    )}
                  </div>
                ) : (
                  // Defensive — sollte nie passieren weil der helper-filter
                  // practicalExamPirepId NOT NULL erfordert. Falls doch:
                  // PIREP wurde gelöscht (cascade vom user-delete). UI
                  // zeigt's als data-anomaly damit instructor weiß was los ist.
                  <div className="px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-xs mb-4">
                    ⚠️ Zugewiesener PIREP nicht mehr verfügbar (möglicherweise
                    gelöscht). Pilot muss neuen Flug zuweisen.
                  </div>
                )}

                {/* Pass/Fail-controls (client component) */}
                <ReviewRow
                  enrollmentId={e.id}
                  licenseType={e.licenseType}
                  pilotName={e.user.name ?? 'Pilot'}
                />
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
