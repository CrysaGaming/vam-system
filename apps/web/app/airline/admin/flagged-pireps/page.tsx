import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma, Prisma } from '@vam/db';
import Link from 'next/link';
import { isApproverRole } from '@/lib/roles';
import type { PirepFlags } from '@/lib/acars/pirep-flags';
import { PirepInlineActions } from './_components/inline-actions';

/**
 * Admin Anti-Cheat Review Queue — Welle C / C4.
 *
 * Focused per-flag detail view of PIREPs with anti-cheat flags fired.
 * Complements (does not replace) the broader /pireps/pending queue,
 * which is the general approver workflow with optional flag-filter.
 *
 * # Why a separate page vs filter on /pireps/pending
 *
 * /pireps/pending is row-list-shaped: each row is a single line with a
 * dominant-flag badge. Admins working that queue see WHAT is flagged
 * but have to click through to each PIREP detail page to see WHY (the
 * specific values, the position-jump distances, the time-acceleration
 * peak rate). For a queue of 20 flagged PIREPs that's 20 round-trips.
 *
 * This page renders each flagged PIREP as a self-contained card with:
 *
 *   - Pilot + flight identity in the header
 *   - Every flag bucket rendered inline with its specific values
 *     (severity, distance, rate, ratio, etc.)
 *   - Inline approve/reject form so the admin can dispose of clean-
 *     case false-positives without leaving the page
 *   - Link to /pireps/[id] for the full PIREP context (replay,
 *     remarks, comments) when deeper inspection is needed
 *
 * Filters down to structured flags only (Pirep.flags IS NOT NULL).
 * Legacy substring-match in remarks is OUT-OF-SCOPE here — pre-#20
 * historical PIREPs without structured flags don't have the per-flag
 * detail this page is designed to render, so they'd just show as empty
 * cards. Those still surface in /pireps/pending?flag=with where the
 * dominant-flag badge can be derived from the remarks-prefix.
 *
 * # Scope guards
 *
 * - airlineId-scoped — admins only see their own airline's PIREPs.
 *   Same scope as /pireps/pending.
 * - status='Submitted' only — Draft PIREPs are pilot-private until
 *   submitted, and approved/rejected PIREPs are out of the active
 *   review queue. (If we ever want a "historical flagged PIREPs"
 *   audit view, that's a separate URL.)
 * - structured flags only (flags IS NOT NULL) — see above.
 *
 * # Audit trail
 *
 * The existing approve/reject actions (apps/web/app/pireps/actions.ts)
 * already record approvedById + approvedAt + rejectionReason on the
 * PIREP row. That's the audit trail required by the roadmap spec.
 * No additional review-history table needed at v1 — the existing
 * surface is sufficient. If we later need per-flag dispositions (this
 * PIREP was rejected for the position-jumps specifically, not the
 * sim-rate), that's a follow-up table addition (PirepFlagReview).
 */

/**
 * Sort modes: severity-first (default — worst flags up top) or
 * chronological (FIFO — oldest waiting first). Same semantics as
 * /pireps/pending but the default flips here: this page is
 * explicitly the worst-first triage queue.
 */
type SortMode = 'severity' | 'submitted';

function parseSortMode(raw: string | undefined): SortMode {
  if (raw === 'submitted') return 'submitted';
  return 'severity';
}

/**
 * Severity-score for sort-mode='severity'. Mirrors the scoring in
 * /pireps/pending/page.tsx — keep them in sync. If you change one,
 * change the other. (We could DRY this into a shared helper later;
 * for now the duplication is small enough and the two pages have
 * slightly different presentation needs that may diverge.)
 */
function flagSeverityScore(flags: PirepFlags | null | undefined): number {
  if (!flags) return 0;
  let score = 0;
  if (flags.hardLanding?.severity === 'severe') score += 100;
  else if (flags.hardLanding?.severity === 'hard') score += 50;
  if (flags.replayFlags && flags.replayFlags.length > 0)
    score += 30 * flags.replayFlags.length;
  if (flags.simRate !== undefined && flags.simRate !== null) {
    if (flags.simRate >= 4) score += 60;
    else if (flags.simRate >= 2) score += 40;
    else if (flags.simRate > 1.01) score += 20;
  }
  if (flags.pauseSec !== undefined && flags.pauseSec !== null) {
    if (flags.pauseSec > 600) score += 20;
    else if (flags.pauseSec > 60) score += 10;
  }
  if (flags.timeAccel) {
    if (flags.timeAccel.maxRate >= 4) score += 80;
    else if (flags.timeAccel.maxRate >= 2) score += 50;
    else score += 30;
  }
  if (flags.positionJumps && flags.positionJumps.length > 0) {
    for (const j of flags.positionJumps) {
      score += j.severity === 'major' ? 50 : 20;
    }
  }
  if (flags.pauseRatio !== undefined && flags.pauseRatio !== null) score += 30;
  return score;
}

export default async function FlaggedPirepsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!currentUser) redirect('/');
  if (!isApproverRole(currentUser.role?.name)) redirect('/dashboard');
  if (!currentUser.airlineId) redirect('/dashboard');

  const { sort: sortParam } = await searchParams;
  const sortMode = parseSortMode(sortParam);

  const flaggedRaw = await prisma.pirep.findMany({
    where: {
      airlineId: currentUser.airlineId,
      status: 'Submitted',
      // Structured-flags-only filter. Legacy remarks-prefix flags
      // (pre-#20 historical PIREPs) are excluded — they don't have
      // the per-flag detail this page renders. See file docstring.
      flags: { not: Prisma.DbNull },
    },
    include: {
      route: true,
      departure: true,
      arrival: true,
      aircraft: true,
      user: { include: { rank: true } },
    },
    orderBy: { submittedAt: 'asc' },
  });

  const flagged =
    sortMode === 'severity'
      ? [...flaggedRaw].sort((a, b) => {
          const sa = flagSeverityScore(a.flags as PirepFlags | null);
          const sb = flagSeverityScore(b.flags as PirepFlags | null);
          if (sa !== sb) return sb - sa;
          return a.submittedAt.getTime() - b.submittedAt.getTime();
        })
      : flaggedRaw;

  const buildHref = (next: { sort?: SortMode }) => {
    const params = new URLSearchParams();
    const s = next.sort ?? sortMode;
    // 'severity' is the default — only set when explicitly other.
    if (s !== 'severity') params.set('sort', s);
    const qs = params.toString();
    return qs ? `/airline/admin/flagged-pireps?${qs}` : '/airline/admin/flagged-pireps';
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-wrap justify-between items-center gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <span>🛡️</span> Anti-Cheat Review
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {flagged.length === 0
                ? 'Keine geflaggten PIREPs in der Queue'
                : `${flagged.length} ${flagged.length === 1 ? 'PIREP' : 'PIREPs'} mit Anti-Cheat-Flags`}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            {flagged.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 dark:text-gray-400">Sort:</span>
                <Link
                  href={buildHref({ sort: 'severity' })}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition border ${
                    sortMode === 'severity'
                      ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'
                      : 'bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                  }`}
                  title="Schlimmstes zuerst (Standard)"
                >
                  🚩 Schlimmstes zuerst
                </Link>
                <Link
                  href={buildHref({ sort: 'submitted' })}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition border ${
                    sortMode === 'submitted'
                      ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'
                      : 'bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800 border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                  }`}
                  title="Älteste zuerst (FIFO)"
                >
                  ⏱ FIFO
                </Link>
              </div>
            )}
            <Link
              href="/pireps/pending"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              Alle PIREPs
            </Link>
            <Link
              href="/dashboard"
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        {flagged.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-12 text-center">
            <p className="text-5xl mb-4">🟢</p>
            <p className="text-gray-700 dark:text-gray-300 font-semibold mb-2">
              Keine geflaggten PIREPs in der Queue.
            </p>
            <p className="text-gray-500 text-sm">
              Wenn neue PIREPs mit Anti-Cheat-Flags eingereicht werden, erscheinen sie hier.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {flagged.map((p) => {
              const flags = p.flags as PirepFlags | null;
              const score = flagSeverityScore(flags);
              return (
                <PirepFlagCard key={p.id} pirep={p} flags={flags} score={score} />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Single PIREP card — header with identity, flag-buckets rendered
 * inline, and inline approve/reject form at the bottom.
 *
 * Kept as a local component (not split to _components/) because it's
 * tightly coupled to the page's PirepFlags rendering decisions and
 * not reused elsewhere. The inline-actions form IS split out because
 * it needs 'use client' for the confirmation prompt + form state.
 */
function PirepFlagCard({
  pirep,
  flags,
  score,
}: {
  pirep: {
    id: string;
    flightTimeMin: number | null;
    submittedAt: Date;
    departure: { icao: string };
    arrival: { icao: string };
    route: { flightNumber: string } | null;
    aircraft: { registration: string } | null;
    user: { name: string | null; rank: { name: string } | null };
  };
  flags: PirepFlags | null;
  score: number;
}) {
  const flightNumber = pirep.route?.flightNumber ?? '—';
  const dur =
    pirep.flightTimeMin !== null
      ? `${Math.floor(pirep.flightTimeMin / 60)}h ${pirep.flightTimeMin % 60}min`
      : '—';

  return (
    <article className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
      {/* Card header — pilot identity + flight identity + severity score */}
      <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-base">
              {pirep.user.name ?? '—'}
              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-normal">
                {pirep.user.rank?.name ?? ''}
              </span>
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {flightNumber}
              </span>
              <span className="ml-2">
                {pirep.departure.icao} → {pirep.arrival.icao}
              </span>
              <span className="ml-2 text-gray-500 dark:text-gray-400">
                · {pirep.aircraft?.registration ?? '—'} · {dur}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {/* Severity score — opaque number for sort-debugging but useful
                for admins to see at a glance how concerning the cluster is.
                Color bucket: 100+ = red (severe), 50-99 = orange, <50 = amber. */}
            <span
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded font-bold border ${
                score >= 100
                  ? 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30'
                  : score >= 50
                    ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
              }`}
              title="Aggregated severity score across all fired flags"
            >
              Score {score}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {new Date(pirep.submittedAt).toLocaleString('de-DE', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
          </div>
        </div>
      </header>

      {/* Flag buckets — one per fired flag-type with its specific values */}
      <section className="px-5 py-4 space-y-3">
        <FlagBuckets flags={flags} />
      </section>

      {/* Action row — link to full detail + inline approve/reject */}
      <footer className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/pireps/${pirep.id}`}
          className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium"
        >
          → Vollständige PIREP-Detail-Seite (Replay, Remarks, Telemetrie)
        </Link>
        <PirepInlineActions pirepId={pirep.id} />
      </footer>
    </article>
  );
}

/**
 * Renders one block per fired flag-type. Each block is a small
 * coloured banner with the flag's specific values formatted for
 * human reading. Cleaner than a single big blob — the admin can
 * scan-eye each flag-type independently.
 */
function FlagBuckets({ flags }: { flags: PirepFlags | null }) {
  if (!flags) return null;
  const blocks: React.ReactNode[] = [];

  if (flags.hardLanding) {
    const vsi = flags.hardLanding.verticalSpeedFpm;
    blocks.push(
      <FlagRow
        key="hardLanding"
        emoji="💥"
        label={`Hard Landing — ${flags.hardLanding.severity}`}
        detail={vsi !== undefined ? `Touchdown VSI: ${vsi} fpm` : 'Severity captured, exact VSI not recorded'}
        tone={flags.hardLanding.severity === 'severe' ? 'red' : 'orange'}
      />,
    );
  }

  if (flags.timeAccel) {
    // Welle C / C1
    blocks.push(
      <FlagRow
        key="timeAccel"
        emoji="⏱"
        label="Time-Acceleration Detected"
        detail={`${flags.timeAccel.maxRunFrames} consecutive frames above 1.0× sim-rate · peak ${flags.timeAccel.maxRate.toFixed(1)}×`}
        tone="amber"
      />,
    );
  }

  if (flags.simRate !== undefined && flags.simRate !== null) {
    // Legacy single-value snapshot
    blocks.push(
      <FlagRow
        key="simRate"
        emoji="⚡"
        label="Sim-Rate at Block-On"
        detail={`${flags.simRate.toFixed(2)}× — last reported value when PIREP filed`}
        tone="amber"
      />,
    );
  }

  if (flags.positionJumps && flags.positionJumps.length > 0) {
    // Welle C / C2
    const major = flags.positionJumps.filter((j) => j.severity === 'major').length;
    const minor = flags.positionJumps.length - major;
    blocks.push(
      <div
        key="positionJumps"
        className="px-3 py-2 rounded border bg-pink-500/10 border-pink-500/30 text-sm"
      >
        <p className="font-semibold flex items-center gap-2">
          <span>📍</span> Position-Jumps ({flags.positionJumps.length})
          <span className="text-xs font-normal text-pink-700 dark:text-pink-300">
            {major > 0 && `${major} major`}
            {major > 0 && minor > 0 && ', '}
            {minor > 0 && `${minor} minor`}
          </span>
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-gray-600 dark:text-gray-400 font-mono">
          {flags.positionJumps.slice(0, 5).map((j, i) => (
            <li key={i}>
              {new Date(j.atIso).toLocaleTimeString('de-DE')} — {j.distanceNm}nm covered (expected {j.expectedNm}nm in {j.elapsedSec}s) ·{' '}
              <span className={j.severity === 'major' ? 'text-pink-700 dark:text-pink-300 font-semibold' : 'text-pink-600 dark:text-pink-400'}>
                {j.severity}
              </span>
            </li>
          ))}
          {flags.positionJumps.length > 5 && (
            <li className="italic text-gray-500">
              … and {flags.positionJumps.length - 5} more (see full PIREP detail)
            </li>
          )}
        </ul>
      </div>,
    );
  }

  if (flags.pauseRatio !== undefined && flags.pauseRatio !== null) {
    // Welle C / C3
    blocks.push(
      <FlagRow
        key="pauseRatio"
        emoji="⏸"
        label="Pause-Ratio Exceeded"
        detail={`${Math.round(flags.pauseRatio * 100)}% of flight time spent paused (threshold: 30%)`}
        tone="yellow"
      />,
    );
  }

  if (flags.pauseSec !== undefined && flags.pauseSec !== null) {
    // Legacy single-burst pause
    const min = Math.round(flags.pauseSec / 60);
    blocks.push(
      <FlagRow
        key="pauseSec"
        emoji="⏸"
        label="Long Pause Recorded"
        detail={`${flags.pauseSec}s (${min} min) — single-burst pause duration`}
        tone="yellow"
      />,
    );
  }

  if (flags.replayFlags && flags.replayFlags.length > 0) {
    blocks.push(
      <div
        key="replayFlags"
        className="px-3 py-2 rounded border bg-purple-500/10 border-purple-500/30 text-sm"
      >
        <p className="font-semibold flex items-center gap-2">
          <span>🔁</span> Replay Heuristics ({flags.replayFlags.length})
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-gray-600 dark:text-gray-400 font-mono">
          {flags.replayFlags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      </div>,
    );
  }

  if (blocks.length === 0) {
    // Defensive: flags object exists but no recognised key fired.
    // Shouldn't happen post-buildPirepFlags-undefined-return, but
    // explicit fallback keeps the card from being empty.
    return (
      <p className="text-sm text-gray-500 italic">
        Flag-Objekt vorhanden aber kein erkannter Flag-Typ. Vermutlich Schema-Drift —
        bitte Detail-Seite prüfen.
      </p>
    );
  }

  return <>{blocks}</>;
}

/**
 * Single-line flag block. Used by the simpler flag types (timeAccel,
 * simRate, pauseRatio, pauseSec, hardLanding). The complex types
 * (positionJumps, replayFlags) need a multi-line list and render
 * their own block inline.
 */
function FlagRow({
  emoji,
  label,
  detail,
  tone,
}: {
  emoji: string;
  label: string;
  detail: string;
  tone: 'red' | 'orange' | 'amber' | 'yellow' | 'purple' | 'pink';
}) {
  // Tone → classes mapping. Hard-coded rather than dynamic-string-
  // concatenation so Tailwind v4's auto-detection sees the literal
  // class-names and doesn't tree-shake them out of the build.
  const toneClasses: Record<typeof tone, string> = {
    red: 'bg-red-500/10 border-red-500/30',
    orange: 'bg-orange-500/10 border-orange-500/30',
    amber: 'bg-amber-500/10 border-amber-500/30',
    yellow: 'bg-yellow-500/10 border-yellow-500/30',
    purple: 'bg-purple-500/10 border-purple-500/30',
    pink: 'bg-pink-500/10 border-pink-500/30',
  };
  return (
    <div className={`px-3 py-2 rounded border text-sm ${toneClasses[tone]}`}>
      <p className="font-semibold flex items-center gap-2">
        <span>{emoji}</span> {label}
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{detail}</p>
    </div>
  );
}
