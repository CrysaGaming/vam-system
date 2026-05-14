import 'server-only';
import type { Prisma } from '@vam/db';
import type { PositionJump } from './position-jump-detection';

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
 *   - timeAccel: Welle C / C1 — fired when the LiveSession's tracking
 *     counters show >= 3 consecutive heartbeats with simRate > 1.0.
 *     This is the structured detection the roadmap calls for, separate
 *     from the legacy simRate field above which is a single max-value
 *     snapshot. maxRunFrames is how many consecutive frames were
 *     observed at the peak; maxRate is the peak simRate value during
 *     the session (may have occurred outside the longest run). Both
 *     present when this flag fires.
 *
 *   - positionJumps: Welle C / C2 — array of position-pairs where
 *     actual distance > expected × 2 (minor) or × 5 (major). Empty
 *     array semantics same as replayFlags above: only included when
 *     non-empty. Capped at 20 entries server-side; if a session has
 *     more, the extras are silently dropped (the flag still fires).
 *
 *   - pauseRatio: Welle C / C3 — totalPauseSec / flightDurationSec
 *     when the ratio exceeds 0.30. Separate from pauseSec above:
 *     pauseSec catches single-burst pauses ("paused 5 min"); pauseRatio
 *     catches death-by-a-thousand-cuts ("30 brief pauses over a 1hr
 *     flight totalling 25 min"). Both can fire simultaneously.
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
  /** Welle C / C1 — time-acceleration detected via 3+ consecutive frame run. */
  timeAccel?: {
    maxRunFrames: number;
    maxRate: number;
  };
  /** Welle C / C2 — list of position-jumps observed during the session. */
  positionJumps?: PositionJump[];
  /** Welle C / C3 — fraction of flight time spent paused, when > 0.30. */
  pauseRatio?: number;
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
 * - timeAccelMaxRun / simRateMax: from the LiveSession row (Welle C
 *   / C1). The C1 instrumentation in apps/web/app/api/acars/heartbeat
 *   updates these per heartbeat.
 * - positionJumps: from detectPositionJumps (Welle C / C2), the same
 *   array that gets joined into the [ACARS-flag: …] prefix when
 *   non-empty.
 * - flightDurationSec: total session duration in seconds, used with
 *   totalPauseSeconds to compute the pauseRatio (Welle C / C3).
 *   May be null when generate-pirep.ts couldn't establish a
 *   block-to-block window — in that case the ratio is skipped (we
 *   don't fabricate a denominator).
 */
export type PirepFlagsInput = {
  simRate: number | null;
  totalPauseSeconds: number | null;
  replayFlags: string[];
  incidentPayload: Prisma.JsonValue | null;
  // Welle C / C1
  timeAccelMaxRun: number | null;
  simRateMax: number | null;
  // Welle C / C2
  positionJumps: PositionJump[];
  // Welle C / C3
  flightDurationSec: number | null;
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

  // ─── Welle C / C1 — time-acceleration ────────────────────────────
  //
  // Spec: "3 aufeinanderfolgende heartbeats mit simRate > 1.0 →
  // flag". The heartbeat-route maintains timeAccelMaxRun as the
  // max observed consecutive-frame count. Threshold is >= 3.
  //
  // Note this is independent of the legacy `simRate` flag above:
  // a pilot whose simRate dropped back to 1.0 at block-on won't
  // fire the legacy flag (which only sees the latest value) but
  // WILL fire timeAccel if they ran 3+ consecutive accelerated
  // frames earlier in the flight. simRateMax surfaces the peak
  // so admins can distinguish "barely above 1.0 for 3 frames"
  // (likely jitter) from "8.0x for 15 frames" (egregious).
  //
  // Defensive null-checks: pre-C1 sessions or sessions where the
  // client never reported simRate have timeAccelMaxRun=0 and
  // simRateMax=null — no flag fires.
  if (
    input.timeAccelMaxRun !== null &&
    input.timeAccelMaxRun >= 3 &&
    input.simRateMax !== null
  ) {
    flags.timeAccel = {
      maxRunFrames: input.timeAccelMaxRun,
      maxRate: Math.round(input.simRateMax * 10) / 10,
    };
  }

  // ─── Welle C / C2 — position-jumps ───────────────────────────────
  //
  // Detected by detectPositionJumps (see position-jump-detection.ts).
  // Empty-array semantics same as replayFlags: only include the key
  // when at least one jump was found. The detector caps at 20
  // entries server-side, so we don't need a length-check here.
  if (input.positionJumps.length > 0) {
    flags.positionJumps = [...input.positionJumps];
  }

  // ─── Welle C / C3 — pause-ratio ──────────────────────────────────
  //
  // Spec: "total-pause-seconds > 30% of flight-time → flag
  // EXCESSIVE_PAUSE". Computed as totalPauseSeconds /
  // flightDurationSec.
  //
  // Separate flag from `pauseSec` above:
  //   - pauseSec catches a single big pause ("paused 5 minutes
  //     straight"). Threshold: > 60 seconds.
  //   - pauseRatio catches death-by-a-thousand-cuts ("30 brief
  //     pauses totalling 25 min over a 1hr flight"). Threshold:
  //     > 0.30 ratio.
  // Both can fire simultaneously on the same PIREP and the admin
  // queue treats them as separate dispositions.
  //
  // Null-guards: skip the ratio if either input is missing or if
  // flightDurationSec is zero (defensive against divide-by-zero;
  // shouldn't happen in practice since generate-pirep always
  // computes a duration ≥ 1min).
  if (
    input.totalPauseSeconds !== null &&
    input.totalPauseSeconds > 0 &&
    input.flightDurationSec !== null &&
    input.flightDurationSec > 0
  ) {
    const ratio = input.totalPauseSeconds / input.flightDurationSec;
    if (ratio > 0.30) {
      // Round to 2 decimals — 0.37 reads clearer than 0.3734567.
      flags.pauseRatio = Math.round(ratio * 100) / 100;
    }
  }

  // No keys populated → return undefined so the caller can pass
  // `flags: pirepFlags ?? undefined` to Prisma and get SQL NULL.
  if (Object.keys(flags).length === 0) {
    return undefined;
  }

  return flags;
}
