import type { ScheduleTemplate } from '@vam/db';

/**
 * Schedule pure helpers + types (Welle 7 commit 7A-2, split out 2026-05).
 *
 * Client-safe: KEIN runtime-import von `@vam/db` (nur `import type`),
 * damit client-components diese helpers nutzen können ohne pg/net/tls
 * in ihren browser-bundle zu ziehen.
 *
 * DB-side generator-funktionen leben in `./schedule-server.ts` und
 * werden ausschließlich von server-actions importiert.
 *
 * Architektur-übersicht (siehe schema.prisma WELLE 7 docstring für die
 * volle übersicht):
 *
 *   ScheduleTemplate (recurring rule)
 *     ↓ [Generator-helper materialisiert]
 *   ScheduledFlight (concrete instance, status=Planned)
 *     ↓ [pilot picks, status→Booked, bookingId set]
 *   Booking
 *     ↓ [PIREP-file + approval, status→Completed]
 *   Pirep
 *
 * Time-handling: alle DateTimes sind UTC. Generator nutzt `Date.UTC(...)`
 * für midnight-anchor und addiert departureMinuteUtc-minuten. Display-
 * conversion (UTC → user-TZ) passiert ausschließlich im UI-layer.
 */

/**
 * ISO 8601 weekday number for a given UTC date (1=Monday … 7=Sunday).
 * Pure helper — entspricht template.daysOfWeek-encoding.
 */
export function getIsoWeekday(date: Date): number {
  // Date.prototype.getUTCDay() returns 0=Sunday … 6=Saturday — wir mappen
  // auf ISO 8601 (1=Mo … 7=Su) damit es matched mit dem schema-encoding.
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Combine a calendar date (UTC midnight anchor) + minutes-of-day-UTC zu
 * einer voll-aufgelösten UTC departure-DateTime.
 *
 * Beispiel: date=2026-05-15T13:42:00Z, departureMinuteUtc=870 (=14:30)
 *   → result = 2026-05-15T14:30:00Z
 *
 * Pure helper — wird vom generator und von preview-utilities genutzt.
 */
export function computeDepartureDateTime(
  date: Date,
  departureMinuteUtc: number,
): Date {
  const utcMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return new Date(utcMidnight + departureMinuteUtc * 60 * 1000);
}

/**
 * Compute all UTC departure-DateTimes a template would produce within
 * [fromDate, toDate]. Pure function — keine DB-access, kann für previews
 * im UI genutzt werden ohne side-effects.
 *
 * Effective range = intersection of [fromDate, toDate] mit
 * [template.validFrom, template.validUntil ?? +infinity].
 *
 * Performance: O(daysInRange) — lineares scan über jeden tag im range,
 * pro tag ein constant-time check ob weekday im daysOfWeek-array. Bei
 * realistic generation-windows (7-90 days) irrelevant.
 */
export function getOccurrencesForTemplate(
  template: Pick<
    ScheduleTemplate,
    'daysOfWeek' | 'departureMinuteUtc' | 'validFrom' | 'validUntil'
  >,
  fromDate: Date,
  toDate: Date,
): Date[] {
  const occurrences: Date[] = [];

  // Intersect [fromDate, toDate] with [validFrom, validUntil ?? +inf]
  const effectiveStart =
    fromDate.getTime() > template.validFrom.getTime()
      ? fromDate
      : template.validFrom;
  const effectiveEnd =
    template.validUntil && template.validUntil.getTime() < toDate.getTime()
      ? template.validUntil
      : toDate;

  if (effectiveStart.getTime() > effectiveEnd.getTime()) {
    return [];
  }

  // Iterate UTC-day-by-UTC-day. Cursor startet auf UTC-midnight des
  // effectiveStart-tages (damit wir auch instances vor effectiveStart's
  // tageszeit erfassen, falls departureMinuteUtc < effectiveStart.minutes).
  // Anschließend filtern wir auf [effectiveStart, effectiveEnd].
  const cursor = new Date(
    Date.UTC(
      effectiveStart.getUTCFullYear(),
      effectiveStart.getUTCMonth(),
      effectiveStart.getUTCDate(),
    ),
  );
  const endTime = effectiveEnd.getTime();

  while (cursor.getTime() <= endTime) {
    const weekday = getIsoWeekday(cursor);
    if (template.daysOfWeek.includes(weekday)) {
      const departure = computeDepartureDateTime(
        cursor,
        template.departureMinuteUtc,
      );
      if (
        departure.getTime() >= effectiveStart.getTime() &&
        departure.getTime() <= endTime
      ) {
        occurrences.push(departure);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return occurrences;
}

/**
 * Format-helper: minutes-of-day-UTC → "HH:MM" string (24h, zero-padded).
 * Used by UI components to render template.departureMinuteUtc.
 *
 * Beispiel: 870 → "14:30", 0 → "00:00", 1439 → "23:59"
 */
export function formatMinuteUtc(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Parse "HH:MM" string back to minutes-of-day. Returns null wenn invalid.
 * Used by UI form-handlers wenn user textuell eingibt.
 */
export function parseMinuteUtc(input: string): number | null {
  const match = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * ISO weekday → human-readable label (German UI).
 * 1=Mo, 2=Di, ... 7=So.
 */
export const ISO_WEEKDAY_LABELS_DE: Record<number, string> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
  7: 'So',
};

/**
 * Format daysOfWeek-array zu human-readable string.
 * [1,3,5] → "Mo, Mi, Fr"; [1,2,3,4,5] → "Mo–Fr"; [6,7] → "Sa, So";
 * [1,2,3,4,5,6,7] → "Täglich".
 *
 * Best-effort compaction für die häufigsten patterns; sonst comma-list.
 */
export function formatDaysOfWeekDe(days: number[]): string {
  if (days.length === 0) return '—';
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Täglich';

  // Werktage Mo-Fr
  if (
    sorted.length === 5 &&
    sorted.every((d, i) => d === i + 1)
  ) {
    return 'Mo–Fr';
  }
  // Wochenende
  if (sorted.length === 2 && sorted[0] === 6 && sorted[1] === 7) {
    return 'Sa, So';
  }

  return sorted.map((d) => ISO_WEEKDAY_LABELS_DE[d] ?? '?').join(', ');
}
