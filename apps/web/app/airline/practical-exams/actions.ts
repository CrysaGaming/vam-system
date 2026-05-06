'use server';

import {
  prisma,
  passPracticalExam,
  failPracticalExam,
} from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Instructor-side practical-exam review actions (Welle 13E-14c).
 *
 * Auth-pattern (kopie von /airline/actions.ts requireAirlineAdmin —
 * NICHT importiert weil dortige function private ist und wir hier
 * dieselbe semantik mit explicit-rename brauchen für klarheit):
 *
 *   1. Session check
 *   2. Role muss in AIRLINE_MANAGER_ROLES sein (admin/airline-admin/
 *      instructor)
 *   3. User muss eine airline haben
 *   4. (zusätzlich pro action): enrollment.user.airlineId === instructor.
 *      airlineId — instructor darf nur enrollments seiner EIGENEN airline
 *      reviewen. Cross-airline-review wäre ein klares scope-violation.
 *
 * Beide actions delegieren an die @vam/db helpers (passPracticalExam,
 * failPracticalExam) die dort die ATOMIC transaction-logic haben:
 *   - pass: $transaction mit grantLicense + enrollment-update
 *   - fail: pirepId=null, attempts+=1, audit-log
 *
 * revalidatePath cleanup deckt drei views ab:
 *   - /airline/practical-exams (queue selbst)
 *   - /flight-schools/[schoolId] (pilot's view auf seinem enrollment-card)
 *   - /licenses (pilot's licenses-page wenn pass → license erscheint)
 */

/**
 * Auth-gate. Returns user + airlineId. Wirft bei: keine session,
 * unzureichende rolle, keine airline-zuordnung.
 */
const requireInstructor = requireAirlineManagerWithAirline;

/**
 * Verifies that the enrollment's pilot belongs to the same airline as the
 * instructor. Returns the enrollment with relevant fields. Wirft wenn
 * enrollment nicht existiert oder cross-airline-zugriff versucht wird.
 *
 * Bewusst NICHT in den helper-aufruf eingebaut weil der helper auch von
 * system-admins oder auto-pass-flows (zukünftig) genutzt werden könnte
 * ohne airline-scope. Server-action ist die richtige stelle für diesen
 * scope-check.
 */
async function requireOwnedEnrollment(
  enrollmentId: string,
  instructorAirlineId: string,
) {
  const enrollment = await prisma.flightSchoolEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      schoolId: true,
      user: { select: { id: true, airlineId: true } },
    },
  });
  if (!enrollment) {
    throw new Error('Enrollment nicht gefunden.');
  }
  if (enrollment.user.airlineId !== instructorAirlineId) {
    // Bewusst generischer error statt detailliert — verhindert info-leak
    // über existence von cross-airline enrollments.
    throw new Error('forbidden');
  }
  return enrollment;
}

// ──────────────────────────────────────────────────────────────────────────
// Pass action
// ──────────────────────────────────────────────────────────────────────────

const PassSchema = z.object({
  enrollmentId: z.string().min(1),
  // Optional notes für die license (z.B. "exzellente performance, alle
  // maneuver präzise"). Wird in license.notes appended ans default-template.
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Instructor markiert prüfung als bestanden. Helper macht ATOMIC
 * transaction: status → PASSED, license issued, resultingLicenseId
 * gesetzt. Bei P2002 (license existiert schon) wirft der helper und
 * der ganze block rollback'd — UI zeigt error.
 */
export async function passPracticalExamAction(input: z.infer<typeof PassSchema>) {
  const parsed = PassSchema.parse(input);
  const { user, airlineId } = await requireInstructor();
  const enrollment = await requireOwnedEnrollment(parsed.enrollmentId, airlineId);

  await passPracticalExam({
    enrollmentId: parsed.enrollmentId,
    instructorId: user.id,
    notes: parsed.notes ?? null,
  });

  revalidatePath('/airline/practical-exams');
  revalidatePath(`/flight-schools/${enrollment.schoolId}`);
  revalidatePath('/licenses');
}

// ──────────────────────────────────────────────────────────────────────────
// Fail action
// ──────────────────────────────────────────────────────────────────────────

const FailSchema = z.object({
  enrollmentId: z.string().min(1),
  // Reason ist required (audit-trail). Helper wirft sonst.
  reason: z.string().trim().min(3).max(500),
});

/**
 * Instructor markiert prüfung als nicht-bestanden. Helper macht:
 * pirepId=null (pilot kann neuen flug zuweisen), attempts+=1, console-
 * audit-log mit reason. Status bleibt EXAM_SCHEDULED — retry erlaubt.
 *
 * Reason-min-length 3 chars verhindert leere/tippfehler-reasons. Max 500
 * passt zu typischen feedback-texten ohne missbrauch zu erlauben.
 */
export async function failPracticalExamAction(input: z.infer<typeof FailSchema>) {
  const parsed = FailSchema.parse(input);
  const { user, airlineId } = await requireInstructor();
  const enrollment = await requireOwnedEnrollment(parsed.enrollmentId, airlineId);

  await failPracticalExam({
    enrollmentId: parsed.enrollmentId,
    instructorId: user.id,
    reason: parsed.reason,
  });

  revalidatePath('/airline/practical-exams');
  revalidatePath(`/flight-schools/${enrollment.schoolId}`);
}
