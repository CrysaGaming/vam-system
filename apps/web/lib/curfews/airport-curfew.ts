import 'server-only';

/**
 * Welle P / P3 — Airport curfew / Nachtflugverbot helper.
 *
 * Resolves an airport's current open/closed status against its
 * curfew rule (seeded into AirportCurfew). Two entrypoints:
 *
 *   getCurfewStatus(icao, atTime?)        — single-airport
 *   getMultipleCurfewStatus(icaos, atTime?) — batched for dispatch
 *
 * # The timezone problem
 *
 * Curfews are anchored to LOCAL time, not UTC ("Frankfurt is closed
 * 23:00-05:00 local, summer and winter alike"). So we can't just
 * compare UTC offsets — DST transitions would silently shift the
 * effective UTC window twice a year and the helper would be wrong
 * for half the calendar.
 *
 * The fix is `Intl.DateTimeFormat` with the airport's IANA timezone
 * (e.g. "Europe/Berlin"). Node ships full tz data, so DST transitions
 * are handled correctly without us shipping our own zoneinfo. The
 * `formatToParts` API gives us the local hour/minute/weekday at any
 * given UTC instant — exactly what we need.
 *
 * # Wrap-around windows
 *
 * The common curfew shape is "23:00 → 05:00", i.e. end < start —
 * a window that straddles midnight. We handle both shapes:
 *
 *   - Non-wrap (start < end): "08:00 → 17:00" (hypothetical day
 *     curfew). Closed iff start ≤ nowLocal < end on an effective day.
 *
 *   - Wrap (end < start): "23:00 → 05:00". Closed iff either:
 *       (a) nowLocal ≥ start AND today is an effective day, OR
 *       (b) nowLocal < end AND YESTERDAY was an effective day
 *           (the curfew that started yesterday-night is still in
 *           effect this morning before its end)
 *
 * Day-mask semantics: dayMask checks against the day the curfew
 * BEGINS. For dayMask=127 (every day) this doesn't matter; for
 * unusual weekend-only masks it does. Documented + tested.
 *
 * # No hard block at v1
 *
 * Like P2, the helper is informational. UI surfaces show "closes in
 * 47 min" or "opens in 6h 12min", but no booking flow is gated on
 * the result. v2 could add airline-policy enforcement (refuse booking
 * if estimated arrival lands inside curfew).
 */

import { prisma, type AirportCurfew } from '@vam/db';

// ─── Tuning ─────────────────────────────────────────────────
// How close to curfew-start counts as "closes-soon". Two hours gives
// pilots time to file/repos before the airport shuts.
const CLOSES_SOON_WINDOW_MIN = 120;

// ─── Public types ───────────────────────────────────────────

export type CurfewStatus =
  | { kind: 'no-curfew'; icao: string }
  | {
      kind: 'open';
      icao: string;
      curfew: AirportCurfew;
      /** Local-time HH:MM string when curfew next starts. */
      nextCloseAtLocal: string;
      /** Minutes from `atTime` until next curfew start. */
      minutesUntilClose: number;
    }
  | {
      kind: 'closes-soon';
      icao: string;
      curfew: AirportCurfew;
      nextCloseAtLocal: string;
      minutesUntilClose: number;
    }
  | {
      kind: 'closed';
      icao: string;
      curfew: AirportCurfew;
      /** Local-time HH:MM string when curfew next ends. */
      nextOpenAtLocal: string;
      /** Minutes from `atTime` until curfew ends. */
      minutesUntilOpen: number;
    };

// ─── Single-airport read ────────────────────────────────────

export async function getCurfewStatus(
  icao: string,
  atTime: Date = new Date(),
): Promise<CurfewStatus> {
  const cleanIcao = icao.trim().toUpperCase();
  const curfew = await prisma.airportCurfew.findUnique({
    where: { airportIcao: cleanIcao },
  });
  if (!curfew) return { kind: 'no-curfew', icao: cleanIcao };
  return classifyAgainstCurfew(curfew, atTime);
}

// ─── Batched read for dispatch surfaces ─────────────────────

export async function getMultipleCurfewStatus(
  icaos: string[],
  atTime: Date = new Date(),
): Promise<Map<string, CurfewStatus>> {
  const result = new Map<string, CurfewStatus>();
  const cleanIcaos = Array.from(
    new Set(icaos.map((i) => i.trim().toUpperCase()).filter((i) => /^[A-Z]{4}$/.test(i))),
  );
  if (cleanIcaos.length === 0) return result;

  const curfews = await prisma.airportCurfew.findMany({
    where: { airportIcao: { in: cleanIcaos } },
  });
  const curfewMap = new Map(curfews.map((c) => [c.airportIcao, c]));

  for (const icao of cleanIcaos) {
    const curfew = curfewMap.get(icao);
    if (!curfew) {
      result.set(icao, { kind: 'no-curfew', icao });
    } else {
      result.set(icao, classifyAgainstCurfew(curfew, atTime));
    }
  }
  return result;
}

// ─── Core classifier ────────────────────────────────────────

function classifyAgainstCurfew(
  curfew: AirportCurfew,
  atTime: Date,
): CurfewStatus {
  const local = getLocalParts(atTime, curfew.timezone);
  const nowMin = local.hour * 60 + local.minute;
  const todayDayIdx = local.dayIdx;
  const yesterdayDayIdx = (todayDayIdx + 6) % 7;

  const effectiveToday = isDayInMask(curfew.dayMask, todayDayIdx);
  const effectiveYesterday = isDayInMask(curfew.dayMask, yesterdayDayIdx);

  const isWrap = curfew.curfewEndLocalMin < curfew.curfewStartLocalMin;

  // ─── Are we currently closed? ─────────────────────────────
  let closedNow = false;
  if (isWrap) {
    // Two disjoint slices of the day are "closed":
    //   nowMin >= start AND today is effective (evening side)
    //   nowMin <  end   AND yesterday was effective (morning side)
    if (effectiveToday && nowMin >= curfew.curfewStartLocalMin) closedNow = true;
    if (effectiveYesterday && nowMin < curfew.curfewEndLocalMin) closedNow = true;
  } else {
    if (
      effectiveToday &&
      nowMin >= curfew.curfewStartLocalMin &&
      nowMin < curfew.curfewEndLocalMin
    ) {
      closedNow = true;
    }
  }

  // ─── Compute next transition time ─────────────────────────
  if (closedNow) {
    // We want: when does this curfew end? For wrap: if we're in the
    // morning slice (nowMin < end), end is today at curfew.end. If
    // we're in the evening slice (nowMin >= start), end is TOMORROW
    // at curfew.end.
    let minutesUntilOpen: number;
    if (isWrap) {
      if (nowMin < curfew.curfewEndLocalMin) {
        // Morning slice — end is later today.
        minutesUntilOpen = curfew.curfewEndLocalMin - nowMin;
      } else {
        // Evening slice — end is tomorrow at curfewEnd.
        minutesUntilOpen = 24 * 60 - nowMin + curfew.curfewEndLocalMin;
      }
    } else {
      minutesUntilOpen = curfew.curfewEndLocalMin - nowMin;
    }
    return {
      kind: 'closed',
      icao: curfew.airportIcao,
      curfew,
      nextOpenAtLocal: formatLocalHHMM(curfew.curfewEndLocalMin),
      minutesUntilOpen,
    };
  }

  // Currently open. When does it next close? We need to find the
  // earliest future curfewStart that lands on an effective day.
  // Look up to 8 days ahead — covers any reasonable dayMask (a mask
  // with at least one bit set guarantees a hit within 7 days; the 8th
  // is just buffer).
  let minutesUntilClose = Number.POSITIVE_INFINITY;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const dayIdx = (todayDayIdx + dayOffset) % 7;
    if (!isDayInMask(curfew.dayMask, dayIdx)) continue;

    // Curfew on this day starts at curfew.curfewStartLocalMin. How
    // many minutes from `atTime`?
    const startMinFromNow =
      dayOffset * 24 * 60 + curfew.curfewStartLocalMin - nowMin;
    if (startMinFromNow <= 0) continue; // already past today's start
    if (startMinFromNow < minutesUntilClose) {
      minutesUntilClose = startMinFromNow;
    }
    break; // earliest future start found
  }

  // Edge case: dayMask had no bits set (== invalid config, but
  // defensive). Treat as no-curfew rather than throwing.
  if (!Number.isFinite(minutesUntilClose)) {
    return { kind: 'no-curfew', icao: curfew.airportIcao };
  }

  const kind: 'open' | 'closes-soon' =
    minutesUntilClose <= CLOSES_SOON_WINDOW_MIN ? 'closes-soon' : 'open';

  return {
    kind,
    icao: curfew.airportIcao,
    curfew,
    nextCloseAtLocal: formatLocalHHMM(curfew.curfewStartLocalMin),
    minutesUntilClose,
  };
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Extract local hour/minute/day-index for a given UTC instant in a
 * named IANA timezone via Intl.DateTimeFormat. DST-correct year-round.
 *
 * Day-index convention: Sunday = 0, Monday = 1, …, Saturday = 6.
 * Matches the bit-position semantics documented on AirportCurfew.dayMask.
 */
function getLocalParts(date: Date, timezone: string): {
  hour: number;
  minute: number;
  dayIdx: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  let hour = 0;
  let minute = 0;
  let weekday = 'Sun';
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10) % 24; // "24" → 0 in some locales
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
    else if (p.type === 'weekday') weekday = p.value;
  }
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayIdx = dayMap[weekday] ?? 0;
  return { hour, minute, dayIdx };
}

function isDayInMask(mask: number, dayIdx: number): boolean {
  return (mask & (1 << dayIdx)) !== 0;
}

function formatLocalHHMM(minutesSinceMidnight: number): string {
  // Normalize for the 24:00 edge case (curfew defined as starting at
  // exactly midnight gets stored as 0; this isn't an HH:MM concern
  // but we clamp anyway).
  const m = ((minutesSinceMidnight % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

// ─── Display helpers (server + client) ──────────────────────
//
// Pure functions safe for client component import despite the
// file-level 'server-only' marker. Same pattern as P1's weather
// helper — Next's static-analyzer follows actual usage.

export function curfewBadgeStyle(status: CurfewStatus): {
  bg: string;
  text: string;
  label: string;
  emoji: string;
} {
  switch (status.kind) {
    case 'no-curfew':
      return {
        bg: 'bg-slate-100 dark:bg-slate-900/40',
        text: 'text-slate-600 dark:text-slate-300',
        label: 'Kein Curfew',
        emoji: '🌐',
      };
    case 'open':
      return {
        bg: 'bg-emerald-100 dark:bg-emerald-900/40',
        text: 'text-emerald-800 dark:text-emerald-200',
        label: `Offen · schließt ${status.nextCloseAtLocal}`,
        emoji: '✅',
      };
    case 'closes-soon':
      return {
        bg: 'bg-amber-100 dark:bg-amber-900/40',
        text: 'text-amber-800 dark:text-amber-200',
        label: `Schließt in ${formatMinutes(status.minutesUntilClose)}`,
        emoji: '⏳',
      };
    case 'closed':
      return {
        bg: 'bg-rose-100 dark:bg-rose-900/40',
        text: 'text-rose-800 dark:text-rose-200',
        label: `Geschlossen · öffnet ${status.nextOpenAtLocal}`,
        emoji: '🚫',
      };
  }
}

/** Format a minute-count as compact human-readable string. */
export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (m === 0) return `${h} h`;
  return `${h}h ${m}min`;
}
