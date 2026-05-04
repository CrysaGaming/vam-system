import { prisma, type ScheduleTemplate } from '@vam/db';

/**
 * Schedule-Generator-Logic (Welle 7 commit 7A-2).
 *
 * Materialisiert ScheduleTemplate-rows zu konkreten ScheduledFlight-instanzen
 * über einen date-range. Idempotent: re-runs erzeugen keine duplikate (skipt
 * existierende slots am gleichen [templateId, departureTime]).
 *
 * Architektur (siehe schema.prisma WELLE 7 docstring für die volle übersicht):
 *
 *   ScheduleTemplate (recurring rule)
 *     ↓ [Generator-helper materialisiert]
 *   ScheduledFlight (concrete instance, status=Planned)
 *     ↓ [pilot picks, status→Booked, bookingId set]
 *   Booking
 *     ↓ [PIREP-file + approval, status→Completed]
 *   Pirep
 *
 * Idempotenz-strategie: KEIN DB-unique-constraint auf (templateId, departure-
 * Time) — der wäre cleaner aber wäre eine separate migration. Stattdessen
 * app-layer dedup via findMany-prefilter. Race-condition-fenster (zwei
 * concurrent generators erstellen dieselbe instanz doppelt) ist akzeptabel
 * weil:
 *   1. Generator wird über admin-button getriggert (single-user)
 *   2. Selbst bei race: doppelte instanzen sind manuell löschbar, kein
 *      data-corruption (booking kann nur eine instanz binden via @unique)
 *   3. Wenn das je problem wird, additive migration (templateId, departure-
 *      Time) UNIQUE adden — kein code-change nötig
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

export type GenerateResult = {
  templateId: string;
  created: number;
  skipped: number; // already-existing instances within the range
};

/**
 * Generate ScheduledFlight rows for a single template, idempotent.
 *
 * Skipt:
 *   - inactive templates (active=false) — return {created:0, skipped:0}
 *   - dates outside template's validity-window
 *   - existing instances at same departureTime (app-layer dedup)
 *
 * Errors:
 *   - throws if template not found
 *   - sonst: best-effort, partial success möglich (createMany ist atomic
 *     pro batch, aber wenn die batch teil-failed werden alle reverted)
 */
export async function generateInstancesForTemplate(
  templateId: string,
  fromDate: Date,
  toDate: Date,
): Promise<GenerateResult> {
  const template = await prisma.scheduleTemplate.findUnique({
    where: { id: templateId },
  });
  if (!template) {
    throw new Error(`ScheduleTemplate ${templateId} not found`);
  }
  if (!template.active) {
    return { templateId, created: 0, skipped: 0 };
  }

  const occurrences = getOccurrencesForTemplate(template, fromDate, toDate);
  if (occurrences.length === 0) {
    return { templateId, created: 0, skipped: 0 };
  }

  // Dedup: hole alle existierenden instanzen für dieses template im
  // erweiterten range (vom kleinsten bis größten occurrence-time, damit
  // wir auch dann existierende erkennen wenn fromDate/toDate-bounds nicht
  // exakt mit den occurrence-times matchen).
  const minTime = occurrences[0]!;
  const maxTime = occurrences[occurrences.length - 1]!;

  const existing = await prisma.scheduledFlight.findMany({
    where: {
      templateId,
      departureTime: { gte: minTime, lte: maxTime },
    },
    select: { departureTime: true },
  });
  const existingTimestamps = new Set(
    existing.map((e) => e.departureTime.getTime()),
  );

  const toCreate = occurrences
    .filter((d) => !existingTimestamps.has(d.getTime()))
    .map((departureTime) => ({
      airlineId: template.airlineId,
      routeId: template.routeId,
      templateId: template.id,
      departureTime,
      preferredAircraftId: template.preferredAircraftId,
      // status defaultet auf Planned via schema
    }));

  if (toCreate.length === 0) {
    return { templateId, created: 0, skipped: occurrences.length };
  }

  const result = await prisma.scheduledFlight.createMany({
    data: toCreate,
  });

  return {
    templateId,
    created: result.count,
    skipped: occurrences.length - result.count,
  };
}

export type BulkGenerateResult = {
  airlineId: string;
  daysAhead: number;
  fromDate: Date;
  toDate: Date;
  templates: number;
  created: number;
  skipped: number;
  perTemplate: GenerateResult[];
};

/**
 * Bulk-generation für alle aktiven templates einer airline. Convenience
 * wrapper für den "Generate next N days"-admin-button auf der schedule-
 * overview-page.
 *
 * fromDate = NOW (UTC). Generator erstellt damit auch slots für "heute
 * später am tag" wenn das matching ist — kein backfill für vergangenheit.
 *
 * Performance: N+1 query-pattern (pro template mehrere roundtrips). Bei
 * realistic airline-size (5-50 templates) irrelevant. Wenn das je
 * bottleneck wird, würde man den dedup-check zu einer single-query
 * konsolidieren, aber YAGNI bis dann.
 */
export async function generateInstancesForAirline(
  airlineId: string,
  daysAhead: number,
): Promise<BulkGenerateResult> {
  const fromDate = new Date();
  const toDate = new Date(fromDate.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const templates = await prisma.scheduleTemplate.findMany({
    where: { airlineId, active: true },
    select: { id: true },
  });

  const perTemplate: GenerateResult[] = [];
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const template of templates) {
    const result = await generateInstancesForTemplate(
      template.id,
      fromDate,
      toDate,
    );
    perTemplate.push(result);
    totalCreated += result.created;
    totalSkipped += result.skipped;
  }

  return {
    airlineId,
    daysAhead,
    fromDate,
    toDate,
    templates: templates.length,
    created: totalCreated,
    skipped: totalSkipped,
    perTemplate,
  };
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
