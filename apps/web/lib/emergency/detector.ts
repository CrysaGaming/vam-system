import 'server-only';

/**
 * Welle P / P5 — Emergency auto-detect.
 *
 * Three entrypoints:
 *
 *   runEmergencyDetectionForPirep(pirepId) — invoked from approvePirep
 *     after the main approval transaction commits. Scans the PIREP
 *     (landing rate) + linked LiveSession (telemetry + ACARS INCIDENT
 *     events) and persists one EmergencyReport per detected signature.
 *     Idempotent — re-running deletes existing auto-detected rows and
 *     re-creates them, so manual reports (autoDetected=false) survive.
 *
 *   getEmergencyReportsForPirep(pirepId) — list reports for a PIREP,
 *     used by the PIREP-detail page badge surface.
 *
 *   getCareerEmergencyStats(userId) — aggregate count of reports a
 *     pilot has on approved PIREPs + total "saved souls" (passenger
 *     count summed across emergency-flagged PIREPs).
 *
 * # Why post-approval, not file-time
 *
 * Detection runs at approval rather than at PIREP file because (a)
 * the LiveSession + AcarsEvents are guaranteed complete by approval
 * time (the ACARS client has had time to flush its last events), (b)
 * we don't want to flag emergencies on rejected/spam PIREPs, and (c)
 * the approval action is already the natural hook-point for downstream
 * derivatives (economy, awards, follower-notifications).
 *
 * # Detection signatures
 *
 *   RAPID_DESCENT     — 3 consecutive LiveSessionPosition rows with
 *                       verticalSpeedFpm < -3000 AND altitudeAglFt
 *                       < 5000. Excludes intentional approach (gear
 *                       down + appropriate speed) only roughly — the
 *                       3-sample requirement filters most descents.
 *                       Severity: EMERGENCY.
 *
 *   HARD_LANDING      — pirep.landingRateFpm <= -800. Tiered:
 *                         -800 to -999   → INCIDENT
 *                        -1000 to -1299  → EMERGENCY
 *                        -1300 or worse  → MAYDAY (structural)
 *
 *   ACARS_INCIDENT    — Each AcarsEvent of type INCIDENT on the
 *                       linked session becomes one report. Payload's
 *                       "reason" field (if present) is copied to
 *                       details. Severity inferred from payload's
 *                       optional "severity" key, defaulting to
 *                       EMERGENCY.
 */

import {
  prisma,
  EmergencyType,
  EmergencySeverity,
  type EmergencyReport,
} from '@vam/db';

// ─── Tuning ─────────────────────────────────────────────────

// Rapid descent thresholds. Tuned for typical descent profiles:
// normal IFR descent is -1500 to -2500 fpm; sustained -3000+ at low
// altitude is uncontrolled.
const RAPID_DESCENT_FPM_THRESHOLD = -3000;
const RAPID_DESCENT_AGL_FT = 5000;
const RAPID_DESCENT_CONSECUTIVE_SAMPLES = 3;

// Hard landing severity tiers. Numbers are fpm at touchdown
// (landingRateFpm is stored as a positive int representing the
// magnitude in some codebases, but VAM stores it signed — negative
// means descending). We check against the negative thresholds.
const HARD_LANDING_INCIDENT_FPM = -800;
const HARD_LANDING_EMERGENCY_FPM = -1000;
const HARD_LANDING_MAYDAY_FPM = -1300;

// ─── Public API ─────────────────────────────────────────────

export type EmergencyDetectionResult = {
  created: EmergencyReport[];
  /** True if anything got persisted; false when the flight was clean. */
  hadEmergency: boolean;
};

export async function runEmergencyDetectionForPirep(
  pirepId: string,
): Promise<EmergencyDetectionResult> {
  // Pull what we need in one round-trip. We don't pull positions yet
  // — only if there's a session to scan, and only via separate query
  // (potentially thousands of rows).
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: {
      id: true,
      userId: true,
      landingRateFpm: true,
      triggeringEvent: {
        select: { sessionId: true },
      },
    },
  });
  if (!pirep) {
    return { created: [], hadEmergency: false };
  }

  const drafts: Array<Omit<EmergencyReport, 'id' | 'detectedAt'>> = [];

  // ─── HARD_LANDING (PIREP-only — works for non-ACARS PIREPs) ─
  if (pirep.landingRateFpm != null && pirep.landingRateFpm <= HARD_LANDING_INCIDENT_FPM) {
    drafts.push({
      pirepId: pirep.id,
      type: EmergencyType.HARD_LANDING,
      severity: classifyHardLanding(pirep.landingRateFpm),
      autoDetected: true,
      details: `Touchdown ${pirep.landingRateFpm} fpm — ${
        pirep.landingRateFpm <= HARD_LANDING_MAYDAY_FPM
          ? 'structural inspection recommended'
          : pirep.landingRateFpm <= HARD_LANDING_EMERGENCY_FPM
            ? 'maintenance check required'
            : 'logged for trend monitoring'
      }`,
    });
  }

  // ─── Session-based detection ──────────────────────────────
  const sessionId = pirep.triggeringEvent?.sessionId;
  if (sessionId) {
    // RAPID_DESCENT: scan positions for the 3-consecutive-sample
    // signature. Done in JS rather than SQL because the rolling-
    // window pattern doesn't have a clean SQL form and there are
    // only ~hundreds-to-low-thousands of position rows per flight.
    const positions = await prisma.liveSessionPosition.findMany({
      where: { sessionId },
      orderBy: { recordedAt: 'asc' },
      select: {
        verticalSpeedFpm: true,
        altitudeAglFt: true,
        recordedAt: true,
      },
    });

    const rapidDescent = scanForRapidDescent(positions);
    if (rapidDescent) {
      drafts.push({
        pirepId: pirep.id,
        type: EmergencyType.RAPID_DESCENT,
        severity: EmergencySeverity.EMERGENCY,
        autoDetected: true,
        details: `VS ${rapidDescent.peakVsFpm} fpm at ${rapidDescent.altAglFt} ft AGL (${RAPID_DESCENT_CONSECUTIVE_SAMPLES} consecutive samples)`,
      });
    }

    // ACARS_INCIDENT: one report per INCIDENT event on this session.
    const incidents = await prisma.acarsEvent.findMany({
      where: { sessionId, type: 'INCIDENT' },
      select: { id: true, payload: true, timestamp: true },
    });
    for (const inc of incidents) {
      const { reason, severity } = extractIncidentMetadata(inc.payload);
      drafts.push({
        pirepId: pirep.id,
        type: EmergencyType.ACARS_INCIDENT,
        severity,
        autoDetected: true,
        details: reason ? `ACARS incident: ${reason}` : 'ACARS incident reported',
      });
    }
  }

  // ─── Persist atomically (idempotent) ──────────────────────
  // deleteMany first to clear out previous auto-detected rows. Manual
  // reports (autoDetected=false) survive — that's the v2 admin workflow.
  // createMany doesn't return the created rows, so we use a transaction
  // of individual creates to surface them to the caller (useful for
  // post-detection notification dispatch).
  if (drafts.length === 0) {
    // No findings, but we still wipe previous auto-rows so re-running
    // on a corrected PIREP (e.g. landingRateFpm fixed by admin) clears
    // stale entries.
    await prisma.emergencyReport.deleteMany({
      where: { pirepId: pirep.id, autoDetected: true },
    });
    return { created: [], hadEmergency: false };
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.emergencyReport.deleteMany({
      where: { pirepId: pirep.id, autoDetected: true },
    });
    const rows: EmergencyReport[] = [];
    for (const draft of drafts) {
      const row = await tx.emergencyReport.create({ data: draft });
      rows.push(row);
    }
    return rows;
  });

  return { created, hadEmergency: true };
}

export async function getEmergencyReportsForPirep(
  pirepId: string,
): Promise<EmergencyReport[]> {
  return prisma.emergencyReport.findMany({
    where: { pirepId },
    orderBy: [{ severity: 'desc' }, { detectedAt: 'asc' }],
  });
}

export type CareerEmergencyStats = {
  /** Total emergency reports across all approved PIREPs of this pilot. */
  totalReports: number;
  /** PIREPs flagged with at least one emergency. */
  flightsWithEmergency: number;
  /** Passenger count summed across those PIREPs — the "saved souls" tally. */
  savedSouls: number;
  /** Per-type breakdown for the career page badges. */
  byType: Partial<Record<EmergencyType, number>>;
};

export async function getCareerEmergencyStats(
  userId: string,
): Promise<CareerEmergencyStats> {
  // Pull all reports joined to PIREPs the pilot owns + are approved.
  // Using a relation filter so we only count emergencies on flights
  // that actually counted.
  const reports = await prisma.emergencyReport.findMany({
    where: {
      pirep: { userId, status: 'Approved' },
    },
    select: {
      pirepId: true,
      type: true,
      pirep: { select: { passengerCount: true } },
    },
  });

  // Dedupe by pirepId for the savedSouls calc — multiple emergencies
  // on one flight don't multiply the passenger count.
  const pirepSouls = new Map<string, number>();
  const byType: Partial<Record<EmergencyType, number>> = {};
  for (const r of reports) {
    if (!pirepSouls.has(r.pirepId)) {
      pirepSouls.set(r.pirepId, r.pirep.passengerCount ?? 0);
    }
    byType[r.type] = (byType[r.type] ?? 0) + 1;
  }

  let savedSouls = 0;
  for (const count of pirepSouls.values()) savedSouls += count;

  return {
    totalReports: reports.length,
    flightsWithEmergency: pirepSouls.size,
    savedSouls,
    byType,
  };
}

// ─── Helpers ────────────────────────────────────────────────

function classifyHardLanding(fpm: number): EmergencySeverity {
  if (fpm <= HARD_LANDING_MAYDAY_FPM) return EmergencySeverity.MAYDAY;
  if (fpm <= HARD_LANDING_EMERGENCY_FPM) return EmergencySeverity.EMERGENCY;
  return EmergencySeverity.INCIDENT;
}

type PositionSample = {
  verticalSpeedFpm: number | null;
  altitudeAglFt: number | null;
};

function scanForRapidDescent(
  positions: PositionSample[],
): { peakVsFpm: number; altAglFt: number } | null {
  // Sliding window of N consecutive samples — all must satisfy both
  // conditions simultaneously to trigger.
  let run = 0;
  let peakVs = 0;
  let triggerAlt = 0;
  for (const p of positions) {
    const vs = p.verticalSpeedFpm;
    const agl = p.altitudeAglFt;
    if (
      vs != null &&
      agl != null &&
      vs <= RAPID_DESCENT_FPM_THRESHOLD &&
      agl <= RAPID_DESCENT_AGL_FT
    ) {
      run += 1;
      if (vs < peakVs) {
        peakVs = vs;
        triggerAlt = agl;
      }
      if (run >= RAPID_DESCENT_CONSECUTIVE_SAMPLES) {
        return { peakVsFpm: peakVs, altAglFt: triggerAlt };
      }
    } else {
      run = 0;
      peakVs = 0;
    }
  }
  return null;
}

function extractIncidentMetadata(payload: unknown): {
  reason: string | null;
  severity: EmergencySeverity;
} {
  // Payload is Json? — could be anything. We probe for known shapes
  // defensively and fall back to EMERGENCY severity.
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    const reason = typeof obj.reason === 'string' ? obj.reason : null;
    const sevRaw = typeof obj.severity === 'string' ? obj.severity.toUpperCase() : null;
    let severity: EmergencySeverity = EmergencySeverity.EMERGENCY;
    if (sevRaw === 'INCIDENT') severity = EmergencySeverity.INCIDENT;
    else if (sevRaw === 'MAYDAY') severity = EmergencySeverity.MAYDAY;
    return { reason, severity };
  }
  return { reason: null, severity: EmergencySeverity.EMERGENCY };
}

// ─── Display helpers (server + client) ──────────────────────

export function emergencyTypeLabel(type: EmergencyType): string {
  switch (type) {
    case EmergencyType.RAPID_DESCENT: return 'Rapid Descent';
    case EmergencyType.HARD_LANDING: return 'Hard Landing';
    case EmergencyType.ACARS_INCIDENT: return 'ACARS Incident';
  }
}

export function emergencyTypeEmoji(type: EmergencyType): string {
  switch (type) {
    case EmergencyType.RAPID_DESCENT: return '📉';
    case EmergencyType.HARD_LANDING: return '💥';
    case EmergencyType.ACARS_INCIDENT: return '🚨';
  }
}

export function emergencySeverityStyle(severity: EmergencySeverity): {
  bg: string;
  text: string;
  border: string;
  label: string;
} {
  switch (severity) {
    case EmergencySeverity.INCIDENT:
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        text: 'text-amber-800 dark:text-amber-200',
        border: 'border-amber-300 dark:border-amber-700/50',
        label: 'INCIDENT',
      };
    case EmergencySeverity.EMERGENCY:
      return {
        bg: 'bg-rose-50 dark:bg-rose-900/20',
        text: 'text-rose-800 dark:text-rose-200',
        border: 'border-rose-300 dark:border-rose-700/50',
        label: 'EMERGENCY',
      };
    case EmergencySeverity.MAYDAY:
      return {
        bg: 'bg-red-100 dark:bg-red-900/40',
        text: 'text-red-900 dark:text-red-100',
        border: 'border-red-500 dark:border-red-600',
        label: 'MAYDAY',
      };
  }
}
