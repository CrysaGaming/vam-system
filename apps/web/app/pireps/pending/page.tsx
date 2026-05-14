import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma, Prisma } from '@vam/db';
import Link from 'next/link';
import { isApproverRole } from '@/lib/roles';
import type { PirepFlags } from '@/lib/acars/pirep-flags';

/**
 * Admin/Approver PIREP-Queue mit Flag-Filter + Severity-Sort (option #27).
 *
 * Mirror der pilot-side filter-bar aus option #1 (/pireps), erweitert um
 * eine admin-spezifische severity-sort-toggle. Ohne diese surface war es
 * für admins schwer im FIFO-feed die wirklich auffälligen PIREPs (severe
 * hard-landing, mehrere replay-flags, sim-rate > 4x) zu finden — die
 * sortierten sich genauso wie alle anderen.
 *
 * # Filter (mirror #1)
 *
 * `?flag=all|with|without`. Default 'all' = legacy chronologische queue.
 * 'with'/'without' nutzen denselben OR-clause wie /pireps/page.tsx:
 * structured `flags IS NOT NULL` (option #20) ODER legacy substring-match
 * auf [ACARS-flag / [Replay-flag prefix in remarks. Catches both pre-#20
 * historical PIREPs and post-#20 structured flags.
 *
 * # Severity-Sort (NEW in #27)
 *
 * `?sort=submitted|severity`. Default 'submitted' = ascending submittedAt
 * (fair FIFO queue, älteste warten zuerst, matches existing behaviour).
 * 'severity' = highest-severity-first, computed app-layer from the
 * Pirep.flags JSON. Severe hard-landings / sim-rate ≥ 4x bubble to the
 * top so admins addressing the queue mit "schlimmstes zuerst"-strategy
 * direkt sehen was dringend ist.
 *
 * Why app-layer sort and not raw-SQL: postgres JSONB does support path-
 * indexed access (`flags->>'simRate'`) but encoding the multi-criteria
 * weighted score in SQL gets hairy fast (CASE WHEN nesting for
 * hardLanding.severity, array-length for replayFlags, simRate-tiers).
 * The queue is bounded by airlineId + status='Submitted' which is small
 * (typical < 50 rows), so sorting in JS is trivial. If a VA ever has
 * thousands of pending PIREPs at once, that's an admin-process problem,
 * not a query-perf problem.
 *
 * # Flag-badge column
 *
 * New column on the table shows the highest-severity flag inline so the
 * admin sees per-row what's flagged without opening detail-page. Single
 * badge with the worst issue (severe → hard → replay → simRate → pause).
 * Tooltip on the badge spells out all flags fired.
 *
 * # Why not just expose the existing /pireps filter-bar to admins
 *
 * /pireps shows the pilot's OWN PIREPs (where userId = self). The
 * pending queue shows ALL submitted PIREPs of the airline (where
 * status='Submitted'). Different scope, different audience. The two
 * pages share the filter-mechanic but have separate use-cases.
 */

type FlagFilter = 'all' | 'with' | 'without';
type SortMode = 'submitted' | 'severity';

function parseFlagFilter(raw: string | undefined): FlagFilter {
  if (raw === 'with' || raw === 'without') return raw;
  return 'all';
}

function parseSortMode(raw: string | undefined): SortMode {
  if (raw === 'severity') return 'severity';
  return 'submitted';
}

/**
 * Same OR-clause as /pireps/page.tsx (option #20 two-surface design):
 * structured Pirep.flags column OR legacy [ACARS-flag/[Replay-flag
 * substring in remarks. Either surface signals "flagged".
 */
function buildFlagWhere(filter: FlagFilter): Prisma.PirepWhereInput {
  const ACARS_FLAG_PREFIX = '[ACARS-flag';
  const REPLAY_FLAG_PREFIX = '[Replay-flag';

  if (filter === 'with') {
    return {
      OR: [
        { flags: { not: Prisma.DbNull } },
        { remarks: { contains: ACARS_FLAG_PREFIX } },
        { remarks: { contains: REPLAY_FLAG_PREFIX } },
      ],
    };
  }
  if (filter === 'without') {
    return {
      AND: [
        { flags: { equals: Prisma.DbNull } },
        { NOT: { remarks: { contains: ACARS_FLAG_PREFIX } } },
        { NOT: { remarks: { contains: REPLAY_FLAG_PREFIX } } },
      ],
    };
  }
  return {};
}

/**
 * Compute a numeric severity-score from the structured Pirep.flags JSON.
 *
 * Higher score = more concerning. Admins reviewing the queue with
 * sort=severity see the worst PIREPs first. The scoring is intentionally
 * coarse — exact weights matter less than the partial-order they create:
 *
 *   severe hard-landing > hard hard-landing > replay-flags >
 *   sim-rate > pause-time > clean
 *
 * # Weights
 *
 * - `hardLanding.severity='severe'` (>1000 fpm vsi): 100. The strongest
 *   signal that something went badly wrong — either a crash or
 *   data-corruption worth a manual look.
 * - `hardLanding.severity='hard'` (>600 fpm vsi): 50. Suspicious landing
 *   but not catastrophic; could be a beginner pilot's bad approach.
 * - `replayFlags`: 30 per flag. Multiple replay-heuristics firing
 *   (teleport, supersonic, altitude-jump) compound — three replay-flags
 *   = 90 points = same as borderline severe.
 * - `simRate >= 4x`: 60. Aggressive sim-time-acceleration, high cheat-risk.
 * - `simRate >= 2x`: 40. Mild acceleration, common for cruise-skip.
 * - `simRate > 1.01x`: 20. Below 1.5x, often legitimate (clock-drift).
 * - `pauseSec > 600` (10min+): 20. Long AFK, likely cruise-pause.
 * - `pauseSec > 60`: 10. Brief pause, mild signal.
 *
 * Multi-flag PIREPs accumulate scores. A PIREP with severe hard-landing
 * AND 2 replay-flags gets 100 + 60 = 160 — top of the queue, multiple
 * issues to investigate.
 *
 * Returns 0 for null/undefined flags (clean PIREPs sort last in
 * severity-mode, then by submittedAt as a stable tie-breaker).
 */
function flagSeverityScore(flags: PirepFlags | null | undefined): number {
  if (!flags) return 0;
  let score = 0;

  if (flags.hardLanding?.severity === 'severe') {
    score += 100;
  } else if (flags.hardLanding?.severity === 'hard') {
    score += 50;
  }

  if (flags.replayFlags && flags.replayFlags.length > 0) {
    score += 30 * flags.replayFlags.length;
  }

  if (flags.simRate !== undefined && flags.simRate !== null) {
    if (flags.simRate >= 4) score += 60;
    else if (flags.simRate >= 2) score += 40;
    else if (flags.simRate > 1.01) score += 20;
  }

  if (flags.pauseSec !== undefined && flags.pauseSec !== null) {
    if (flags.pauseSec > 600) score += 20;
    else if (flags.pauseSec > 60) score += 10;
  }

  // Welle C / C1 — timeAccel scoring. Distinct from the legacy simRate
  // above: timeAccel captures historical runs that the latest-value
  // simRate might miss entirely. Peak-rate bands mirror the simRate
  // bands so the two flags are comparable in severity-mode sort.
  if (flags.timeAccel) {
    if (flags.timeAccel.maxRate >= 4) score += 80;
    else if (flags.timeAccel.maxRate >= 2) score += 50;
    else score += 30;
  }

  // Welle C / C2 — positionJumps scoring. Server-derived heuristic, same
  // confidence-tier as replayFlags. Per-jump weight intentionally higher
  // than replayFlags (50 vs 30 for major, 20 for minor) because a
  // position-jump is a concrete distance/time impossibility, not a
  // pattern-match — narrower false-positive surface.
  if (flags.positionJumps && flags.positionJumps.length > 0) {
    for (const j of flags.positionJumps) {
      score += j.severity === 'major' ? 50 : 20;
    }
  }

  // Welle C / C3 — pauseRatio scoring. Ratio above 0.30 is suspicious
  // but ambiguous (could be legitimate AFK over a long flight). Single
  // 30-point band — admins can dismiss as false-positive easily.
  if (flags.pauseRatio !== undefined && flags.pauseRatio !== null) {
    score += 30;
  }

  return score;
}

/**
 * Pick the single most-significant flag-label for the inline badge.
 * Worst-issue-wins so admins see the dominant concern at a glance:
 * severe > hard > replay > simRate > pause. Returns null for clean
 * PIREPs (no badge rendered).
 */
function dominantFlagLabel(flags: PirepFlags | null | undefined): {
  label: string;
  classes: string;
} | null {
  if (!flags) return null;

  // Severe hard-landing trumps everything — always the dominant concern.
  if (flags.hardLanding?.severity === 'severe') {
    return {
      label: 'Severe Landing',
      classes: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    };
  }
  if (flags.hardLanding?.severity === 'hard') {
    return {
      label: 'Hard Landing',
      classes: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    };
  }

  // Welle C / C2 — position-jumps. High-confidence heuristic (concrete
  // distance/time impossibility), placed above replayFlags because the
  // false-positive surface is narrower. Major outranks minor.
  if (flags.positionJumps && flags.positionJumps.length > 0) {
    const majorCount = flags.positionJumps.filter((j) => j.severity === 'major').length;
    if (majorCount > 0) {
      return {
        label: majorCount === 1 ? 'Position jump' : `${majorCount} major jumps`,
        classes: 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30',
      };
    }
    return {
      label: `${flags.positionJumps.length} pos-jumps`,
      classes: 'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30',
    };
  }

  // Welle C / C1 — time-acceleration run-detection. Stronger signal
  // than the legacy simRate snapshot (catches runs even when latest
  // value is back to 1.0), so promoted above the legacy simRate branch.
  if (flags.timeAccel) {
    return {
      label: `Accel ${flags.timeAccel.maxRate.toFixed(1)}x (${flags.timeAccel.maxRunFrames}f)`,
      classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    };
  }

  // Replay-flags next — server-derived heuristic findings.
  if (flags.replayFlags && flags.replayFlags.length > 0) {
    const count = flags.replayFlags.length;
    return {
      label: count === 1 ? 'Replay flag' : `${count} Replay flags`,
      classes: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
    };
  }

  // Sim-rate next — explicit cheat-attempt indicator (latest value).
  if (flags.simRate !== undefined && flags.simRate !== null && flags.simRate > 1.01) {
    return {
      label: `Sim-rate ${flags.simRate.toFixed(1)}x`,
      classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    };
  }

  // Welle C / C3 — pauseRatio. Ratio-based pause-detection. Placed
  // above the legacy pauseSec because it captures a different shape
  // (death-by-thousand-cuts vs single big burst) that admin review
  // should distinguish.
  if (flags.pauseRatio !== undefined && flags.pauseRatio !== null) {
    return {
      label: `Pause ${Math.round(flags.pauseRatio * 100)}%`,
      classes: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
    };
  }

  // Pause-time last — most ambiguous (legitimate AFK vs cruise-skip).
  if (flags.pauseSec !== undefined && flags.pauseSec !== null && flags.pauseSec > 60) {
    const min = Math.round(flags.pauseSec / 60);
    return {
      label: `Paused ${min}min`,
      classes: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30',
    };
  }

  // Flags object exists but no recognised key fired — treat as clean.
  // (Shouldn't happen with current buildPirepFlags() which returns
  // undefined for empty objects, but defensive.)
  return null;
}

/**
 * Build a tooltip-friendly summary of all flags fired. Used as title=
 * on the badge so hover reveals the full picture without opening detail.
 */
function flagsTooltip(flags: PirepFlags | null | undefined): string {
  if (!flags) return '';
  const parts: string[] = [];
  if (flags.hardLanding) {
    const vsi = flags.hardLanding.verticalSpeedFpm;
    parts.push(
      `Hard-landing (${flags.hardLanding.severity}${vsi ? `, ${vsi} fpm` : ''})`,
    );
  }
  if (flags.simRate !== undefined && flags.simRate !== null) {
    parts.push(`Sim-rate ${flags.simRate.toFixed(2)}x`);
  }
  if (flags.timeAccel) {
    // Welle C / C1
    parts.push(
      `Accel-run ${flags.timeAccel.maxRunFrames}f peak ${flags.timeAccel.maxRate.toFixed(1)}x`,
    );
  }
  if (flags.positionJumps && flags.positionJumps.length > 0) {
    // Welle C / C2
    const major = flags.positionJumps.filter((j) => j.severity === 'major').length;
    const minor = flags.positionJumps.length - major;
    const bands: string[] = [];
    if (major > 0) bands.push(`${major} major`);
    if (minor > 0) bands.push(`${minor} minor`);
    parts.push(`Pos-jumps ${flags.positionJumps.length} (${bands.join(', ')})`);
  }
  if (flags.pauseRatio !== undefined && flags.pauseRatio !== null) {
    // Welle C / C3
    parts.push(`Pause-ratio ${Math.round(flags.pauseRatio * 100)}%`);
  }
  if (flags.pauseSec !== undefined && flags.pauseSec !== null) {
    const min = Math.round(flags.pauseSec / 60);
    parts.push(`Paused ${min} min`);
  }
  if (flags.replayFlags && flags.replayFlags.length > 0) {
    parts.push(`Replay: ${flags.replayFlags.join('; ')}`);
  }
  return parts.join(' · ');
}

export default async function PirepsPending({
  searchParams,
}: {
  searchParams: Promise<{ flag?: string; sort?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });

  if (!currentUser) {
    redirect('/');
  }

  // Authorization: nur approver-rollen (admin / airline-admin / instructor).
  // Liste in @/lib/roles.ts. Wenn sich das ändert MUSS auch
  // /pireps/actions.ts assertCanApprove + layout.tsx isApprover folgen.
  if (!isApproverRole(currentUser.role?.name)) {
    redirect('/dashboard');
  }

  if (!currentUser.airlineId) {
    redirect('/dashboard');
  }

  const { flag: flagParam, sort: sortParam } = await searchParams;
  const flagFilter = parseFlagFilter(flagParam);
  const sortMode = parseSortMode(sortParam);

  // Three parallel queries: filtered list (what we render) + the unfiltered
  // total + the flagged-count. The two non-filtered counts feed the
  // filter-bar's count-badges so admins see immediately whether any
  // flagged PIREPs exist without flipping the filter.
  const baseWhere: Prisma.PirepWhereInput = {
    airlineId: currentUser.airlineId,
    status: 'Submitted',
  };

  const [pendingRaw, totalCount, flaggedCount] = await Promise.all([
    prisma.pirep.findMany({
      where: { ...baseWhere, ...buildFlagWhere(flagFilter) },
      include: {
        route: true,
        departure: true,
        arrival: true,
        aircraft: true,
        user: {
          include: { rank: true },
        },
      },
      // FIFO from the DB; severity-sort happens app-layer below if requested.
      // Even in severity-mode we want submittedAt as the tie-breaker, so
      // ordering by submittedAt asc here gives stable secondary-sort for
      // PIREPs with equal scores (they appear oldest-first within their
      // severity-band).
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.pirep.count({ where: baseWhere }),
    prisma.pirep.count({ where: { ...baseWhere, ...buildFlagWhere('with') } }),
  ]);

  const cleanCount = totalCount - flaggedCount;

  // App-layer severity-sort. Postgres JSONB could do this in raw SQL but
  // the queue is small (per-airline pending-PIREPs typically <50) so the
  // overhead is irrelevant and JS keeps the scoring logic in one place
  // (matches the dominantFlagLabel + flagsTooltip helpers that already
  // operate on the parsed JSON).
  const pending = sortMode === 'severity'
    ? [...pendingRaw].sort((a, b) => {
        const sa = flagSeverityScore(a.flags as PirepFlags | null);
        const sb = flagSeverityScore(b.flags as PirepFlags | null);
        // Higher score first; equal scores keep DB-order (submittedAt asc).
        if (sa !== sb) return sb - sa;
        return a.submittedAt.getTime() - b.submittedAt.getTime();
      })
    : pendingRaw;

  // Helper: build href preserving the OTHER param. Filter-bar links
  // change `flag` but keep `sort`; sort-toggle changes `sort` but keeps
  // `flag`. URL stays clean — null/'all'/'submitted' values are stripped
  // so the default URL is bare /pireps/pending.
  const buildHref = (next: { flag?: FlagFilter; sort?: SortMode }) => {
    const params = new URLSearchParams();
    const f = next.flag ?? flagFilter;
    const s = next.sort ?? sortMode;
    if (f !== 'all') params.set('flag', f);
    if (s !== 'submitted') params.set('sort', s);
    const qs = params.toString();
    return qs ? `/pireps/pending?${qs}` : '/pireps/pending';
  };

  const filterButtons: { value: FlagFilter; label: string; count: number }[] = [
    { value: 'all', label: 'Alle', count: totalCount },
    { value: 'with', label: 'Mit Flag', count: flaggedCount },
    { value: 'without', label: 'Ohne Flag', count: cleanCount },
  ];

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">PIREPs zur Prüfung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {totalCount === 0
                ? 'Keine PIREPs warten aktuell auf Prüfung'
                : flagFilter === 'all'
                  ? `${pending.length} ${pending.length === 1 ? 'PIREP wartet' : 'PIREPs warten'} auf Prüfung`
                  : `${pending.length} von ${totalCount} angezeigt · gefiltert`}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
            <Link
              href="/pireps"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              Meine PIREPs
            </Link>
          </div>
        </header>

        {/* Filter + Sort bar — only visible when there's at least one PIREP.
            Hides on empty-state to avoid showing "Mit Flag (0)" tabs next
            to the "alles geprüft"-checkmark. */}
        {totalCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-6">
            {/* Flag-filter segmented control. Mirror der pilot-side aus #1. */}
            <div role="tablist" aria-label="PIREP-Flag-Filter" className="flex gap-2">
              {filterButtons.map((btn) => {
                const isActive = flagFilter === btn.value;
                return (
                  <Link
                    key={btn.value}
                    href={buildHref({ flag: btn.value })}
                    role="tab"
                    aria-selected={isActive}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition border ${
                      isActive
                        ? 'bg-indigo-600 hover:bg-indigo-700 border-indigo-600 text-white'
                        : 'bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {btn.label}
                    <span
                      className={`ml-2 text-xs ${isActive ? 'text-indigo-200' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      ({btn.count})
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Sort-toggle. FIFO (default) vs Severity. Visually subordinate
                to the filter-bar — admins typically pick a filter first,
                then optionally re-sort. */}
            <div className="flex items-center gap-2 ml-auto text-sm">
              <span className="text-gray-500 dark:text-gray-400">Sort:</span>
              <Link
                href={buildHref({ sort: 'submitted' })}
                className={`px-3 py-1.5 rounded text-xs font-medium transition border ${
                  sortMode === 'submitted'
                    ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'
                    : 'bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                }`}
                title="Älteste zuerst (FIFO — fair queue)"
              >
                ⏱ FIFO
              </Link>
              <Link
                href={buildHref({ sort: 'severity' })}
                className={`px-3 py-1.5 rounded text-xs font-medium transition border ${
                  sortMode === 'severity'
                    ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'
                    : 'bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                }`}
                title="Schlimmstes zuerst (severe hard-landings, hohe sim-rates, replay-flags)"
              >
                🚩 Schlimmstes zuerst
              </Link>
            </div>
          </div>
        )}

        {pending.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            {totalCount === 0 ? (
              <>
                <p className="text-5xl mb-4">✅</p>
                <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
                  Alle PIREPs sind geprüft.
                </p>
                <p className="text-gray-500 text-sm">
                  Wenn neue Berichte eingereicht werden, erscheinen sie hier.
                </p>
              </>
            ) : flagFilter === 'with' ? (
              <>
                <p className="text-5xl mb-4">🟢</p>
                <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
                  Keine geflaggten PIREPs in der Queue.
                </p>
                <p className="text-gray-500 text-sm mb-4">
                  Alle wartenden PIREPs wurden sauber übermittelt.
                </p>
                <Link
                  href={buildHref({ flag: 'all' })}
                  className="inline-block px-5 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                >
                  ← Alle anzeigen
                </Link>
              </>
            ) : (
              <>
                <p className="text-5xl mb-4">🚩</p>
                <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
                  Alle wartenden PIREPs haben Flags.
                </p>
                <p className="text-gray-500 text-sm mb-4">
                  Es gibt keine clean-pirep ohne Flag in der queue.
                </p>
                <Link
                  href={buildHref({ flag: 'all' })}
                  className="inline-block px-5 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
                >
                  ← Alle anzeigen
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Pilot</th>
                  <th className="px-4 py-3">Flug</th>
                  <th className="px-4 py-3">Strecke</th>
                  <th className="px-4 py-3">Aircraft</th>
                  <th className="px-4 py-3 text-right">Dauer</th>
                  <th className="px-4 py-3">Flag</th>
                  <th className="px-4 py-3 text-right">Eingereicht</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pending.map((p) => {
                  // Cast Pirep.flags (Prisma JsonValue) to our app-layer
                  // PirepFlags type. Prisma's JSON column is unstructured at
                  // the DB level — the cast is asserting our convention.
                  // Defensive helpers handle null/missing keys gracefully.
                  const flags = p.flags as PirepFlags | null;
                  const flagBadge = dominantFlagLabel(flags);
                  const tooltip = flagBadge ? flagsTooltip(flags) : '';
                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition group cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/pireps/${p.id}`} className="block">
                          <p className="font-semibold">{p.user.name ?? '—'}</p>
                          <p className="text-xs text-gray-500">
                            {p.user.rank?.name ?? '—'}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold">
                        <Link
                          href={`/pireps/${p.id}`}
                          className="block text-indigo-600 dark:text-indigo-400"
                        >
                          {p.route?.flightNumber ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        <Link href={`/pireps/${p.id}`} className="block">
                          {p.departure.icao} → {p.arrival.icao}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        <Link href={`/pireps/${p.id}`} className="block">
                          {p.aircraft?.registration ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/pireps/${p.id}`} className="block">
                          {p.flightTimeMin
                            ? `${Math.floor(p.flightTimeMin / 60)}h ${p.flightTimeMin % 60}min`
                            : '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/pireps/${p.id}`} className="block">
                          {flagBadge ? (
                            <span
                              title={tooltip}
                              className={`inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider rounded font-semibold border ${flagBadge.classes}`}
                            >
                              {flagBadge.label}
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600 text-xs">
                              —
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                        <Link href={`/pireps/${p.id}`} className="block">
                          {new Date(p.submittedAt).toLocaleString('de-DE', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
