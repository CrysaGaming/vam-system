import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import {
  prisma,
  licenseDisplayName,
  hasReplayDataForPirep,
  getPirepPhaseBreakdown,
  getPirepApproachAnalysis,
  getPirepLandingAnalysis,
  getRouteAverages,
} from '@vam/db';
import Link from 'next/link';
import { OfpSummary } from '@/components/OfpSummary';
import {
  WeatherComparisonCard,
  type WeatherComparisonSimData,
  type WeatherComparisonRealData,
} from '@/components/weather-comparison-card';
import { fetchSingleMetar } from '@/lib/metars/fetch-from-bot';
import { ApprovalActions } from './approval-actions';
import { DraftActions } from './draft-actions';
import { KudosButton } from './kudos-button';
import { VerticalProfileChart } from './vertical-profile-chart';
import { AircraftPerformanceChart } from './aircraft-performance-chart';
import { isApproverRole } from '@/lib/roles';
import { RecentItemTracker } from '@/components/recent-item-tracker';
import { computeSmoothnessScore, computeSuggestions } from '@/lib/pirep-metrics';
import { AnnotationList } from './annotation-list';
import { CommentsSection } from './comments-section';
import { PhotoGallery } from './photo-gallery';

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

/**
 * Track 4 #7 — Smoothness-Score now lives in @/lib/pirep-metrics (Track 5 #1
 * extracted it so both this detail-page and the Comparison-page share the
 * exact same algorithm). The function is imported at the top of this file;
 * the inline definition that used to be here was removed. Component weights
 * and the touchdown-VSI scoring-curve are documented in pirep-metrics.ts.
 */

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
      // Welle B — B1 phase 3. Pull the BLOCK_ON event that triggered
      // this PIREP so we can walk to LiveSession.environment for the
      // Weather Comparison card. Null for manual / non-ACARS PIREPs —
      // those skip the weather section entirely.
      triggeringEvent: {
        select: { sessionId: true },
      },
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
  // Track 4 #8 (Comparison-Section): routeAverages-fetch ist conditional
  // auf pirep.routeId. Bei standalone-PIREPs ohne route-binding ist es
  // null, dann skip-fetch — Promise.resolve(null) hält das tuple-shape
  // konsistent ohne extra-roundtrip. excludePirepId verhindert dass
  // der eigene flug die avg-baseline beeinflusst.
  const [
    examEnrollment,
    hasReplay,
    phaseBreakdown,
    approachAnalysis,
    landingAnalysis,
    routeAverages,
    kudosCount,
    ownKudos,
    compareCandidates,
    annotations,
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
    pirep.routeId
      ? getRouteAverages(pirep.routeId, pirep.id)
      : Promise.resolve(null),
    // Track 4 #60 (Section L): Kudos-count + own-state parallel laden.
    // Count ist für die anzeige am button, ownKudos für initial-given-state.
    // findUnique via @@unique-index ist O(1).
    prisma.pirepKudos.count({ where: { pirepId: pirep.id } }),
    prisma.pirepKudos.findUnique({
      where: { pirepId_userId: { pirepId: pirep.id, userId: currentUser.id } },
      select: { id: true },
    }),
    // Track 5 #1 (PIREP-Comparison-Mode) — compare-candidates picker.
    // Findet bis zu 8 PIREPs die für vergleich geeignet sind. Heuristik:
    //   - selber user (preference; eigene history macht den meisten sinn)
    //   - selbe route ODER selbe departure+arrival (route-id-match wäre
    //     strikter aber wir wollen auch standalone-PIREPs ohne route-FK
    //     mit-erfassen → match auf airport-ICAOs als fallback)
    //   - NICHT der current PIREP selbst (exclude id)
    //   - sortiert by submittedAt desc (recent zuerst)
    // Fallback: wenn weniger als 3 same-route-flüge gefunden, ergänzen
    // wir mit recent-other-flights vom selben user (allgemeiner vergleich).
    // V1 keep it simple: nur same-route, kein fallback. Wenn keiner da
    // ist, zeigt der picker einen empty-hint statt fehlt.
    prisma.pirep.findMany({
      where: {
        userId: pirep.userId,
        id: { not: pirep.id },
        departure: { icao: pirep.departure.icao },
        arrival: { icao: pirep.arrival.icao },
      },
      select: {
        id: true,
        submittedAt: true,
        status: true,
        flightTimeMin: true,
        route: { select: { flightNumber: true } },
        aircraft: { select: { registration: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 8,
    }),
    // Track 5 #3 — Annotations fetch. Sortiert nach frameIndex damit
    // die list chronologisch dem trail folgt.
    prisma.pirepAnnotation.findMany({
      where: { pirepId: pirep.id },
      select: {
        id: true,
        frameIndex: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true } },
      },
      orderBy: { frameIndex: 'asc' },
    }),
  ]);

  // Welle B — B1 phase 3. Weather Comparison data fetch. Runs as a
  // parallel pair (LiveSession + arrival METAR) AFTER the main Promise.all
  // rather than inside it, because the tuple-typing in the main block
  // would get noisy and the weather fetch is cheap enough that an extra
  // microsecond of sequential wait doesn't matter. Both arms are wrapped
  // in null-safe conditionals:
  //
  //   - liveSession is null when this PIREP wasn't ACARS-triggered
  //     (no triggeringEvent → no sessionId → can't walk to LiveSession).
  //     The weather card just doesn't render in that case.
  //   - arrivalMetar is null when the bot's METAR cache has nothing for
  //     this airport (cold cache, unknown ICAO, VATSIM datafeed gap).
  //     The card renders sim-only with an explanatory note.
  //
  // The Promise.all keeps the two fetches concurrent — saves one full
  // round-trip vs serial. fetchSingleMetar is server-side cached
  // (next: { revalidate: 60 }) so multiple PIREP-detail visits to the
  // same airport within 60s share one bot request.
  const [liveSession, arrivalMetar] = await Promise.all([
    pirep.triggeringEvent?.sessionId
      ? prisma.liveSession.findUnique({
          where: { id: pirep.triggeringEvent.sessionId },
          select: {
            windSpeedKts: true,
            windDirection: true,
            oatCelsius: true,
            ambientPressureMb: true,
          },
        })
      : Promise.resolve(null),
    fetchSingleMetar(pirep.arrival.icao),
  ]);

  // Build the shapes WeatherComparisonCard wants. simData is null when
  // we don't have a LiveSession to read from (manual PIREP, pre-B1
  // session); the section is skipped entirely below in that case.
  // simHasAnyData also covers the edge case where LiveSession exists
  // but every environment field is null (very brief session that died
  // before any environment-block heartbeat landed).
  const simData: WeatherComparisonSimData | null = liveSession
    ? {
        windSpeedKts: liveSession.windSpeedKts,
        windDirection: liveSession.windDirection,
        oatCelsius: liveSession.oatCelsius,
        ambientPressureMb: liveSession.ambientPressureMb,
      }
    : null;
  const simHasAnyData =
    simData !== null &&
    (simData.windSpeedKts !== null ||
      simData.windDirection !== null ||
      simData.oatCelsius !== null ||
      simData.ambientPressureMb !== null);

  // realData is null when no METAR is cached. We still render the card
  // (with sim values only and a note) IF we have sim data — pilots
  // benefit from seeing "what the sim said" even without a real-world
  // baseline. The component handles the null gracefully.
  const realData: WeatherComparisonRealData | null =
    arrivalMetar?.decoded
      ? {
          windSpeedKts: arrivalMetar.decoded.wind?.speed ?? null,
          windDirection: arrivalMetar.decoded.wind?.direction ?? null,
          windGustKts: arrivalMetar.decoded.wind?.gust ?? null,
          oatCelsius: arrivalMetar.decoded.temperature ?? null,
          ambientPressureMb: arrivalMetar.decoded.pressure?.qnhHpa ?? null,
          observedAt: arrivalMetar.decoded.observedAt,
          raw: arrivalMetar.raw,
        }
      : null;

  // Track 4 #7 — Smoothness-Score wird inline aus den oben gefetchten
  // metrics berechnet. Kein zusätzlicher DB-roundtrip, einfach pure-
  // function über die bestehenden values. Returns null wenn keine
  // component verfügbar — Hero-Score-cell rendert dann den placeholder.
  const smoothnessScore = computeSmoothnessScore(
    landingAnalysis?.verticalFpmAtTouchdown,
    approachAnalysis?.stabilizationScorePercent,
    approachAnalysis?.glideslopeQualityPercent,
  );

  // Track 5 #4 — Suggestions computed from already-fetched metrics. Pure
  // function, no extra DB call.
  const suggestions = computeSuggestions({
    landingAnalysis,
    approachAnalysis,
    routeAverages,
    pirep: {
      fuelUsedKg: pirep.fuelUsedKg,
      flightTimeMin: pirep.flightTimeMin,
      landingRateFpm: pirep.landingRateFpm,
    },
    smoothnessScore,
  });

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
      {/* Track 4 #71 (Section N): Recently-Viewed tracker. Schreibt diese
          PIREP als "kürzlich besucht" in den localStorage. Pure-side-
          effect, renders nichts visuell — siehe RecentItemTracker doc-
          string + lib/recently-viewed.ts. */}
      <RecentItemTracker
        id={pirep.id}
        type="pirep"
        label={`${pirep.route?.flightNumber ?? 'PIREP'} ${pirep.departure.icao}→${pirep.arrival.icao}`}
        subLabel={statusLabel}
        href={`/pireps/${pirep.id}`}
      />
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
            {/* Track 5 #5 (PIREP-Logbook PDF): "Download Logbook"-button.
                Direkter <a>-link auf die API-route — kein client-state nötig,
                der browser handled den download via Content-Disposition.
                target=_blank verhindert dass die aktuelle PIREP-page durch
                ein potentielles error-JSON ersetzt wird wenn der server
                den PDF-render fehlschlägt.

                Conditional: nur bei status !== 'Draft' rendern. Draft-PIREPs
                sind noch unfertig — kein sinnvolles logbook bevor der
                pilot submitted. */}
            {pirep.status !== 'Draft' && (
              <a
                href={`/api/pireps/${pirep.id}/logbook`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium transition flex items-center gap-1.5"
                title="Single-page A4 PDF mit allen Flight-Metriken"
              >
                <span aria-hidden="true">📄</span>
                Logbook PDF
              </a>
            )}
            {/* Track 5 #1 (PIREP-Comparison-Mode): "Compare with..."-picker.
                Native <details>+<summary> als zero-JS-dropdown. Bei click
                expandiert eine list mit max 8 sibling-PIREPs (selbe user,
                selbe route, sortiert by submittedAt desc). Klick → linkt
                auf /pireps/compare?a=<self>&b=<sibling>.

                Wenn keine siblings: dropdown bleibt geschlossen-empty
                mit hint "keine vergleichbaren flüge gefunden". Cheaper
                als conditional-render weil der button trotzdem visible
                bleibt — der user sieht dass die feature existiert.

                Positioning: native <details> + absolute <div> innen.
                z-index oben damit das menu über nachfolgenden sections
                schwebt. */}
            {compareCandidates.length > 0 && (
              <details className="relative group">
                <summary className="list-none px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition flex items-center gap-1.5 cursor-pointer">
                  <span aria-hidden="true">🔄</span>
                  Vergleichen
                </summary>
                <div className="absolute right-0 top-full mt-2 z-10 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      Andere Flüge auf {pirep.departure.icao} →{' '}
                      {pirep.arrival.icao}
                    </p>
                  </div>
                  <ul className="max-h-80 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800">
                    {compareCandidates.map((c) => {
                      const h = c.flightTimeMin
                        ? Math.floor(c.flightTimeMin / 60)
                        : 0;
                      const m = c.flightTimeMin ? c.flightTimeMin % 60 : 0;
                      const ftLabel = c.flightTimeMin
                        ? h > 0
                          ? `${h}h ${m}min`
                          : `${m}min`
                        : '—';
                      return (
                        <li key={c.id}>
                          <Link
                            href={`/pireps/compare?a=${pirep.id}&b=${c.id}`}
                            className="block px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-mono text-xs font-semibold text-gray-900 dark:text-white">
                                {c.route?.flightNumber ?? 'PIREP'}
                              </span>
                              <span className="text-[10px] text-gray-500 font-mono">
                                {new Date(c.submittedAt).toLocaleDateString(
                                  'de-DE',
                                )}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2 mt-0.5">
                              <span className="text-[11px] text-gray-600 dark:text-gray-400">
                                {c.aircraft?.registration ?? '—'} · {c.status}
                              </span>
                              <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                                {ftLabel}
                              </span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </details>
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
          {/* Track 4 #7 — Smoothness-Score-Cell. Bisher Placeholder,
              jetzt echter combined-metric aus computeSmoothnessScore.
              Returns null wenn weder touchdown noch approach-data
              verfügbar (z.B. manual-PIREP) — fallback auf den dashed-
              placeholder so dass das KPI-grid weiterhin balanced wirkt.

              Color-coding nach score-tier:
                ≥85   green  ("excellent")
                70-84 emerald
                55-69 amber  ("acceptable")
                40-54 orange ("needs work")
                <40   red    ("rough flight")
              Border-color matches damit die zelle zwischen den anderen
              KPI-cells visuell hervorsticht — das IST die headline-
              metric, die anderen sind raw-zahlen. */}
          {smoothnessScore !== null ? (
            <div
              className={`rounded-lg p-4 border ${
                smoothnessScore >= 85
                  ? 'bg-green-500/5 border-green-500/40'
                  : smoothnessScore >= 70
                    ? 'bg-emerald-500/5 border-emerald-500/40'
                    : smoothnessScore >= 55
                      ? 'bg-amber-500/5 border-amber-500/40'
                      : smoothnessScore >= 40
                        ? 'bg-orange-500/5 border-orange-500/40'
                        : 'bg-red-500/5 border-red-500/40'
              }`}
            >
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Smoothness
              </p>
              <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
                {smoothnessScore}
                <span className="text-sm font-normal text-gray-500 ml-1">
                  /100
                </span>
              </p>
              <p className="text-[10px] text-gray-500 mt-1">
                {smoothnessScore >= 85
                  ? 'excellent'
                  : smoothnessScore >= 70
                    ? 'good'
                    : smoothnessScore >= 55
                      ? 'acceptable'
                      : smoothnessScore >= 40
                        ? 'needs work'
                        : 'rough'}
              </p>
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-900/50 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                Smoothness
              </p>
              <p className="text-2xl font-bold mt-2 leading-tight text-gray-400 dark:text-gray-600">
                —
              </p>
              <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1">
                keine ACARS-daten
              </p>
            </div>
          )}
        </section>

        {/* Track 5 #4 — Auto-Improvement-Suggestions. Regelbasierte hints
            aus ACARS-Metriken. Nur rendern wenn mind. 1 suggestion vorhanden.
            warnings zuerst (rot), dann infos (blau). */}
        {suggestions.length > 0 && (
          <section className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800/40 rounded-lg p-6 mb-8">
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm uppercase tracking-wider text-blue-700 dark:text-blue-400 font-semibold">
                💡 Verbesserungshinweise
              </h2>
              <p className="text-xs text-gray-400">{suggestions.length} {suggestions.length === 1 ? 'Hinweis' : 'Hinweise'}</p>
            </div>
            <ul className="space-y-3">
              {suggestions.map((s, i) => (
                <li key={i} className={`flex gap-3 px-4 py-3 rounded-lg border ${s.severity === 'warning' ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-700/40' : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30'}`}>
                  <span className="shrink-0 text-base leading-5 mt-0.5" aria-hidden="true">
                    {s.severity === 'warning' ? '⚠️' : 'ℹ️'}
                  </span>
                  <div>
                    <p className={`text-sm font-medium ${s.severity === 'warning' ? 'text-amber-800 dark:text-amber-200' : 'text-blue-800 dark:text-blue-200'}`}>
                      {s.title}
                    </p>
                    {s.detail && (
                      <p className="text-xs mt-0.5 text-gray-600 dark:text-gray-400">{s.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

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

        {/* Welle B — B1 phase 3 (Weather Comparison): sim-side environment
            snapshot at flight-end vs. real-world METAR for the arrival
            airport. Renders between Approach-Analysis and Landing-
            Analysis because weather conditions at the runway directly
            inform both: a strong crosswind explains an off-centerline
            touchdown; a high QNH delta hints at sim-altimeter-config
            problems that surface in the approach data.

            Conditional gate: simHasAnyData is null/false for manual
            PIREPs (no ACARS triggeringEvent → no LiveSession to read
            from) and for pre-B1 sessions (sim data never sent). We
            still render the card when REAL data is missing — pilots
            benefit from seeing their sim's reading even without a
            real-world baseline, and the component handles that case
            with a muted note. */}
        {simHasAnyData && simData && (
          <WeatherComparisonCard
            arrivalIcao={pirep.arrival.icao}
            sim={simData}
            real={realData}
          />
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

        {/* Track 4 #8 (Comparison-Section): how-did-this-flight-compare-
            to-others-on-the-same-route. routeAverages !== null wenn die
            route mind. MIN_COMPARISON_SAMPLES (=2) approved peer-PIREPs
            hat. Für jede metric wird "your value vs avg" mit delta-
            indikator gerendert.

            Layout: 3-card grid analog zu Approach-Analysis (#5). Pro
            metric:
            - Top: dein wert (groß)
            - Middle: avg + delta in absolute units
            - Bottom: trend-indikator + qualitative bewertung

            Color-coding: bei flight-time + fuel ist "kleiner = besser"
            (effizienter, schneller). Bei landing-rate ist "kleiner als
            avg-magnitude = besser" (smoother). Schwellen: ±5% = neutral
            (gray), 5-15% besser = green/positiv, >15% besser = strong-
            green, schlechter analog amber/red.

            Wenn pro metric entweder eigenes value ODER avg null ist,
            zeigt die zelle einen muted "—"-state ohne delta. Sonst
            würde z.B. ein PIREP ohne fuelUsedKg eine sinnlose "100%
            unter avg"-card zeigen. */}
        {routeAverages && (
          <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
                Vergleich Route-Schnitt
              </h2>
              <p className="text-xs text-gray-400">
                vs. {routeAverages.sampleCount}{' '}
                {routeAverages.sampleCount === 1
                  ? 'anderer Flug'
                  : 'andere Flüge'}{' '}
                auf dieser Route
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Block-Time vs avg. own = pirep.flightTimeMin (block-to-
                  block seit option #13). Delta in min, color: green wenn
                  schneller-als-avg, amber wenn ±5% gleich, red wenn
                  langsamer. */}
              {(() => {
                const ownMin = pirep.flightTimeMin;
                const avgMin = routeAverages.avgFlightTimeMin;
                if (ownMin === null || avgMin === null || avgMin === 0) {
                  return (
                    <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Block-Time
                      </p>
                      <p className="text-2xl font-bold mt-2 leading-tight text-gray-400">
                        —
                      </p>
                      <p className="text-[10px] text-gray-500 mt-1">
                        kein Vergleich möglich
                      </p>
                    </div>
                  );
                }
                const deltaMin = ownMin - avgMin;
                const deltaPct = (deltaMin / avgMin) * 100;
                // Schneller-als-avg = positive (green). pirep<avg → deltaMin<0.
                const colorClasses =
                  Math.abs(deltaPct) <= 5
                    ? 'bg-gray-50 dark:bg-gray-800/40 border-transparent'
                    : deltaMin < 0
                      ? 'bg-green-500/5 border-green-500/30'
                      : 'bg-amber-500/5 border-amber-500/30';
                const arrow = deltaMin < 0 ? '↓' : deltaMin > 0 ? '↑' : '=';
                const ownH = Math.floor(ownMin / 60);
                const ownM = ownMin % 60;
                const ownLabel =
                  ownH > 0 ? `${ownH}h ${ownM}min` : `${ownM}min`;
                return (
                  <div className={`rounded-lg p-4 border ${colorClasses}`}>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      Block-Time
                    </p>
                    <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
                      {ownLabel}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1 tabular-nums">
                      Ø {Math.floor(avgMin / 60)}h {avgMin % 60}min ·{' '}
                      <span className="font-semibold">
                        {arrow} {Math.abs(deltaMin)} min
                      </span>{' '}
                      ({deltaPct > 0 ? '+' : ''}
                      {deltaPct.toFixed(1)}%)
                    </p>
                  </div>
                );
              })()}

              {/* Fuel vs avg. own = pirep.fuelUsedKg. Delta in kg.
                  Color: less-than-avg = green (efficiency), more = amber. */}
              {(() => {
                const ownKg = pirep.fuelUsedKg;
                const avgKg = routeAverages.avgFuelUsedKg;
                if (ownKg === null || avgKg === null || avgKg === 0) {
                  return (
                    <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Treibstoff
                      </p>
                      <p className="text-2xl font-bold mt-2 leading-tight text-gray-400">
                        —
                      </p>
                      <p className="text-[10px] text-gray-500 mt-1">
                        kein Vergleich möglich
                      </p>
                    </div>
                  );
                }
                const deltaKg = ownKg - avgKg;
                const deltaPct = (deltaKg / avgKg) * 100;
                const colorClasses =
                  Math.abs(deltaPct) <= 5
                    ? 'bg-gray-50 dark:bg-gray-800/40 border-transparent'
                    : deltaKg < 0
                      ? 'bg-green-500/5 border-green-500/30'
                      : 'bg-amber-500/5 border-amber-500/30';
                const arrow = deltaKg < 0 ? '↓' : deltaKg > 0 ? '↑' : '=';
                return (
                  <div className={`rounded-lg p-4 border ${colorClasses}`}>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      Treibstoff
                    </p>
                    <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
                      {ownKg}
                      <span className="text-sm font-normal text-gray-500 ml-1">
                        kg
                      </span>
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1 tabular-nums">
                      Ø {avgKg} kg ·{' '}
                      <span className="font-semibold">
                        {arrow} {Math.abs(deltaKg)} kg
                      </span>{' '}
                      ({deltaPct > 0 ? '+' : ''}
                      {deltaPct.toFixed(1)}%)
                    </p>
                  </div>
                );
              })()}

              {/* Landing-Rate vs avg. Comparison via |abs|: smaller-mag
                  = smoother. own = pirep.landingRateFpm (legacy-bug:
                  often null für ACARS — siehe #6 docs). Avg ist über
                  alle approved PIREPs der route. */}
              {(() => {
                const ownFpm = pirep.landingRateFpm;
                const avgFpm = routeAverages.avgLandingRateFpm;
                if (ownFpm === null || avgFpm === null) {
                  return (
                    <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Landing-Rate
                      </p>
                      <p className="text-2xl font-bold mt-2 leading-tight text-gray-400">
                        —
                      </p>
                      <p className="text-[10px] text-gray-500 mt-1">
                        kein Vergleich möglich
                      </p>
                    </div>
                  );
                }
                const ownAbs = Math.abs(ownFpm);
                const avgAbs = Math.abs(avgFpm);
                if (avgAbs === 0) {
                  return (
                    <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Landing-Rate
                      </p>
                      <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
                        {ownAbs}
                        <span className="text-sm font-normal text-gray-500 ml-1">
                          fpm
                        </span>
                      </p>
                      <p className="text-[10px] text-gray-500 mt-1">
                        kein Vergleich möglich
                      </p>
                    </div>
                  );
                }
                const deltaAbs = ownAbs - avgAbs;
                const deltaPct = (deltaAbs / avgAbs) * 100;
                // Smoother = smaller magnitude = green
                const colorClasses =
                  Math.abs(deltaPct) <= 10
                    ? 'bg-gray-50 dark:bg-gray-800/40 border-transparent'
                    : deltaAbs < 0
                      ? 'bg-green-500/5 border-green-500/30'
                      : 'bg-amber-500/5 border-amber-500/30';
                const arrow = deltaAbs < 0 ? '↓' : deltaAbs > 0 ? '↑' : '=';
                return (
                  <div className={`rounded-lg p-4 border ${colorClasses}`}>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      Landing-Rate
                    </p>
                    <p className="text-2xl font-bold mt-2 leading-tight tabular-nums">
                      {ownAbs}
                      <span className="text-sm font-normal text-gray-500 ml-1">
                        fpm
                      </span>
                    </p>
                    <p className="text-[10px] text-gray-500 mt-1 tabular-nums">
                      Ø {avgAbs} fpm ·{' '}
                      <span className="font-semibold">
                        {arrow} {Math.abs(deltaAbs)} fpm
                      </span>{' '}
                      ({deltaPct > 0 ? '+' : ''}
                      {deltaPct.toFixed(1)}%)
                    </p>
                  </div>
                );
              })()}
            </div>
          </section>
        )}

        {/* Track 4 #9 (Anti-Cheat-Indicators): badge-row mit den
            structured Pirep.flags aus #20 (commit d3820d9). Conditional
            render nur wenn mindestens ein flag fired — clean PIREPs
            sehen die section gar nicht.

            Flag-types (siehe lib/acars/pirep-flags.ts):
            - simRate: float > 1.01 (faster-than-realtime sim)
            - pauseSec: integer > 60 (significant pause-time)
            - replayFlags: string[] aus verifyReplay (teleport, time-skip,
              speed-impossible, altitude-impossible)
            - hardLanding: { severity: 'hard'|'severe', vsiFpm? }

            Color-philosophy: simRate ist grenzwertig-cheat (amber);
            pauseSec ist meist legitim (toilet break, phone call) aber
            erwähnenswert (slate); replayFlags sind hard signals (red);
            hardLanding hard=orange, severe=red.

            Klick-target: gibt es noch nicht — die badges sind aktuell
            display-only. Future-improvement: link auf admin-review oder
            replay-page mit auto-jump zur betroffenen position. Für v1
            reicht display + sublabel (\"sim-rate 2.5x\"). */}
        {pirep.flags &&
          typeof pirep.flags === 'object' &&
          !Array.isArray(pirep.flags) &&
          (() => {
            // Defensive narrow zu unserem PirepFlags-shape. Json-column
            // ist unstructured am DB-level, daher tolerieren wir das
            // worst-case und filtern fields by-type. Pseudo-type-guard:
            const flags = pirep.flags as {
              simRate?: number;
              pauseSec?: number;
              replayFlags?: string[];
              hardLanding?: { severity?: string; verticalSpeedFpm?: number };
            };
            const hasSimRate = typeof flags.simRate === 'number';
            const hasPause = typeof flags.pauseSec === 'number';
            const hasReplayFlags =
              Array.isArray(flags.replayFlags) &&
              flags.replayFlags.length > 0;
            const hasHardLanding =
              flags.hardLanding && typeof flags.hardLanding === 'object';
            // Wenn nichts fired → ganze section verstecken (außer flags
            // wäre {} — sollte nicht passieren weil buildPirepFlags
            // returns undefined statt {} bei clean PIREPs, aber defensive)
            return (
              hasSimRate || hasPause || hasReplayFlags || hasHardLanding
            );
          })() && (
            <section className="bg-white dark:bg-gray-900 border border-amber-300/50 dark:border-amber-600/30 rounded-lg p-6 mb-8">
              <div className="flex items-baseline gap-3 mb-4">
                <h2 className="text-sm uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold">
                  🚩 Flags
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Anti-Cheat-Hinweise aus der ACARS-Verifizierung
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const flags = pirep.flags as {
                    simRate?: number;
                    pauseSec?: number;
                    replayFlags?: string[];
                    hardLanding?: {
                      severity?: string;
                      verticalSpeedFpm?: number;
                    };
                  };
                  const badges: React.ReactNode[] = [];

                  // sim-rate badge — amber (\"this looks fishy aber not
                  // proof\"). Format: \"⏩ sim-rate 2.5×\"
                  if (typeof flags.simRate === 'number') {
                    badges.push(
                      <span
                        key="simRate"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-300 rounded-md text-xs font-medium"
                        title="Sim-rate über Realzeit. Erlaubt nur wenn explizit von Airline genehmigt."
                      >
                        <span aria-hidden="true">⏩</span>
                        Sim-Rate {flags.simRate.toFixed(1)}×
                      </span>,
                    );
                  }

                  // pause-time badge — slate (legit-meistens, info-only).
                  // Format an total-duration anpassen: < 5min als sec,
                  // sonst min.
                  if (typeof flags.pauseSec === 'number') {
                    const sec = flags.pauseSec;
                    const label =
                      sec < 300
                        ? `${sec}s`
                        : `${Math.round(sec / 60)}min`;
                    badges.push(
                      <span
                        key="pauseSec"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-500/10 border border-slate-500/40 text-slate-700 dark:text-slate-300 rounded-md text-xs font-medium"
                        title="Sim wurde während der Session pausiert. Meist legitim aber dokumentiert."
                      >
                        <span aria-hidden="true">⏸</span>
                        Pause {label}
                      </span>,
                    );
                  }

                  // hardLanding badge — orange/red je severity.
                  if (
                    flags.hardLanding &&
                    typeof flags.hardLanding === 'object'
                  ) {
                    const sev = flags.hardLanding.severity;
                    const isSevere = sev === 'severe' || sev === 'crash';
                    const colorClasses = isSevere
                      ? 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300'
                      : 'bg-orange-500/10 border-orange-500/40 text-orange-700 dark:text-orange-300';
                    const fpm = flags.hardLanding.verticalSpeedFpm;
                    const fpmLabel =
                      typeof fpm === 'number'
                        ? ` (${Math.abs(fpm)} fpm)`
                        : '';
                    badges.push(
                      <span
                        key="hardLanding"
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium ${colorClasses}`}
                        title={
                          isSevere
                            ? 'Severe touchdown — gear-inspection erforderlich'
                            : 'Hard touchdown — über industry-threshold'
                        }
                      >
                        <span aria-hidden="true">💥</span>
                        {isSevere ? 'Severe Landing' : 'Hard Landing'}
                        {fpmLabel}
                      </span>,
                    );
                  }

                  // replayFlags — pro flag ein eigenes badge in red.
                  // Diese sind hard signals (teleport, time-skip etc).
                  if (
                    Array.isArray(flags.replayFlags) &&
                    flags.replayFlags.length > 0
                  ) {
                    flags.replayFlags.forEach((rf, idx) => {
                      badges.push(
                        <span
                          key={`replay-${idx}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/40 text-red-700 dark:text-red-300 rounded-md text-xs font-medium"
                          title="Verifikation der Replay-Daten hat eine Anomalie erkannt"
                        >
                          <span aria-hidden="true">⚠</span>
                          {rf}
                        </span>,
                      );
                    });
                  }

                  return badges;
                })()}
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

        {/* Track 5 #3 — PIREP-Annotations. Instructor-feedback an
            konkreten frames. Read-only für pilots, read+write für
            approver in der gleichen airline. Replay-link öffnet den
            trail damit der instructor annotations direkt setzen kann.

            canDeleteAll: admins/airline-admins dürfen alle annotations
            löschen (nicht nur eigene) — für moderation. Instructors
            dürfen nur eigene. */}
        <AnnotationList
          pirepId={pirep.id}
          annotations={annotations.map((a) => ({
            ...a,
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
          }))}
          currentUserId={currentUser.id}
          canDeleteAll={
            (currentUser.role?.name === 'admin' ||
              currentUser.role?.name === 'airline-admin') &&
            sameAirline
          }
          hasReplay={hasReplay}
          isApprover={isApprover && sameAirline}
        />

        {/* Track 5 #15 — PIREP Photo Posts. URL-based gallery (kein
            file-upload V1). Jeder authentifizierte airline-member kann
            ein photo posten, max 12 pro PIREP. canDeleteAny: admin/
            airline-admin in derselben airline kann fremde photos
            moderieren (selber pattern wie AnnotationList). */}
        <PhotoGallery
          pirepId={pirep.id}
          currentUserId={currentUser.id}
          canDeleteAny={
            (currentUser.role?.name === 'admin' ||
              currentUser.role?.name === 'airline-admin') &&
            sameAirline
          }
        />

        {/* Track 5 #14 — PIREP Discussion Comments. Free-form thread
            unter dem PIREP. Komplementär zu AnnotationList (approver-
            only frame-bound feedback) — comments sind general-purpose,
            jeder logged-in user kann posten. */}
        <CommentsSection pirepId={pirep.id} currentUserId={currentUser.id} />
      </div>
    </main>
  );
}