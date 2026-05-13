'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  markAssignmentsAsNoShow,
  dismissNoShowCandidate,
  type NoShowActionResult,
} from './actions';

/**
 * Track 5 #30 — No-Show review client component.
 *
 * # Workflow
 *
 *   1. Admin sieht list von kandidaten, default keine ausgewählt.
 *   2. Selection via checkbox pro row, oder "select-all-confidence-tier"
 *      buttons (alle high / alle medium / alle low).
 *   3. Bulk-toolbar zeigt count + actions: mark all + dismiss all.
 *   4. Per-row inline actions für single-decisions (mark / dismiss).
 *
 * # Why no inline reason-input?
 *
 * Reason ist optional und audit-only. Im MVP halten wir UI clean: bulk
 * actions ohne reason, single-row hat einen inline expand-state für
 * optional reason-text + confirm. Pflicht-felder würden den
 * "select-30-clear-cases + ein klick" flow zerstören.
 */

type Candidate = {
  assignmentId: string;
  pilotId: string;
  pilotName: string | null;
  pilotImage: string | null;
  rankName: string | null;
  currentStatus: 'ASSIGNED' | 'ACCEPTED';
  flightNumber: string;
  depIcao: string;
  arrIcao: string;
  departureTime: string;
  estimatedMinutes: number;
  aircraftTypeIcao: string | null;
  hoursOverdue: number;
  confidence: 'low' | 'medium' | 'high';
  note: string | null;
};

type PilotStats = Record<
  string,
  { totalNoShows: number; reliabilityPct: number | null }
>;

type Props = {
  candidates: Candidate[];
  pilotStats: PilotStats;
};

export function NoShowReviewClient({ candidates, pilotStats }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<NoShowActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOfConfidence(level: 'high' | 'medium' | 'low' | 'all') {
    setSelected((prev) => {
      const next = new Set(prev);
      const targets =
        level === 'all'
          ? candidates
          : candidates.filter((c) => c.confidence === level);
      // If all already selected → unselect, sonst select alle
      const allSelected = targets.every((t) => next.has(t.assignmentId));
      if (allSelected) {
        for (const t of targets) next.delete(t.assignmentId);
      } else {
        for (const t of targets) next.add(t.assignmentId);
      }
      return next;
    });
  }

  function bulkMark() {
    if (selected.size === 0) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await markAssignmentsAsNoShow({
        assignmentIds: Array.from(selected),
      });
      setResult(res);
      if (!res.ok) {
        setError(res.error ?? 'Bulk-Mark fehlgeschlagen.');
        return;
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  function singleDismiss(assignmentId: string) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await dismissNoShowCandidate({ assignmentId });
      setResult(res);
      if (!res.ok) {
        setError(res.error ?? 'Dismiss fehlgeschlagen.');
        return;
      }
      router.refresh();
    });
  }

  // Group by confidence for visual sectioning
  const grouped = useMemo(() => {
    return {
      high: candidates.filter((c) => c.confidence === 'high'),
      medium: candidates.filter((c) => c.confidence === 'medium'),
      low: candidates.filter((c) => c.confidence === 'low'),
    };
  }, [candidates]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDt = (iso: string) => {
    const d = new Date(iso);
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Bulk toolbar (sticky) */}
      <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">
          {selected.size > 0
            ? `${selected.size} ausgewählt`
            : 'Auswahl per Checkbox oder:'}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => selectAllOfConfidence('high')}
            className="px-2.5 py-1 rounded-md text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition"
          >
            Alle High ({grouped.high.length})
          </button>
          <button
            type="button"
            onClick={() => selectAllOfConfidence('medium')}
            className="px-2.5 py-1 rounded-md text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition"
          >
            Alle Medium ({grouped.medium.length})
          </button>
          <button
            type="button"
            onClick={() => selectAllOfConfidence('low')}
            className="px-2.5 py-1 rounded-md text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
          >
            Alle Low ({grouped.low.length})
          </button>
          <button
            type="button"
            onClick={() => selectAllOfConfidence('all')}
            className="px-2.5 py-1 rounded-md text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition"
          >
            Toggle alle
          </button>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          disabled={isPending || selected.size === 0}
          onClick={bulkMark}
          className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? '…' : `⚠️ Als No-Show markieren (${selected.size})`}
        </button>
      </div>

      {/* Result + error display */}
      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {result && result.ok && (result.marked ?? 0) > 0 && (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          ✅ {result.marked} als No-Show markiert
          {result.pushSent !== undefined && result.pushSent > 0 && (
            <> · 📱 {result.pushSent} Piloten benachrichtigt</>
          )}
          {result.skipped && result.skipped.length > 0 && (
            <> · ⚠️ {result.skipped.length} übersprungen</>
          )}
        </div>
      )}

      {/* Sections by confidence */}
      {(['high', 'medium', 'low'] as const).map((level) => {
        const items = grouped[level];
        if (items.length === 0) return null;
        const tier = TIER_STYLES[level];
        return (
          <section key={level}>
            <h2 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${tier.headerClass}`}>
              {tier.label} ({items.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {items.map((c) => (
                <CandidateRow
                  key={c.assignmentId}
                  candidate={c}
                  pilotStat={pilotStats[c.pilotId] ?? { totalNoShows: 0, reliabilityPct: null }}
                  selected={selected.has(c.assignmentId)}
                  onToggleSelect={() => toggleSelect(c.assignmentId)}
                  onDismiss={() => singleDismiss(c.assignmentId)}
                  formatDt={formatDt}
                  tierClass={tier.rowClass}
                  isPending={isPending}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const TIER_STYLES = {
  high: {
    label: '🔴 High Confidence (>48h)',
    headerClass: 'text-red-700 dark:text-red-400',
    rowClass: 'border-red-200 dark:border-red-800/40 bg-red-50/30 dark:bg-red-900/5',
  },
  medium: {
    label: '🟡 Medium Confidence (12-48h)',
    headerClass: 'text-amber-700 dark:text-amber-400',
    rowClass: 'border-amber-200 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-900/5',
  },
  low: {
    label: '⚪ Low Confidence (4-12h)',
    headerClass: 'text-gray-500',
    rowClass: 'border-gray-200 dark:border-gray-800',
  },
} as const;

function CandidateRow({
  candidate,
  pilotStat,
  selected,
  onToggleSelect,
  onDismiss,
  formatDt,
  tierClass,
  isPending,
}: {
  candidate: Candidate;
  pilotStat: { totalNoShows: number; reliabilityPct: number | null };
  selected: boolean;
  onToggleSelect: () => void;
  onDismiss: () => void;
  formatDt: (iso: string) => string;
  tierClass: string;
  isPending: boolean;
}) {
  return (
    <li className={`rounded-lg border p-3 ${tierClass}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 accent-red-600"
        />
        <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {/* Pilot info */}
          <div className="min-w-[12rem]">
            <Link
              href={`/p/${candidate.pilotId}`}
              className="text-sm font-medium hover:underline"
            >
              {candidate.pilotName ?? '—'}
            </Link>
            <div className="text-xs text-muted-foreground">
              {candidate.rankName ?? 'Kein Rang'}
              {pilotStat.totalNoShows > 0 && (
                <>
                  {' · '}
                  <span className="text-red-700 dark:text-red-400 font-medium">
                    {pilotStat.totalNoShows} prev. No-Show{pilotStat.totalNoShows === 1 ? '' : 's'}
                  </span>
                </>
              )}
              {pilotStat.reliabilityPct !== null && (
                <>
                  {' · '}
                  <span
                    className={
                      pilotStat.reliabilityPct >= 90
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : pilotStat.reliabilityPct >= 70
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-700 dark:text-red-400'
                    }
                  >
                    {pilotStat.reliabilityPct}% reliable
                  </span>
                </>
              )}
            </div>
          </div>
          {/* Flight info */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-medium text-indigo-700 dark:text-indigo-400">
              {candidate.flightNumber}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {candidate.depIcao} → {candidate.arrIcao}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatDt(candidate.departureTime)}
            </span>
            {candidate.aircraftTypeIcao && (
              <span className="text-xs text-gray-500">
                ({candidate.aircraftTypeIcao})
              </span>
            )}
          </div>
          {/* Overdue badge */}
          <div className="text-xs text-muted-foreground">
            <span
              className={
                candidate.confidence === 'high'
                  ? 'text-red-700 dark:text-red-400 font-medium'
                  : candidate.confidence === 'medium'
                    ? 'text-amber-700 dark:text-amber-400'
                    : ''
              }
            >
              {candidate.hoursOverdue < 24
                ? `${Math.round(candidate.hoursOverdue)}h überfällig`
                : `${Math.round(candidate.hoursOverdue / 24)}d überfällig`}
            </span>
            {candidate.note && (
              <div className="mt-1 italic">„{candidate.note}"</div>
            )}
          </div>
        </div>
        {/* Single-row actions */}
        <button
          type="button"
          disabled={isPending}
          onClick={onDismiss}
          title="Doch kein No-Show — als COMPLETED markieren"
          className="shrink-0 px-2.5 py-1 rounded-md text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition disabled:opacity-50"
        >
          ✓ War okay
        </button>
      </div>
    </li>
  );
}
