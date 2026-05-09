import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  prisma,
  listEnrollmentsAwaitingPracticalReview,
  licenseDisplayName,
  getMinFlightTimeForLicense,
} from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { ReviewRow, type PirepInfo } from './review-row';
import { ExamSearchInput } from './exam-search-input';

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
export default async function PracticalExamsReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ license?: string; q?: string }>;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  // Layer 3: airline.careerEnabled. Wenn die airline career nicht aktiviert
  // hat, ist diese page sinnlos. Redirect zu /airline wo der admin den
  // toggle findet (statt 403 — feature ist nicht verboten sondern nicht
  // aktiviert).
  if (!user.airline.careerEnabled) {
    redirect('/airline');
  }

  // TS narrowing — nach dem redirect ist user.airline garantiert non-null.
  const airline = user.airline;

  // Track 4 #42 (Section G): URL-state für filter — license-type + name-query.
  const params = await searchParams;
  const licenseFilter = params.license?.trim().toUpperCase() || null;
  const searchQuery = params.q?.trim().toLowerCase() || '';

  const enrollmentsAll = await listEnrollmentsAwaitingPracticalReview({
    airlineId: airline.id,
  });

  // Track 4 #42: Post-filter auf der queue. License-type über exact-match,
  // name-query über case-insensitive contains. Beide gehen client-seitig
  // (server-side rendering) damit der existing helper unverändert bleibt —
  // queue ist eh klein (<20 typischerweise).
  const enrollments = enrollmentsAll.filter((e) => {
    if (licenseFilter && e.licenseType !== licenseFilter) return false;
    if (searchQuery) {
      const name = (e.user.name ?? '').toLowerCase();
      const discord = (e.user.discordId ?? '').toLowerCase();
      if (!name.includes(searchQuery) && !discord.includes(searchQuery)) {
        return false;
      }
    }
    return true;
  });

  // Track 4 #42: License-counts auf der UNGEFILTERTEN queue für die filter-
  // tabs — sonst würden tab-counts beim filter-wechsel mitschrumpfen, was
  // verwirrend ist (gleiches pattern wie /airline/pilots status-tabs).
  const licenseCounts = new Map<string, number>();
  for (const e of enrollmentsAll) {
    licenseCounts.set(e.licenseType, (licenseCounts.get(e.licenseType) ?? 0) + 1);
  }

  // Track 4 #42: Outcome-stats — last-90-day enrollment-history der airline.
  // Zeigt instructor wie viele PASSED/FAILED in dem fenster waren plus
  // running-WITHDRAWN-count. Hilft kontext zu setzen ("3 in queue, aber
  // die letzten 90 tage waren 12 PASSED — alles im normalen flow").
  // Filter über user.airlineId (FlightSchool selbst hat keine airlineId-
  // relation; gleiche pattern wie listEnrollmentsAwaitingPracticalReview).
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const outcomeCountsRaw = await prisma.flightSchoolEnrollment.groupBy({
    by: ['status'],
    where: {
      user: { airlineId: airline.id },
      updatedAt: { gte: ninetyDaysAgo },
      status: { in: ['PASSED', 'FAILED', 'WITHDRAWN'] },
    },
    _count: { _all: true },
  });
  const outcomeCounts: Record<string, number> = {
    PASSED: 0,
    FAILED: 0,
    WITHDRAWN: 0,
  };
  for (const row of outcomeCountsRaw) {
    outcomeCounts[row.status] = row._count?._all ?? 0;
  }

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
          {airline.name} ({airline.icao}) ·{' '}
          {enrollments.length === enrollmentsAll.length
            ? `${enrollmentsAll.length} ${enrollmentsAll.length === 1 ? 'Anfrage' : 'Anfragen'}`
            : `${enrollments.length} von ${enrollmentsAll.length} ${enrollmentsAll.length === 1 ? 'Anfrage' : 'Anfragen'}`}{' '}
          ausstehend
        </p>
      </header>

      {/* Track 4 #42 (Section G): Outcome-stats-strip — last-90-day kontext.
          Drei kleine cards rechts neben einem live-counter, hilft instructor
          die queue im verhältnis zur historie zu sehen. */}
      <section className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ExamStatCard
          label="Pending"
          value={String(enrollmentsAll.length)}
          tone="indigo"
          sub="aktuell in Queue"
        />
        <ExamStatCard
          label="Passed (90d)"
          value={String(outcomeCounts.PASSED)}
          tone="green"
          sub="bestanden"
        />
        <ExamStatCard
          label="Failed (90d)"
          value={String(outcomeCounts.FAILED)}
          tone="amber"
          sub="durchgefallen"
        />
        <ExamStatCard
          label="Withdrawn (90d)"
          value={String(outcomeCounts.WITHDRAWN)}
          tone="gray"
          sub="zurückgezogen"
        />
      </section>

      {/* Track 4 #42: Filter-row — license-type pills + name-search. Nur
          rendern wenn enrollmentsAll.length > 0, sonst gibt's eh nichts
          zu filtern. */}
      {enrollmentsAll.length > 0 && (
        <section className="mb-6 flex flex-wrap items-center gap-3">
          <div
            className="inline-flex flex-wrap gap-1"
            role="tablist"
            aria-label="License-Filter"
          >
            <LicenseFilterPill
              label="Alle"
              count={enrollmentsAll.length}
              active={licenseFilter === null}
              href={buildExamFilterHref({ ...params, license: undefined })}
            />
            {Array.from(licenseCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([license, count]) => (
                <LicenseFilterPill
                  key={license}
                  label={license}
                  count={count}
                  active={licenseFilter === license}
                  href={buildExamFilterHref({ ...params, license })}
                />
              ))}
          </div>

          <ExamSearchInput />
        </section>
      )}

      {enrollments.length === 0 ? (
        <section className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {enrollmentsAll.length === 0
              ? 'Keine ausstehenden Prüfungen. Wenn ein Pilot einen Prüfungsflug zuweist, erscheint er hier zur Review.'
              : 'Keine Anfragen matchen die aktiven Filter. Filter zurücksetzen oder andere Kriterien wählen.'}
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

// ─────────────────────────────────────────────────────────────────────────
// Track 4 #42 (Section G): Helper-components + URL-builder.
// ─────────────────────────────────────────────────────────────────────────

const STAT_TONES = {
  indigo: 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300',
  green: 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-300',
  amber: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
  gray: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300',
} as const;

function ExamStatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: keyof typeof STAT_TONES;
}) {
  return (
    <div className={`border rounded-lg p-3 ${STAT_TONES[tone]}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-0.5">{value}</p>
      <p className="text-[11px] opacity-70 mt-0.5">{sub}</p>
    </div>
  );
}

function LicenseFilterPill({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded text-xs font-medium transition flex items-center gap-1.5 border ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-700'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="font-mono">{label}</span>
      <span
        className={`tabular-nums ${
          active ? 'opacity-80' : 'text-gray-400 dark:text-gray-600'
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

/**
 * Build href with merged search-params. Undefined/empty values werden
 * entfernt (nicht mit '=' am ende serialisiert).
 */
function buildExamFilterHref(
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `/airline/practical-exams?${qs}` : '/airline/practical-exams';
}
