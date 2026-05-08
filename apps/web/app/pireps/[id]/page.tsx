import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import {
  prisma,
  licenseDisplayName,
  hasReplayDataForPirep,
  getPirepPhaseBreakdown,
  getPirepApproachAnalysis,
  getPirepLandingAnalysis,
} from '@vam/db';
import Link from 'next/link';
import { OfpSummary } from '@/components/OfpSummary';
import { ApprovalActions } from './approval-actions';
import { DraftActions } from './draft-actions';
import { VerticalProfileChart } from './vertical-profile-chart';
import { AircraftPerformanceChart } from './aircraft-performance-chart';
import { isApproverRole } from '@/lib/roles';

/**
 * Track 4 #2 (Phase-Breakdown-Bar): bg-color pro flight-phase.
 *
 * Hardcoded literal-strings damit Tailwind v4 sie als content findet.
 * Dynamic-template-literals würden silent-not-emitted weil v4's content-
 * scanner nur literal-strings detected (siehe `cdf6cb6` für ähnlichen
 * fix mit `lg:`-classes).
 *
 * Color-philosophie: stationary phases gray, ground-roll phases blue,
 * climb/descent transitions amber/orange (achtung-color), cruise
 * green (entspanntes "going somewhere"), landing red (high-attention
 * moment). Spiegelt die phase-importance: cruise+ground sind safe-zones,
 * transitions sind die kritischen momente.
 */
const PHASE_BAR_CLASSES: Record<string, string> = {
  PreFlight: 'bg-gray-400 dark:bg-gray-600',
  Pushback: 'bg-slate-500 dark:bg-slate-600',
  Taxi: 'bg-blue-400 dark:bg-blue-600',
  Takeoff: 'bg-orange-400 dark:bg-orange-600',
  Climb: 'bg-amber-400 dark:bg-amber-600',
  Cruise: 'bg-green-500 dark:bg-green-600',
  Descent: 'bg-amber-600 dark:bg-amber-700',
  Approach: 'bg-orange-500 dark:bg-orange-700',
  Landing: 'bg-red-500 dark:bg-red-600',
  TaxiIn: 'bg-blue-500 dark:bg-blue-700',
  BlockOn: 'bg-gray-600 dark:bg-gray-700',
};

const PHASE_LABELS: Record<string, string> = {
  PreFlight: 'Pre-Flight',
  Pushback: 'Pushback',
  Taxi: 'Taxi-Out',
  Takeoff: 'Takeoff',
  Climb: 'Climb',
  Cruise: 'Cruise',
  Descent: 'Descent',
  Approach: 'Approach',
  Landing: 'Landing',
  TaxiIn: 'Taxi-In',
  BlockOn: 'Block-On',
};

function formatPhaseDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min`;
  return `${totalSec}s`;
}

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

  // Welle 13E-14d: Practical-Exam-link lookup. Wenn dieser PIREP einem
  // FlightSchoolEnrollment als Prüfungsflug zugewiesen ist, zeigen wir
  // einen badge oben in der page mit license-typ + status + link.
  //
  // findFirst statt findUnique weil practicalExamPirepId KEIN @unique-FK
  // ist (siehe schema-docstring im FlightSchoolEnrollment-model: STRING
  // statt FK damit PIREP-cascade-delete den enrollment-record nicht
  // mitnimmt). Theoretisch könnte ein PIREP mehreren enrollments
  // zugewiesen sein (multi-license-credit) — wir zeigen aber nur den
  // ersten match. Bei realer multi-credit-policy könnte das später auf
  // findMany umgestellt werden.
  //
  // Filter: kein status-restriktion. Wenn pirepId match → badge zeigen
  // (sowohl AWAITING_REVIEW als auch PASSED haben pirepId gesetzt).
  // Bei FAIL hat der helper pirepId=null gesetzt → kein badge mehr,
  // historischer link ist verloren (akzeptabel, single-source-of-truth-
  // pattern).
  //
  // Track 1 #5 (Replay-Mode): hasReplayData parallel-fetched für den
  // "Play Flight"-button-conditional. Cheap-genug check (3 selects + 1
  // count) — parallel mit examEnrollment damit kein zusätzliches
  // round-trip-latency.
  //
  // Track 4 #2 (Phase-Breakdown-Bar): phaseBreakdown auch parallel.
  // Macht eigenes session-matching (gleiche logic wie hasReplayData)
  // — das wäre theoretisch dedupable wenn wir den match-helper
  // refactor'n. Für jetzt akzeptieren wir die kleine duplication weil
  // alle 3 helpers im Promise.all parallel laufen → kein latency-cost.
  // groupBy-aggregation auf indexed (sessionId, recordedAt) ist
  // billig auch bei 5000+ positions.
  const [
    examEnrollment,
    hasReplay,
    phaseBreakdown,
    approachAnalysis,
    landingAnalysis,
  ] = await Promise.all([
    prisma.flightSchoolEnrollment.findFirst({
      where: { practicalExamPirepId: pirep.id },
      select: {
        id: true,
        schoolId: true,
        licenseType: true,
        status: true,
        practicalExamPassedAt: true,
        school: { select: { name: true, airportIcao: true } },
      },
    }),
    hasReplayDataForPirep(pirep.id),
    getPirepPhaseBreakdown(pirep.id),
    getPirepApproachAnalysis(pirep.id),
    getPirepLandingAnalysis(pirep.id),
  ]);

  // Flugzeit formatieren
  const hours = Math.floor((pirep.flightTimeMin ?? 0) / 60);
  const mins = (pirep.flightTimeMin ?? 0) % 60;
  const flightTime =
    pirep.flightTimeMin === null
      ? '—'
      : hours > 0
        ? `${hours}h ${mins}min`
        : `${mins}min`;

  // Status-Styling. Draft (option #19) gets cyan to clearly differentiate
  // from yellow Submitted — pilot at-a-glance sees "this is mine to act
  // on" vs "this is in admin queue". Approved/Rejected unchanged.
  const statusStyles =
    pirep.status === 'Approved'
      ? 'bg-green-500/10 border-green-500/30 text-green-400'
      : pirep.status === 'Rejected'
        ? 'bg-red-500/10 border-red-500/30 text-red-400'
        : pirep.status === 'Draft'
          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
          : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400';

  const statusLabel =
    pirep.status === 'Approved'
      ? 'Genehmigt'
      : pirep.status === 'Rejected'
        ? 'Abgelehnt'
        : pirep.status === 'Draft'
          ? 'Entwurf'
          : 'Eingereicht';

  // Show approval actions: nur für approver UND status=Submitted UND nicht eigener PIREP.
  // Drafts are explicitly excluded — they're not in the approval queue yet,
  // the pilot must Submit first (option #19).
  const showApprovalActions =
    isApprover && pirep.status === 'Submitted' && !isOwn;

  // Show draft actions: only the OWNING pilot, only on Draft (option #19).
  // Suppresses the read-only remarks card below since the editable form
  // includes its own remarks textarea.
  const showDraftActions = pirep.status === 'Draft' && isOwn;

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
              {pirep.status === 'Draft' ? 'Erstellt am ' : 'Eingereicht am '}
              {new Date(pirep.submittedAt).toLocaleString('de-DE', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Track 1 #5 (Replay-Mode): "Play Flight"-button. Conditional
                rendered wenn hasReplayDataForPirep === true (server-side
                check oben). Linkt auf /pireps/[id]/replay wo die map-page
                den trail rendert. */}
            {hasReplay && (
              <Link
                href={`/pireps/${pirep.id}/replay`}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition flex items-center gap-1.5"
              >
                <span aria-hidden="true">▶</span>
                Play Flight
              </Link>
            )}
            <Link
              href={isApprover && pirep.status === 'Submitted' ? '/pireps/pending' : '/pireps'}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Zurück
            </Link>
          </div>
        </header>

        {/* Approval Actions (nur für Approver bei Submitted PIREPs) */}
        {showApprovalActions && (
          <div className="mb-8">
            <ApprovalActions pirepId={pirep.id} />
          </div>
        )}

        {/* Draft Actions (nur für owning Pilot bei Draft-PIREPs, option #19).
            Editable form für remarks + flightTimeMin + fuelUsedKg +
            landingRateFpm; buttons für Speichern, Submit, Verwerfen.
            Suppresses the static "Bemerkungen"-card below since the
            edit-form has its own remarks textarea. */}
        {showDraftActions && (
          <DraftActions
            pirepId={pirep.id}
            initialRemarks={pirep.remarks}
            initialFlightTimeMin={pirep.flightTimeMin}
            initialFuelUsedKg={pirep.fuelUsedKg}
            initialLandingRateFpm={pirep.landingRateFpm}
          />
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

        {/* Welle 13E-14d: Practical-Exam-Badge.
            Sichtbar wenn dieser PIREP einem enrollment als Prüfungsflug
            zugewiesen ist. Zwei states:

              EXAM_SCHEDULED + practicalExamPassedAt=null → wartet auf
                instructor-review. Amber-styling, zeigt "wartet" hint.
              PASSED + practicalExamPassedAt set → bestanden, license
                wurde ausgestellt. Green-styling.

            Link-target ist context-abhängig:
              - Pilot (isOwn) → /flight-schools/[schoolId] (sieht enrollment-
                card mit Card-status)
              - Approver/Instructor → /airline/practical-exams (review-queue;
                relevant für PASSED-states als history nicht sinnvoll, aber
                der pilot kann auch hier ne andere review pending haben)

            Wenn der enrollment in einem nicht-erwarteten state ist
            (FAILED/WITHDRAWN — sollte nie passieren weil pirepId dann
            null wäre, aber defensive), zeigen wir einen neutralen
            "war Prüfungsflug"-text ohne styling. */}
        {examEnrollment && (
          <div
            className={`mb-8 px-6 py-4 rounded-lg border ${
              examEnrollment.practicalExamPassedAt !== null
                ? 'bg-green-500/5 border-green-500/30'
                : examEnrollment.status === 'EXAM_SCHEDULED'
                  ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-gray-500/5 border-gray-500/30'
            }`}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm">
                  <span className="font-semibold">
                    {examEnrollment.practicalExamPassedAt !== null
                      ? '✓ Prüfungsflug bestanden'
                      : '🎓 Markiert als Prüfungsflug'}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {' '}für{' '}
                  </span>
                  <span className="font-semibold">
                    {licenseDisplayName(examEnrollment.licenseType)}
                  </span>
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Flugschule {examEnrollment.school.name} (
                  <span className="font-mono">
                    {examEnrollment.school.airportIcao}
                  </span>
                  )
                  {examEnrollment.practicalExamPassedAt && (
                    <>
                      {' · Bestanden am '}
                      {new Date(
                        examEnrollment.practicalExamPassedAt,
                      ).toLocaleDateString('de-DE')}
                    </>
                  )}
                  {!examEnrollment.practicalExamPassedAt &&
                    examEnrollment.status === 'EXAM_SCHEDULED' && (
                      <> · Wartet auf Instructor-Review</>
                    )}
                </p>
              </div>
              <Link
                href={
                  isOwn
                    ? `/flight-schools/${examEnrollment.schoolId}`
                    : '/airline/practical-exams'
                }
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                {isOwn ? 'Zur Flugschule →' : 'Zur Review-Queue →'}
              </Link>
            </div>
          </div>
        )}

        {/* Track 4 #1 (PIREP-Analysis Hero): At-a-glance KPI-strip mit
            den 5 wichtigsten flight-metrics. Zweck: pilot+admin sollen
            beim öffnen der page sofort sehen "wie war der flug" ohne
            scrollen zu müssen.

            5 fixe spalten: Block-Time, Distanz, Treibstoff, Passagiere,
            Score. Responsive grid (2 cols mobile, 3 tablet, 5 desktop).
            Jede zelle rendert auch bei null-data (zeigt "—") damit
            manual-PIREPs ohne ACARS-zahlen nicht ein leeres element
            haben.

            "Score" ist ein placeholder bis Track 4 #7 (Smoothness-Score)
            den combined-metric berechnet. Bewusst grau gerendert mit
            sublabel "bald verfügbar" damit klar ist dass das slot später
            gefüllt wird — kein dead-element.

            Block-Time = pirep.flightTimeMin. Seit option #13 (commit
            03cb1b6) ist das block-to-block (von BLOCK_OFF bis BLOCK_ON
            event), nicht mehr nur airborne-time. Für legacy-PIREPs
            pre-#13 ist es weiterhin airborne aber das delta ist meist
            < 10min und der display bleibt akkurat genug. */}
        <section className="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-white dark:bg-gray-900 border border-indigo-300 dark:border-indigo-700/40 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-semibold">
              Block-Time
            </p>
            <p className="text-2xl font-bold mt-2 leading-tight">
              {flightTime}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Distanz
            </p>
            <p className="text-2xl font-bold mt-2 leading-tight">
              {pirep.route?.distanceNm ? `${pirep.route.distanceNm}` : '—'}
              {pirep.route?.distanceNm && (
                <span className="text-sm font-normal text-gray-500 ml-1">nm</span>
              )}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Treibstoff
            </p>
            <p className="text-2xl font-bold mt-2 leading-tight">
              {pirep.fuelUsedKg !== null ? `${pirep.fuelUsedKg}` : '—'}
              {pirep.fuelUsedKg !== null && (
                <span className="text-sm font-normal text-gray-500 ml-1">kg</span>
              )}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Passagiere
            </p>
            <p className="text-2xl font-bold mt-2 leading-tight">
              {pirep.passengerCount !== null ? pirep.passengerCount : '—'}
            </p>
            {pirep.cargoKg !== null && pirep.cargoKg > 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                +{pirep.cargoKg} kg Cargo
              </p>
            )}
          </div>
          {/* Score-Slot — placeholder bis Track 4 #7. Bewusst muted-style
              damit klar ist "hier kommt noch was". Nicht hidden weil
              das KPI-grid sonst eine spalte verliert und unausgewogen
              wirkt. */}
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Score
            </p>
            <p className="text-2xl font-bold mt-2 leading-tight text-gray-400 dark:text-gray-600">
              —
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1">
              bald verfügbar
            </p>
          </div>
        </section>

        {/* Track 4 #2 (Phase-Breakdown-Bar): horizontal stacked-bar das
            zeigt wieviel zeit in jeder phase verbracht wurde. Pure visual
            tool — keine actions, nur info.

            Conditional render: nur wenn phaseBreakdown !== null (= session
            matched, hat positions, hat klassifizierte phases). Bei manual-
            PIREPs ohne ACARS-data oder bei VATSIM-only-flights mit
            niedrigem signal-to-noise wird die section gehidden statt eine
            sinnlose 100%-PreFlight-bar anzuzeigen.

            Approximation: positionCount × samplerate ≈ time. Bei ACARS
            (1Hz) ist das exakt; bei VATSIM/IVAO (30s polling) gibt's
            grobere granularität. Caveat documentiert in der helper-
            docstring (getPirepPhaseBreakdown).

            Render-strategie: ein 8px-hohe stacked bar mit colored segments,
            darunter ein 2-spaltiges grid mit phase-name + duration für
            jede phase die ≥0.1% hat. Filtert raus phases mit weniger als
            0.1% (z.B. 1 position in einer 1000-position-session) damit
            der legend nicht mit 11 zeilen zugespammt wird. */}
        {phaseBreakdown && phaseBreakdown.phases.length > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
                Phase-Breakdown
              </h2>
              <p className="text-xs text-gray-400">
                {formatPhaseDuration(phaseBreakdown.totalDurationMs)}
                {' · '}
                {phaseBreakdown.totalPositionCount.toLocaleString('de-DE')}{' '}
                Datenpunkte
              </p>
            </div>

            {/* Horizontal stacked-bar. flex statt grid weil width per
                segment dynamisch via inline-style basierend auf percent
                gesetzt wird. min-w-[2px] damit auch winzige phases
                visible bleiben (sonst wären 0.5%-segments unsichtbar). */}
            <div className="h-3 rounded-full overflow-hidden flex bg-gray-100 dark:bg-gray-800">
              {phaseBreakdown.phases.map((p) => (
                <div
                  key={p.phase}
                  className={`${PHASE_BAR_CLASSES[p.phase] ?? 'bg-gray-400'} min-w-[2px] transition-all`}
                  style={{ width: `${p.percent}%` }}
                  title={`${PHASE_LABELS[p.phase] ?? p.phase}: ${p.percent.toFixed(1)}% (${formatPhaseDuration(p.estDurationMs)})`}
                />
              ))}
            </div>

            {/* Legend-grid. 2 cols mobile, 3 cols tablet+. Filter < 0.1%
                damit der legend kompakt bleibt (1-position-noise-phases
                landen unter dem cutoff). */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-4">
              {phaseBreakdown.phases
                .filter((p) => p.percent >= 0.1)
                .map((p) => (
                  <div
                    key={p.phase}
                    className="flex items-baseline gap-2 text-xs"
                  >
                    <span
                      className={`${PHASE_BAR_CLASSES[p.phase] ?? 'bg-gray-400'} h-3 w-3 rounded shrink-0 self-center`}
                      aria-hidden="true"
                    />
                    <span className="text-gray-700 dark:text-gray-300 font-medium">
                      {PHASE_LABELS[p.phase] ?? p.phase}
                    </span>
                    <span className="text-gray-500 ml-auto tabular-nums">
                      {p.percent.toFixed(1)}%
                    </span>
                    <span className="text-gray-400 dark:text-gray-500 tabular-nums">
                      {formatPhaseDuration(p.estDurationMs)}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Track 4 #3 (Vertical-Profile-Chart): altitude vs. time recharts
            area-chart. Conditional auf hasReplay — wenn keine session-data
            vorhanden, hidden. Selber gate wie Phase-Breakdown aber als
            separate condition damit eines unabhängig vom anderen
            funktioniert (z.B. session existiert aber alle phases=null).

            Client-component render — siehe vertical-profile-chart.tsx
            docstring für reasoning (lazy-fetch via API statt server-
            payload-bloat). Wrapper-section gibt das chart eine konsistente
            card-styling matching #1+#2. */}
        {hasReplay && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Vertical-Profile
            </h2>
            <VerticalProfileChart pirepId={pirep.id} />
          </section>
        )}

        {/* Track 4 #4 (Aircraft-Performance-Chart): IAS + VSI dual-axis
            line-chart über die zeit. Selbe gate wie Vertical-Profile —
            client-component fetcht via /api/replay endpoint und rendert
            nur wenn data verfügbar.

            Im roadmap-vision war das ursprünglich "Engine-Performance"
            mit N1/fuelFlow — aber LiveSessionPosition speichert keine
            per-frame engine-data, nur session-level-aggregates auf
            LiveSession. Daher rename → "Aircraft-Performance" mit den
            tatsächlich verfügbaren ACARS-fields IAS + VSI. Siehe
            aircraft-performance-chart.tsx docstring "Naming-disclaimer".

            Beide charts (Vertical-Profile + Aircraft-Performance) nutzen
            denselben fetch-endpoint. Browser-cache stellt sicher dass
            der zweite chart instant lädt nach dem ersten — kein
            duplicate-network-roundtrip. */}
        {hasReplay && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
              Aircraft-Performance
            </h2>
            <AircraftPerformanceChart pirepId={pirep.id} />
          </section>
        )}

        {/* Track 4 #5 (Approach-Analysis): drei stabilized-approach
            metrics aus dem position-trail. Conditional auf
            approachAnalysis !== null (= session matched + es gab
            positions mit altitudeAglFt im 3000ft-window in den letzten
            30min vor session-end).

            Nicht jeder PIREP hat AGL-data: VATSIM/IVAO-tracker schreiben
            keine altitudeAglFt-felder. Bei manual PIREPs ohne ACARS-trail
            wird die section gehidden — kein "0% glideslope-quality"-
            phantom-flag.

            Color-coding pro metric: green ≥80%, amber 50-80%, red <50%
            für glideslope + stabilization. IAS bleibt neutral (kein
            pass/fail weil aircraft-spezifisch).

            Alle drei sind compact-card-cells in einem 3-spaltigen grid. */}
        {approachAnalysis &&
          (approachAnalysis.iasAt1000ft !== null ||
            approachAnalysis.glideslopeQualityPercent !== null ||
            approachAnalysis.stabilizationScorePercent !== null) && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
              <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
                Approach-Analysis
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* IAS @ 1000ft AGL — neutral, kein pass/fail (aircraft-
                    specific Vapp). Sublabel zeigt actual AGL für transparency
                    (z.B. "@ 987ft AGL" wenn die nächstliegende position
                    nicht exakt 1000 war). */}
                <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    IAS @ 1000ft AGL
                  </p>
                  <p className="text-2xl font-bold mt-2 leading-tight">
                    {approachAnalysis.iasAt1000ft !== null
                      ? approachAnalysis.iasAt1000ft
                      : '—'}
                    {approachAnalysis.iasAt1000ft !== null && (
                      <span className="text-sm font-normal text-gray-500 ml-1">
                        kt
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {approachAnalysis.agAtIasMeasurement !== null
                      ? `@ ${approachAnalysis.agAtIasMeasurement}ft AGL`
                      : 'keine AGL-daten'}
                  </p>
                </div>

                {/* Glideslope-Quality. Color-coded: green ≥80%, amber
                    50-80%, red <50%. Sublabel: sample-count für
                    transparency. */}
                <div
                  className={`rounded-lg p-4 border ${
                    approachAnalysis.glideslopeQualityPercent === null
                      ? 'bg-gray-50 dark:bg-gray-800/40 border-transparent'
                      : approachAnalysis.glideslopeQualityPercent >= 80
                        ? 'bg-green-500/5 border-green-500/30'
                        : approachAnalysis.glideslopeQualityPercent >= 50
                          ? 'bg-amber-500/5 border-amber-500/30'
                          : 'bg-red-500/5 border-red-500/30'
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Glideslope (3°)
                  </p>
                  <p className="text-2xl font-bold mt-2 leading-tight">
                    {approachAnalysis.glideslopeQualityPercent !== null
                      ? `${approachAnalysis.glideslopeQualityPercent.toFixed(0)}%`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {approachAnalysis.glideslopeSampleCount > 0
                      ? `${approachAnalysis.glideslopeSampleCount} positions, ±300ft`
                      : 'keine daten'}
                  </p>
                </div>

                {/* Stabilization-Score. Selbe color-thresholds wie
                    glideslope. Sublabel hint auf die kriterien (VSI/bank/
                    pitch) ohne ins detail zu gehen. */}
                <div
                  className={`rounded-lg p-4 border ${
                    approachAnalysis.stabilizationScorePercent === null
                      ? 'bg-gray-50 dark:bg-gray-800/40 border-transparent'
                      : approachAnalysis.stabilizationScorePercent >= 80
                        ? 'bg-green-500/5 border-green-500/30'
                        : approachAnalysis.stabilizationScorePercent >= 50
                          ? 'bg-amber-500/5 border-amber-500/30'
                          : 'bg-red-500/5 border-red-500/30'
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Stabilized-Approach
                  </p>
                  <p className="text-2xl font-bold mt-2 leading-tight">
                    {approachAnalysis.stabilizationScorePercent !== null
                      ? `${approachAnalysis.stabilizationScorePercent.toFixed(0)}%`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {approachAnalysis.stabilizationSampleCount > 0
                      ? `final 1000ft, VSI/bank/pitch ok`
                      : 'keine daten'}
                  </p>
                </div>
              </div>
            </section>
          )}

        {/* Track 4 #6 (Landing-Analysis): Touchdown-metrics aus dem
            TOUCHDOWN AcarsEvent payload. Conditional auf
            landingAnalysis.verticalFpmAtTouchdown !== null — manual +
            VATSIM/IVAO PIREPs haben kein TOUCHDOWN-event, dann hidden.

            Drei sanity-card-cells:
            - Touchdown-Rate (VSI): Hauptmetric, color-coded nach
              industry severity-bands (smooth <200, normal 200-400,
              firm 400-600, hard 600-1000, severe >1000 fpm). Math.abs()
              wird vor display angewandt da raw-VSI negativ ist (descent).
            - Groundspeed @ touchdown: neutral, kein pass/fail
            - Touchdown-airport: sanity-check (sollte = arrival ICAO)

            Note: pirep.landingRateFpm bleibt im legacy-bug bei null
            (generate-pirep.ts liest 'verticalSpeedFpm' aber payload
            nutzt 'verticalFpmAtTouchdown'). Diese section liest direkt
            aus dem event-payload und ist damit accurate, unabhängig
            vom legacy-bug. */}
        {landingAnalysis &&
          landingAnalysis.verticalFpmAtTouchdown !== null && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
              <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold mb-4">
                Landing-Analysis
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Touchdown-Rate. Color-bands per industry guidance.
                    Math.abs() weil raw-VSI negativ. Sublabel zeigt
                    severity-label + raw-fpm. */}
                {(() => {
                  const fpm = landingAnalysis.verticalFpmAtTouchdown;
                  // fpm ist nicht null hier (siehe outer guard). Defensive
                  // narrow für TS:
                  const absFpm = Math.abs(fpm ?? 0);
                  const severityLabel =
                    absFpm < 200
                      ? 'smooth'
                      : absFpm < 400
                        ? 'normal'
                        : absFpm < 600
                          ? 'firm'
                          : absFpm < 1000
                            ? 'hard'
                            : 'severe';
                  const colorClasses =
                    absFpm < 200
                      ? 'bg-green-500/5 border-green-500/30'
                      : absFpm < 400
                        ? 'bg-blue-500/5 border-blue-500/30'
                        : absFpm < 600
                          ? 'bg-amber-500/5 border-amber-500/30'
                          : absFpm < 1000
                            ? 'bg-orange-500/5 border-orange-500/30'
                            : 'bg-red-500/5 border-red-500/30';
                  return (
                    <div
                      className={`rounded-lg p-4 border ${colorClasses}`}
                    >
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Touchdown-Rate
                      </p>
                      <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
                        {absFpm}
                        <span className="text-sm font-normal text-gray-500 ml-1">
                          fpm
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-500 mt-1">
                        {severityLabel}
                      </p>
                    </div>
                  );
                })()}

                {/* Groundspeed @ touchdown — neutral. Sublabel:
                    AGL altitude des touchdowns als sanity-check (sollte
                    nahe 0 liegen, sonst war's eher ein flare-out oder
                    sensor-noise). */}
                <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Groundspeed
                  </p>
                  <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
                    {landingAnalysis.groundSpeedKtsAtTouchdown !== null
                      ? landingAnalysis.groundSpeedKtsAtTouchdown
                      : '—'}
                    {landingAnalysis.groundSpeedKtsAtTouchdown !==
                      null && (
                      <span className="text-sm font-normal text-gray-500 ml-1">
                        kt
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {landingAnalysis.altitudeAglAtTouchdown !== null
                      ? `@ ${landingAnalysis.altitudeAglAtTouchdown}ft AGL`
                      : 'bei touchdown'}
                  </p>
                </div>

                {/* Touchdown-Airport — sanity check, sollte arrival
                    matchen. Bei mismatch (z.B. divert) sieht admin
                    sofort dass landing-airport != filed-arrival. */}
                <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Touchdown @
                  </p>
                  <p className="text-2xl font-bold mt-2 leading-tight font-mono">
                    {landingAnalysis.atIcao ?? '—'}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {landingAnalysis.touchdownAt
                      ? new Date(
                          landingAnalysis.touchdownAt,
                        ).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : ''}
                    {landingAnalysis.atIcao &&
                    pirep.arrival.icao &&
                    landingAnalysis.atIcao !== pirep.arrival.icao
                      ? ' ⚠ ≠ Arrival'
                      : ''}
                  </p>
                </div>
              </div>
            </section>
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

        {/* Bemerkungen (falls vorhanden). Hidden when DraftActions is
            rendered — that component has its own remarks textarea and
            showing both would duplicate the text. Other viewers (admin
            looking at someone's Draft, or the owning pilot once it's
            Submitted/Approved/Rejected) see the static card as before. */}
        {pirep.remarks && !showDraftActions && (
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