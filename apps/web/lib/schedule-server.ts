import { prisma } from '@vam/db';

import {
  getOccurrencesForTemplate,
} from './schedule';

/**
 * Schedule-Generator-DB-Side (Welle 7 commit 7A-2, split out 2026-05).
 *
 * Server-only: importiert `prisma` von `@vam/db` und führt DB-mutations aus.
 * Pure helpers (computeDepartureDateTime, getOccurrencesForTemplate, etc.)
 * leben in `./schedule` damit client-components diese helpers nutzen können
 * ohne pg/net/tls in ihren browser-bundle zu ziehen.
 *
 * Background des splits: schedule-template-form.tsx ist `'use client'` und
 * importiert pure UI-helpers (formatMinuteUtc, ISO_WEEKDAY_LABELS_DE) aus
 * `./schedule`. Solange `./schedule` einen top-level `import { prisma }`
 * hatte, zog Turbopack den ganzen pg-stack (-> node:net, node:tls) ins
 * client-bundle, was production-build mit "Module not found" failed.
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
