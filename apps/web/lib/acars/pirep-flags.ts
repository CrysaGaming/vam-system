import 'server-only';
import type { Prisma } from '@vam/db';

/**
 * Anti-Cheat structured flags for Pirep.flags (option #20).
 *
 * Machine-readable mirror of the [ACARS-flag: …] / [Replay-flag: …]
 * remarks-prefix splicing that the auto-PIREP path already produces.
 * Both surfaces co-exist:
 *
 *   - The remarks-prefix is what pilots see on /pireps/[id] — human-
 *     readable, free-form, edit-able by the pilot during the Draft
 *     state (option #19). Pilots can remove false-positive flags or
 *     add context to the splice.
 *
 *   - The structured `flags` field is what queries reach for —
 *     admin-queue filters, leaderboard exclusions, future audit-views.
 *     Stable across edits to remarks: even if a pilot removes the
 *     "[ACARS-flag: sim-rate 4.0x]" prefix from their remarks, the
 *     structured field still records `simRate: 4.0`. This is
 *     deliberate — the structured field is the audit-trail, the
 *     remarks-prefix is the pilot-visible surface.
 *
 * # Shape
 *
 * Each top-level key is OPTIONAL. The whole object itself is also
 * OPTIONAL on Pirep.flags — a clean PIREP (no flags fired) writes
 * NULL into the column rather than `{}`. This means:
 *
 *   - Manual /pireps/new submissions never write to flags (the helper
 *     is only called from the auto-PIREP path).
 *   - Auto-PIREPs with all clean heuristics also write NULL — the
 *     evaluator returns undefined in that case.
 *   - Auto-PIREPs with one or more flags fired write a JSON object
 *     containing only the firing keys.
 *
 * Why optional-everything rather than `{ simRate: number | null,
 * pauseSec: number | null, ... }`: avoids storing junk in the column.
 * `flags->>'simRate' IS NOT NULL` is more useful than
 * `flags->>'simRate' != null` for queries, and JSONB representation
 * is more compact when keys are absent rather than null-valued.
 *
 * # Field semantics
 *
 *   - simRate: present only when > 1.01 (the threshold also used by
 *     the heartbeat-route's enforceSimRate gate and the remarks-prefix
 *     splicing). 1.01 not 1.0 because SimConnect occasionally reports
 *     1.0001/0.9999 for legitimate real-time flight due to floating-
 *     point/clock-jitter — 1% headroom avoids false positives.
 *
 *   - pauseSec: present only when > 60 (one minute of pause). Below
 *     that, brief AFKs (cockpit screenshot, glance at chart) are
 *     normal and don't deserve a flag.
 *
 *   - replayFlags: array of human-readable strings from verifyReplay
 *     (option #11 — the heuristic-pass over the position trail).
 *     Strings like "teleport(345nm@2025-...)" or "supersonic-cruise(...)".
 *     Present only when the array is non-empty.
 *
 *   - hardLanding: present only when an INCIDENT-event of kind
 *     HARD_LANDING was recorded for this session (option #7).
 *     severity is 'hard' (>600 fpm vsi) or 'severe' (>1000 fpm vsi).
 *     verticalSpeedFpm is the recorded touchdown VSI; absent when
 *     the INCIDENT payload didn't capture the number.
 *
 * Future heuristics (route-deviation, callsign-mismatch, fuel-overflow)
 * can extend this type without a schema migration — just add new
 * optional keys and have buildPirepFlags() populate them when fired.
 */
export type PirepFlags = {
  simRate?: number;
  pauseSec?: number;
  replayFlags?: string[];
  hardLanding?: {
    severity: 'hard' | 'severe';
    verticalSpeedFpm?: number;
  };
};

/**
 * Inputs to buildPirepFlags. Mirrors the data already in scope at
 * the call-site in generate-pirep.ts — we don't introduce new queries,
 * just structure the same values that go into the remarks-prefix.
 *
 * - simRate / totalPauseSeconds: from the LiveSession row.
 * - replayFlags: from verifyReplay (option #11), the same array that
 *   gets joined into the [Replay-flag: …] prefix.
 * - incidentPayload: the JSON payload of the latest INCIDENT-event
 *   for the session, or null. The helper inspects it for HARD_LANDING
 *   shape and extracts severity + verticalSpeedFpm.
 */
export type PirepFlagsInput = {
  simRate: number | null;
  totalPauseSeconds: number | null;
  replayFlags: string[];
  incidentPayload: Prisma.JsonValue | null;
};

/**
 * Compute the structured flags object for a PIREP, or return undefined
 * if no flags fired (clean PIREP — column stays NULL).
 *
 * Mirrors the threshold logic in generate-pirep.ts that drives the
 * remarks-prefix splicing. Keeping the thresholds identical between
 * the two surfaces is intentional: a pilot reading the remarks-prefix
 * and an admin querying flags should agree on what counts as flagged.
 *
 * The function is pure and returns a fresh object each call — safe
 * to embed directly into a Prisma create's data block as
 * `flags: buildPirepFlags(...) ?? undefined` (Prisma treats undefined
 * as "don't write this field"; the column default kicks in and we get
 * SQL NULL).
 */
export function buildPirepFlags(input: PirepFlagsInput): PirepFlags | undefined {
  const flags: PirepFlags = {};

  // simRate: same > 1.01 threshold as the remarks-prefix in
  // generate-pirep.ts. Round to one decimal because SimConnect
  // reports as float and we don't need more precision than the
  // remarks-string ("sim-rate 4.0x") shows.
  if (input.simRate !== null && input.simRate > 1.01) {
    flags.simRate = Math.round(input.simRate * 10) / 10;
  }

  // pauseSec: same > 60 threshold as the remarks-prefix. Stored as
  // raw seconds, not rounded to minutes — gives admin-queries finer
  // control if they want to filter "paused > 5min" later.
  if (input.totalPauseSeconds !== null && input.totalPauseSeconds > 60) {
    flags.pauseSec = input.totalPauseSeconds;
  }

  // replayFlags: copy the array verbatim. Keep the same human-
  // readable format as the remarks-prefix so admin tooling that
  // surfaces the structured field can render them without
  // re-formatting. Only include the key if there's at least one
  // flag — empty array would be misleading ("replay was checked
  // and nothing fired" is not the same as "no flags at all").
  if (input.replayFlags.length > 0) {
    flags.replayFlags = [...input.replayFlags];
  }

  // hardLanding: parse the INCIDENT payload defensively. The schema-
  // comment on AcarsEvent.payload documents the HARD_LANDING shape
  // as `{ kind: 'HARD_LANDING', severity, value }`, but JSON columns
  // are unstructured at the DB level so we tolerate missing/typo'd
  // fields and fall through to "no hardLanding key" rather than
  // crashing the PIREP create.
  //
  // We accept severity 'hard' and 'severe' (the realistic touchdown
  // severities). 'crash' is documented in the AcarsEventType enum
  // for future use but if it ever shows up we treat it as 'severe'
  // here — flag the PIREP, surface to admin, but the type stays
  // narrow at compile-time.
  if (input.incidentPayload && typeof input.incidentPayload === 'object' && !Array.isArray(input.incidentPayload)) {
    const p = input.incidentPayload as Prisma.JsonObject;
    if (p.kind === 'HARD_LANDING') {
      const sev = p.severity;
      if (sev === 'hard' || sev === 'severe') {
        const hl: { severity: 'hard' | 'severe'; verticalSpeedFpm?: number } = {
          severity: sev,
        };
        const vsi = p.verticalSpeedFpm;
        if (typeof vsi === 'number' && Number.isFinite(vsi)) {
          hl.verticalSpeedFpm = Math.round(vsi);
        }
        flags.hardLanding = hl;
      }
    }
  }

  // No keys populated → return undefined so the caller can pass
  // `flags: pirepFlags ?? undefined` to Prisma and get SQL NULL.
  if (Object.keys(flags).length === 0) {
    return undefined;
  }

  return flags;
}
