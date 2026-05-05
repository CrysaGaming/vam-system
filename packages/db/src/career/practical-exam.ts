/**
 * Practical-Exam helpers für Welle 13E-14.
 *
 * Was hier rein gehört:
 *   - validatePirepForPracticalExam — pure helper: PIREP-criteria-check
 *     (gehört dem user, status=APPROVED, ausreichend flightTimeMin)
 *   - markPirepAsPracticalExam      — pilot weist einen PIREP als
 *                                     prüfungsflug zu
 *   - unsetPracticalExamPirep       — pilot ändert meinung vor instructor-
 *                                     review
 *   - passPracticalExam             — instructor markiert pass,
 *                                     transitioniert enrollment → PASSED,
 *                                     issued automatisch die license
 *                                     (ATOMIC via $transaction)
 *   - failPracticalExam             — instructor markiert fail, clears
 *                                     pirepId für retry, increments
 *                                     attempts
 *   - listEnrollmentsAwaitingPracticalReview — instructor-queue
 *
 * Lifecycle (zwei-stage commit):
 *
 *   Pilot-side: enrollment.status=EXAM_SCHEDULED (= theory passed) →
 *     pilot fliegt PIREP → wartet auf approval → markPirepAsPracticalExam
 *     setzt practicalExamPirepId. Pilot wartet auf instructor-review.
 *
 *   Instructor-side: queue-page zeigt enrollments mit pirepId set →
 *     instructor reviewed PIREP + entscheidet pass/fail.
 *
 * Pre-conditions für markPirepAsPracticalExam:
 *   - enrollment.status === 'EXAM_SCHEDULED' (theory bereits passed)
 *   - PIREP gehört dem user
 *   - PIREP.status === 'APPROVED' (sonst kann der instructor die zahlen
 *     nicht trauen — submitted-aber-not-approved könnte gefaked sein)
 *   - PIREP.flightTimeMin >= MIN_FLIGHT_TIME_MIN_BY_LICENSE[licenseType]
 *
 * License-issuance bei passPracticalExam:
 *   Im transaction-block: grantLicense() → enrollment-update mit
 *   resultingLicenseId + status=PASSED. Wenn grantLicense werft (P2002:
 *   pilot hat schon license dieses typs), rollback'd alles und der
 *   instructor sieht den error. Sollte aber nie passieren wenn der
 *   enrollment-flow korrekt gegated war (kein enroll wenn license schon
 *   exists).
 *
 * Idempotency:
 *   - passPracticalExam: status-check (muss EXAM_SCHEDULED sein) verhindert
 *     re-run nach pass. Kein second pass möglich.
 *   - failPracticalExam: kann mehrfach gerufen werden, aber pirepId muss
 *     gesetzt sein (sonst error — kein "leeres fail" möglich). Jeder
 *     fail-call inkrementiert attempts.
 */

import {
  Prisma,
  type LicenseType,
  type PilotLicense,
  type FlightSchoolEnrollment,
} from "@prisma/client";
import { prisma } from "../index.js";
import type { DbClient } from "../economy/wallet.js";
import { grantLicense } from "./licenses.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/**
 * Minimum-flight-time pro license-type für den prüfungsflug. Realistic
 * orientiert an EASA Part-FCL skill-test-durations:
 *   - PPL: typischerweise ~90min skill-test, wir sind großzügig mit 60min
 *   - SPL: erste solo-checks sind 30min — entry-level
 *   - IR/CPL/ATPL: längere skill-tests mit mehreren approaches
 *
 * Werte sind soft-floors — der instructor kann theoretisch trotzdem failen
 * wenn der flug zu kurz war (z.B. nur ein circuit). Wir lassen den
 * instructor-judgement dann das letzte wort haben statt hard-blocking.
 *
 * Der mark-flow checkt aber gegen diese werte BEVOR der pilot den PIREP
 * markieren kann — verhindert dass jemand ein 5-min-touch-and-go als
 * ATPL-prüfung einreicht.
 *
 * Default 30min wenn der license-typ nicht in der map ist.
 */
export const MIN_FLIGHT_TIME_MIN_BY_LICENSE: Partial<Record<LicenseType, number>> = {
  SPL: 30,
  PPL: 60,
  NIGHT_RATING: 60,
  INSTRUMENT_RATING: 90,
  MULTI_ENGINE_RATING: 60,
  CPL: 90,
  MCC: 60,
  ATPL: 120,
  TRI: 60,
  TRE: 60,
};

const DEFAULT_MIN_FLIGHT_TIME_MIN = 30;

export function getMinFlightTimeForLicense(type: LicenseType): number {
  return MIN_FLIGHT_TIME_MIN_BY_LICENSE[type] ?? DEFAULT_MIN_FLIGHT_TIME_MIN;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Shape was wir vom PIREP brauchen für die validation. Bewusst minimal
 * gehalten — caller muss nicht den vollen prisma-PIREP-row mitschleppen.
 */
export interface PirepCandidate {
  id: string;
  userId: string;
  status: string; // PirepStatus enum-string ("APPROVED", "Submitted", etc.)
  flightTimeMin: number | null;
}

export interface ValidationResult {
  ok: boolean;
  /** Bei ok=false: kurzer reason für UI-anzeige. */
  reason?: string;
}

/**
 * Pure check ob ein PIREP als practical-exam-flug taugt. Wird von
 * markPirepAsPracticalExam aufgerufen, kann aber auch UI-side für
 * disabled-states genutzt werden.
 *
 * Reihenfolge der checks (early-return mit erstem fail):
 *   1. PIREP gehört dem user
 *   2. PIREP-status APPROVED (case-sensitive: PrismaEnum schreibt sich
 *      "APPROVED" als string)
 *   3. flightTimeMin >= license-spezifisches minimum
 */
export function validatePirepForPracticalExam(
  pirep: PirepCandidate,
  enrollment: { userId: string; licenseType: LicenseType },
): ValidationResult {
  if (pirep.userId !== enrollment.userId) {
    return {
      ok: false,
      reason: "Dieser PIREP gehört nicht dir.",
    };
  }
  // PirepStatus enum-werte: Submitted, Approved, Rejected (PascalCase im
  // schema). Wir vergleichen case-sensitive — prisma-enum-strings werden
  // genau so serialisiert wie sie im schema deklariert sind.
  if (pirep.status !== "Approved") {
    return {
      ok: false,
      reason: `PIREP muss approved sein (aktuell: ${pirep.status}).`,
    };
  }
  const minFlightTime = getMinFlightTimeForLicense(enrollment.licenseType);
  const actual = pirep.flightTimeMin ?? 0;
  if (actual < minFlightTime) {
    return {
      ok: false,
      reason: `PIREP zu kurz: ${actual} min (mindestens ${minFlightTime} min für ${enrollment.licenseType}).`,
    };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Mark/unset PIREP as practical exam
// ─────────────────────────────────────────────────────────────────────────

export interface MarkPirepInput {
  enrollmentId: string;
  pirepId: string;
}

/**
 * Pilot wählt einen approved-PIREP als seinen prüfungsflug.
 *
 * Pre-conditions:
 *   - enrollment exists, status=EXAM_SCHEDULED (theory bereits passed)
 *   - PIREP exists und gehört dem user
 *   - validation via validatePirepForPracticalExam ok
 *   - kein practicalExamPirepId schon gesetzt (sonst muss pilot erst
 *     unsetPracticalExamPirep callen — verhindert silent overwrite)
 *
 * Setzt practicalExamPirepId. Status bleibt EXAM_SCHEDULED — wechselt
 * erst bei pass/fail durch den instructor.
 */
export async function markPirepAsPracticalExam(
  input: MarkPirepInput,
  db: DbClient = prisma,
): Promise<FlightSchoolEnrollment> {
  const enrollment = await db.flightSchoolEnrollment.findUnique({
    where: { id: input.enrollmentId },
  });
  if (!enrollment) {
    throw new Error(
      `markPirepAsPracticalExam: enrollment ${input.enrollmentId} not found`,
    );
  }
  if (enrollment.status !== "EXAM_SCHEDULED") {
    throw new Error(
      `markPirepAsPracticalExam: enrollment-status ist ${enrollment.status} — Theorie muss zuerst bestanden sein.`,
    );
  }
  if (enrollment.practicalExamPirepId !== null) {
    throw new Error(
      "markPirepAsPracticalExam: ein PIREP ist bereits zugewiesen. Erst zurücksetzen, dann neu zuweisen.",
    );
  }

  const pirep = await db.pirep.findUnique({
    where: { id: input.pirepId },
    select: {
      id: true,
      userId: true,
      status: true,
      flightTimeMin: true,
    },
  });
  if (!pirep) {
    throw new Error(`markPirepAsPracticalExam: PIREP ${input.pirepId} not found`);
  }

  const validation = validatePirepForPracticalExam(
    { ...pirep, status: pirep.status },
    enrollment,
  );
  if (!validation.ok) {
    throw new Error(
      validation.reason ?? "PIREP nicht für Prüfungsflug zugelassen.",
    );
  }

  return db.flightSchoolEnrollment.update({
    where: { id: input.enrollmentId },
    data: { practicalExamPirepId: input.pirepId },
  });
}

/**
 * Pilot zieht den als prüfungsflug zugewiesenen PIREP zurück. Erlaubt nur
 * wenn:
 *   - enrollment.status === 'EXAM_SCHEDULED' (instructor hat noch nicht
 *     reviewed; bei PASSED wäre der pirepId-link audit-trail und darf
 *     nicht entfernt werden)
 *   - practicalExamPirepId !== null
 *
 * Decrement von attempts macht KEINEN sinn weil mark != attempt — ein
 * attempt ist erst dann verbraucht, wenn der instructor pass/fail
 * markiert. Pilot kann beliebig oft markieren+unset bevor die wirkliche
 * prüfung gewertet wird.
 */
export async function unsetPracticalExamPirep(
  enrollmentId: string,
  db: DbClient = prisma,
): Promise<FlightSchoolEnrollment> {
  const enrollment = await db.flightSchoolEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, status: true, practicalExamPirepId: true },
  });
  if (!enrollment) {
    throw new Error(`unsetPracticalExamPirep: enrollment ${enrollmentId} not found`);
  }
  if (enrollment.status !== "EXAM_SCHEDULED") {
    throw new Error(
      `unsetPracticalExamPirep: enrollment-status ${enrollment.status} — kein un-mark mehr möglich.`,
    );
  }
  if (enrollment.practicalExamPirepId === null) {
    throw new Error("unsetPracticalExamPirep: kein PIREP zugewiesen.");
  }

  return db.flightSchoolEnrollment.update({
    where: { id: enrollmentId },
    data: { practicalExamPirepId: null },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Pass / Fail (instructor-side)
// ─────────────────────────────────────────────────────────────────────────

export interface PassPracticalExamInput {
  enrollmentId: string;
  /** Instructor-userId für audit-trail. */
  instructorId: string;
  /** Optional notes für die ausgestellte license. */
  notes?: string | null;
  /** Optional override für expiry der ausgestellten license. */
  licenseExpiresAt?: Date | null;
}

export interface PassPracticalExamResult {
  enrollment: FlightSchoolEnrollment;
  license: PilotLicense;
}

/**
 * Instructor markiert prüfung als bestanden. Ausgelöste effects in
 * EINER atomic transaction:
 *
 *   1. attempts += 1
 *   2. practicalExamPassedAt = now
 *   3. status: EXAM_SCHEDULED → PASSED
 *   4. grantLicense({type, issuedById: instructor}) → erzeugt PilotLicense
 *   5. enrollment.resultingLicenseId = license.id
 *
 * Pre-conditions (server-side validation):
 *   - enrollment exists, status=EXAM_SCHEDULED
 *   - practicalExamPirepId !== null (pilot hat einen flug zugewiesen)
 *   - theoryExamPassedAt !== null (defense-in-depth: status sollte das
 *     schon garantieren, aber checken sicher)
 *
 * Failure-modes:
 *   - P2002 (userId, type) bei grantLicense: pilot hat license-type schon.
 *     Sollte nie passieren wenn enrollment-flow korrekt war (gating
 *     verhindert enroll wenn license existiert), aber falls doch — der
 *     ganze transaction rollback'd und der instructor sieht den error.
 */
export async function passPracticalExam(
  input: PassPracticalExamInput,
  db: DbClient = prisma,
): Promise<PassPracticalExamResult> {
  const enrollment = await db.flightSchoolEnrollment.findUnique({
    where: { id: input.enrollmentId },
    select: {
      id: true,
      userId: true,
      licenseType: true,
      status: true,
      practicalExamPirepId: true,
      theoryExamPassedAt: true,
      practicalExamAttempts: true,
    },
  });
  if (!enrollment) {
    throw new Error(`passPracticalExam: enrollment ${input.enrollmentId} not found`);
  }
  if (enrollment.status !== "EXAM_SCHEDULED") {
    throw new Error(
      `passPracticalExam: enrollment-status ${enrollment.status} — kein pass möglich.`,
    );
  }
  if (enrollment.practicalExamPirepId === null) {
    throw new Error(
      "passPracticalExam: kein Prüfungsflug zugewiesen — pilot muss erst einen PIREP markieren.",
    );
  }
  if (enrollment.theoryExamPassedAt === null) {
    throw new Error(
      "passPracticalExam: Theorie-Prüfung nicht bestanden (defense-in-depth — status sollte das verhindern).",
    );
  }

  const passedAt = new Date();

  return db.$transaction(async (tx) => {
    // Issue license. Notes-template inkl. enrollment-context damit später
    // klar ist warum die license existiert (z.B. bei admin-investigation
    // "warum hat user X eine PPL?").
    const noteParts = [
      `Ausgestellt nach bestandener praktischer Prüfung (Enrollment ${enrollment.id})`,
    ];
    if (input.notes && input.notes.trim()) {
      noteParts.push(input.notes.trim());
    }

    const license = await grantLicense(
      {
        userId: enrollment.userId,
        type: enrollment.licenseType,
        issuedAt: passedAt,
        expiresAt: input.licenseExpiresAt ?? null,
        issuedById: input.instructorId,
        notes: noteParts.join(" — "),
      },
      tx,
    );

    const updatedEnrollment = await tx.flightSchoolEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: "PASSED",
        practicalExamPassedAt: passedAt,
        practicalExamAttempts: { increment: 1 },
        resultingLicenseId: license.id,
      },
    });

    return { enrollment: updatedEnrollment, license };
  });
}

export interface FailPracticalExamInput {
  enrollmentId: string;
  instructorId: string;
  /** Reason wird im rejectionContext stored (eigenes feld? — nein, vorerst
   *  nur als console.log audit-trail bis dedicated audit-table existiert). */
  reason: string;
}

/**
 * Instructor markiert prüfung als nicht-bestanden. Effects:
 *   1. attempts += 1
 *   2. practicalExamPirepId = null (pilot kann neuen PIREP zuweisen)
 *   3. status bleibt EXAM_SCHEDULED (retry erlaubt)
 *
 * Bewusst KEIN auto-fail-bei-3-attempts. Wir lassen den pilot beliebig
 * oft retry'en — wenn das problematisch wird, kann später eine policy
 * dazukommen ("nach 3 fails: enrollment.status → FAILED, kein retry").
 *
 * Reason wird (vorerst) nur im console-log als audit-placeholder ge-
 * speichert. Wenn dedicated audit-table kommt, hier persisten.
 */
export async function failPracticalExam(
  input: FailPracticalExamInput,
  db: DbClient = prisma,
): Promise<FlightSchoolEnrollment> {
  if (!input.reason.trim()) {
    throw new Error("failPracticalExam: reason ist required (audit-trail).");
  }

  const enrollment = await db.flightSchoolEnrollment.findUnique({
    where: { id: input.enrollmentId },
    select: {
      id: true,
      status: true,
      practicalExamPirepId: true,
    },
  });
  if (!enrollment) {
    throw new Error(`failPracticalExam: enrollment ${input.enrollmentId} not found`);
  }
  if (enrollment.status !== "EXAM_SCHEDULED") {
    throw new Error(
      `failPracticalExam: enrollment-status ${enrollment.status} — kein fail möglich.`,
    );
  }
  if (enrollment.practicalExamPirepId === null) {
    throw new Error(
      "failPracticalExam: kein Prüfungsflug zugewiesen — pilot muss erst einen PIREP markieren.",
    );
  }

  // Audit-log VOR dem update damit pirepId-context erhalten bleibt.
  console.log(
    `[practical-exam] instructor=${input.instructorId} FAILED enrollment=${input.enrollmentId} ` +
      `pirep=${enrollment.practicalExamPirepId}: ${input.reason}`,
  );

  return db.flightSchoolEnrollment.update({
    where: { id: input.enrollmentId },
    data: {
      practicalExamPirepId: null,
      practicalExamAttempts: { increment: 1 },
      // status bleibt EXAM_SCHEDULED — retry erlaubt
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Read-helpers (instructor-queue)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Filter für die instructor-review-queue. Default: alle airlines,
 * aktive enrollments mit zugewiesenem PIREP.
 */
export interface AwaitingReviewFilters {
  /** Nur enrollments dieser airline (filter via user.airlineId). NULL = alle. */
  airlineId?: string | null;
  /** Filter nach license-typ. NULL = alle. */
  licenseType?: LicenseType | null;
}

/**
 * Liefert enrollments die im EXAM_SCHEDULED-state sind UND einen
 * practicalExamPirepId zugewiesen haben. Das ist die queue für
 * instructor-review.
 *
 * Includes user + school + zugewiesenen PIREP für UI-rendering.
 * Sortiert by updatedAt-DESC damit zuletzt assigned-PIREPs oben sind.
 *
 * Bewusst KEIN paging im MVP — die queue sollte selten > ~20 entries
 * haben weil instructors regelmäßig durch reviews gehen.
 */
export async function listEnrollmentsAwaitingPracticalReview(
  filters: AwaitingReviewFilters = {},
  db: DbClient = prisma,
) {
  const where: Prisma.FlightSchoolEnrollmentWhereInput = {
    status: "EXAM_SCHEDULED",
    practicalExamPirepId: { not: null },
  };
  if (filters.airlineId) {
    where.user = { airlineId: filters.airlineId };
  }
  if (filters.licenseType) {
    where.licenseType = filters.licenseType;
  }

  return db.flightSchoolEnrollment.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          discordId: true,
          airlineId: true,
        },
      },
      school: {
        select: { id: true, name: true, airportIcao: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}
