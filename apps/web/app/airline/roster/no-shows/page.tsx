import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import { findNoShowCandidates, getPilotNoShowStats } from '@/lib/roster/no-show-detection';
import Link from 'next/link';
import { NoShowReviewClient } from './no-show-review-client';

/**
 * Track 5 #30 (Section F) — /airline/roster/no-shows
 *
 * Admin review-queue für no-show kandidaten. Server-component data-
 * loader; admin-interaction läuft im NoShowReviewClient.
 *
 * # Layout
 *
 * Top: stats-bar (gesamt-pending, breakdown by confidence-level)
 * Mid: bulk-action-toolbar (select-all per confidence-tier, mark/dismiss buttons)
 * Bottom: scrollable list von candidates mit per-row actions
 *
 * # Confidence-tiers
 *
 *   - high (>48h overdue) — orange-rote akzentfarbe, top der liste
 *   - medium (12h-48h) — gelbe akzentfarbe
 *   - low (4h-12h) — gray, könnte legitim late-PIREP sein
 *
 * Admin kann pro-row reagieren ODER mit "select all high" + bulk-mark
 * den klaren-cases-stack abarbeiten. Die "dismiss" action (= "doch
 * kein no-show, setze auf COMPLETED") ist auch single-row available.
 */
export default async function NoShowsPage() {
  const user = await requireAirlineManagerWithAirlinePage();

  const candidates = await findNoShowCandidates({
    airlineId: user.airlineId,
    graceHours: 4,
    limit: 200,
  });

  // Pilot-stats für reliability-context. Nur für pilots die in der liste
  // auftauchen — saves doing it für alle pilots der airline.
  const pilotIds = Array.from(new Set(candidates.map((c) => c.pilotId)));
  const stats = await getPilotNoShowStats({
    airlineId: user.airlineId,
    pilotIds,
  });

  // Counts by confidence
  const counts = {
    high: candidates.filter((c) => c.confidence === 'high').length,
    medium: candidates.filter((c) => c.confidence === 'medium').length,
    low: candidates.filter((c) => c.confidence === 'low').length,
  };

  // Convert Map → plain object for client serialization
  const statsObj: Record<
    string,
    { totalNoShows: number; reliabilityPct: number | null }
  > = {};
  for (const [pid, s] of stats.entries()) {
    statsObj[pid] = {
      totalNoShows: s.totalNoShows,
      reliabilityPct: s.reliabilityPct,
    };
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="text-sm text-muted-foreground">
          <Link href="/airline/roster" className="hover:text-foreground hover:underline">
            Roster
          </Link>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <span>No-Shows</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">⚠️ No-Show Review</h1>
        <p className="text-sm text-muted-foreground">
          Roster-Assignments deren geplante Ankunftszeit vor mehr als 4 Stunden
          war und für die kein PIREP eingereicht wurde. Markiere als No-Show
          oder weise zurück, falls die PIREP einfach vergessen wurde.
        </p>
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Insgesamt"
          value={candidates.length}
          tone="default"
        />
        <StatCard
          label="High Confidence"
          value={counts.high}
          tone="red"
          hint=">48h"
        />
        <StatCard
          label="Medium"
          value={counts.medium}
          tone="amber"
          hint="12-48h"
        />
        <StatCard label="Low" value={counts.low} tone="gray" hint="4-12h" />
      </div>

      {candidates.length === 0 ? (
        <EmptyState />
      ) : (
        <NoShowReviewClient
          candidates={candidates.map((c) => ({
            assignmentId: c.assignmentId,
            pilotId: c.pilotId,
            pilotName: c.pilotName,
            pilotImage: c.pilotImage,
            rankName: c.rankName,
            currentStatus: c.currentStatus,
            flightNumber: c.flightNumber,
            depIcao: c.depIcao,
            arrIcao: c.arrIcao,
            departureTime: c.departureTime.toISOString(),
            estimatedMinutes: c.estimatedMinutes,
            aircraftTypeIcao: c.aircraftTypeIcao,
            hoursOverdue: c.hoursOverdue,
            confidence: c.confidence,
            note: c.note,
          }))}
          pilotStats={statsObj}
        />
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: 'default' | 'red' | 'amber' | 'gray';
  hint?: string;
}) {
  const toneClass =
    tone === 'red'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'amber'
        ? 'text-amber-700 dark:text-amber-400'
        : tone === 'gray'
          ? 'text-gray-500'
          : 'text-foreground';
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-emerald-300 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10 p-12 text-center text-emerald-700 dark:text-emerald-400">
      <div className="text-4xl mb-2" aria-hidden="true">✅</div>
      <p className="text-sm font-medium">
        Keine offenen No-Show-Kandidaten — alle Roster-Assignments sind sauber.
      </p>
      <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-2">
        Jede Assignment ist entweder noch in der Zeit oder hat einen PIREP.
      </p>
    </div>
  );
}
