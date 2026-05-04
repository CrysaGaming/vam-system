/**
 * Shared formatters for /a/[icao] public pages (Welle 8 commit 8B-2).
 *
 * Extracted from /a/[icao]/page.tsx so layout + sub-pages can share them
 * without duplicating string-manipulation logic. Pure functions, no side
 * effects, no DB access. UTC throughout — public pages NEVER show local
 * time because we don't know the visitor's TZ reliably and showing
 * "departure 14:30" without a TZ is worse than showing "14:30 UTC".
 */

/** "MM-DD HH:MM" — compact preview format (year omitted for space) */
export function ymdHmUtc(d: Date): string {
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const da = d.getUTCDate().toString().padStart(2, '0');
  const h = d.getUTCHours().toString().padStart(2, '0');
  const mi = d.getUTCMinutes().toString().padStart(2, '0');
  return `${mo}-${da} ${h}:${mi}`;
}

/** "YYYY-MM-DD" UTC */
export function ymdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const da = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${da}`;
}

/** "HH:MM" UTC */
export function hhmmUtc(d: Date): string {
  const h = d.getUTCHours().toString().padStart(2, '0');
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** ISO-8601 weekday (1=Mo .. 7=So) for UTC midnight of the given date */
export function isoWeekdayUtc(d: Date): number {
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

export const WEEKDAY_SHORT_DE: Record<number, string> = {
  1: 'Mo',
  2: 'Di',
  3: 'Mi',
  4: 'Do',
  5: 'Fr',
  6: 'Sa',
  7: 'So',
};

/** Strip protocol + trailing slash for compact display */
export function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}
