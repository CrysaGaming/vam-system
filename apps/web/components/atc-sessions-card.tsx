import type { ReactNode } from 'react';
import { Radio, Clock } from 'lucide-react';

/**
 * Welle B — B2 phase 3. PIREP ATC-sessions card.
 *
 * Renders the list of VATSIM ATC controllers the pilot was tuned to
 * during this flight, attributed by the B2-phase-2B matcher at heartbeat
 * time. Each row shows the station-callsign, frequency, position-type
 * badge, and duration. The card is purely informational — no totals,
 * no scoring, no ranking — pilots use it to remember which controllers
 * they talked to (useful for thank-you DMs, debriefing flying-club
 * sessions, or pattern-matching "was I really on EDDF_S_TWR or
 * EDDF_N_TWR for that approach?").
 *
 * # Data source
 *
 * `LiveSession.atcSessions[]` from the PIREP's triggeringEvent.session.
 * Each row is one (station-callsign, contiguous time-window). When the
 * pilot tuned EDDF_GND for 4 minutes, switched to EDDF_TWR for 2 minutes,
 * then was retuned to EDDF_GND for taxi-in, that's THREE rows — sessions
 * are NOT resumed across gaps. See AtcSession model docstring in
 * schema.prisma for the lifecycle rules.
 *
 * # Duration formatting
 *
 * - endedAt is null → session was still open at LiveSession.lastUpdatedAt
 *   (typically because BLOCK_ON closed the LiveSession without first
 *   tuning away). We use LiveSession.lastUpdatedAt as the effective
 *   endpoint for the duration label.
 * - Round to nearest minute; show "<1 min" for sessions under 30 sec
 *   (likely a transient mistune the pilot corrected immediately).
 *
 * # Conditional rendering
 *
 * Caller should skip rendering when atcSessions[].length === 0 — manual
 * PIREPs and offline flights legitimately have zero ATC contact and
 * showing an empty card adds noise. The component itself defensively
 * returns null on empty input so a caller mistake doesn't render a
 * broken card.
 */

/** Single AtcSession row, mirror of the Prisma model fields we need. */
export type AtcSessionRow = {
  id: string;
  stationCallsign: string;
  facilityType: string;
  frequencyMhz: number;
  startedAt: Date;
  endedAt: Date | null;
};

export type AtcSessionsCardProps = {
  sessions: readonly AtcSessionRow[];
  /**
   * Endpoint used to compute the effective duration for sessions whose
   * endedAt is still null at PIREP-render time. Should be the parent
   * LiveSession's lastUpdatedAt — usually the same moment as BLOCK_ON.
   */
  sessionEndedAt: Date;
};

/**
 * Per-facility-type badge color. Tailwind v4 + globals.css CSS-variable
 * pattern. Chosen for legibility + semantic association:
 *   - DEL  → indigo (clearance, pre-departure)
 *   - GND  → blue (ground movement)
 *   - TWR  → green (takeoff/landing clearance)
 *   - APP  → amber (approach control)
 *   - CTR  → violet (enroute area control)
 *   - FSS  → slate (flight service, supplemental)
 *   - UNK  → gray (defensive fallback)
 *
 * Colors deliberately span the spectrum so a long list (rare but
 * possible on cross-country flights) reads visually as "phase of flight"
 * without the pilot having to parse each badge.
 */
function badgeClassFor(facilityType: string): string {
  switch (facilityType) {
    case 'DEL':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
    case 'GND':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    case 'TWR':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    case 'APP':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    case 'CTR':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
    case 'FSS':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }
}

/**
 * Format a duration in minutes for display. Compact form:
 *   - "<1 min" for under 30 seconds (rounds to 0 min)
 *   - "5 min" for whole minutes
 *   - "1h 24 min" for 60+ minutes
 *
 * The "<1 min" sentinel exists because many real ATC sessions are
 * actually quite brief (e.g. a 30-second hand-off where the pilot tunes,
 * gets the next freq, and switches immediately). Showing "0 min" looks
 * like a bug; showing "<1 min" is honest about the precision.
 */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const totalMin = Math.round(totalSec / 60);
  if (totalSec < 30) return '<1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${hours}h ${min} min`;
}

/**
 * Format a Date as "HH:MM" UTC, the convention used elsewhere on the
 * PIREP page (timestamps shown in zulu for unambiguity across pilots
 * in different timezones).
 */
function formatStartTime(d: Date): string {
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}Z`;
}

export function AtcSessionsCard({
  sessions,
  sessionEndedAt,
}: AtcSessionsCardProps): ReactNode {
  // Defensive empty-state: caller should skip rendering altogether but
  // we don't want to crash if they don't.
  if (sessions.length === 0) return null;

  // Sort chronologically — sessions arrive from prisma in
  // startedAt order via the (sessionId, startedAt) index, but be
  // defensive in case the caller transforms them.
  const ordered = [...sessions].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center gap-2">
        <Radio className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          ATC Sessions
        </h2>
        <span className="ml-1 text-sm text-slate-500 dark:text-slate-400">
          ({ordered.length}{' '}
          {ordered.length === 1 ? 'station' : 'stations'})
        </span>
      </div>

      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        VATSIM controllers you were tuned to during this flight, matched
        by COM1 frequency and position.
      </p>

      <ul className="space-y-2">
        {ordered.map((s) => {
          const effectiveEnd = s.endedAt ?? sessionEndedAt;
          const durationMs =
            effectiveEnd.getTime() - s.startedAt.getTime();
          return (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/50"
            >
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${badgeClassFor(s.facilityType)}`}
              >
                {s.facilityType}
              </span>
              <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                {s.stationCallsign}
              </span>
              <span className="font-mono text-sm text-slate-600 dark:text-slate-400">
                {s.frequencyMhz.toFixed(3)} MHz
              </span>
              <span className="ml-auto flex items-center gap-1 font-mono text-xs text-slate-500 dark:text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                {formatStartTime(s.startedAt)} · {formatDuration(durationMs)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
