'use server';

import { prisma, TypeRatingExamStatus } from '@vam/db';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Track 4 #91 (Section R) — TypeRatingExam server-actions.
 *
 * Auth: AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor).
 * Multi-tenant: alle queries gegen airlineId gescoped.
 *
 * Action-surface:
 *   - scheduleTypeRatingExam:  neuer SCHEDULED exam für pilot+aircraftType
 *   - markExamPassed:          PASSED + create TypeRating record
 *   - markExamFailed:          FAILED + optionale result-notes
 *   - cancelExam:              CANCELLED (vor durchführung)
 *   - markExamNoShow:          NO_SHOW (pilot nicht erschienen)
 *   - rescheduleExam:          ändert scheduledFor (nur bei SCHEDULED)
 *   - deleteExam:              hard-delete (nur wenn status != PASSED, weil
 *                              PASSED hat ein TypeRating dahinter)
 */
const requireAdmin = requireAirlineManagerWithAirline;

// ─────────────────────────────────────────────────────────────────────────
// Schedule new exam
// ─────────────────────────────────────────────────────────────────────────

const ScheduleSchema = z.object({
  userId: z.string().min(1, 'Pilot fehlt'),
  aircraftType: z
    .string()
    .min(2, 'Aircraft-Type zu kurz')
    .max(8, 'Aircraft-Type zu lang')
    .regex(/^[A-Z0-9]+$/, 'Nur A-Z und 0-9 erlaubt')
    .transform((s) => s.toUpperCase()),
  scheduledFor: z.string().min(1, 'Datum fehlt'), // ISO-string from <input type=datetime-local>
  examinerId: z.string().optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export async function scheduleTypeRatingExam(formData: FormData) {
  const { airlineId } = await requireAdmin();

  const parsed = ScheduleSchema.safeParse({
    userId: String(formData.get('userId') ?? '').trim(),
    aircraftType: String(formData.get('aircraftType') ?? '').trim(),
    scheduledFor: String(formData.get('scheduledFor') ?? '').trim(),
    examinerId: String(formData.get('examinerId') ?? '').trim() || undefined,
    notes: String(formData.get('notes') ?? '').trim() || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Ungültige Eingabe');
  }

  // Parse datetime-local string. Browser submits "2026-05-15T14:30" (local
  // time, no timezone). Wir treat das als local-time-of-server.
  const scheduledAt = new Date(parsed.data.scheduledFor);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error('Datum konnte nicht geparsed werden.');
  }

  // Multi-tenant: pilot muss in der gleichen airline sein.
  const pilot = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, airlineId: true, name: true, email: true },
  });
  if (!pilot || pilot.airlineId !== airlineId) {
    throw new Error('Pilot nicht gefunden.');
  }

  // Examiner-check (falls gesetzt): muss in selber airline sein. Wir
  // verifizieren NICHT dass er eine TRE-license hat — admin-flexibility
  // (er könnte auch ein external examiner sein, hier nur reference).
  if (parsed.data.examinerId) {
    const examiner = await prisma.user.findUnique({
      where: { id: parsed.data.examinerId },
      select: { id: true, airlineId: true },
    });
    if (!examiner || examiner.airlineId !== airlineId) {
      throw new Error('Examiner nicht gefunden.');
    }
  }

  // Duplicate-check: pro pilot+aircraftType max 1 active SCHEDULED exam.
  // App-layer-check weil postgres-partial-unique-indexes schwierig sind
  // in prisma's @@unique zu modellieren.
  const existingActive = await prisma.typeRatingExam.findFirst({
    where: {
      userId: parsed.data.userId,
      aircraftType: parsed.data.aircraftType,
      status: 'SCHEDULED',
    },
    select: { id: true, scheduledFor: true },
  });
  if (existingActive) {
    throw new Error(`Es gibt bereits einen scheduled exam für ${pilot.name ?? pilot.email} auf ${parsed.data.aircraftType} am ${existingActive.scheduledFor.toLocaleString('de-DE')}. Erst cancel oder reschedule.`);
  }

  // Pilot kann auch schon einen active TypeRating für diesen type haben.
  // Wir lassen das durch (use-case: recurrent-check für expiring rating)
  // aber wir geben dem admin einen hint im success-flow falls relevant.

  await prisma.typeRatingExam.create({
    data: {
      userId: parsed.data.userId,
      airlineId,
      aircraftType: parsed.data.aircraftType,
      scheduledFor: scheduledAt,
      examinerId: parsed.data.examinerId || null,
      notes: parsed.data.notes || null,
      status: 'SCHEDULED',
    },
  });

  revalidatePath('/airline/exams/type-ratings');
  return;
}

// ─────────────────────────────────────────────────────────────────────────
// Mark exam passed → creates TypeRating
// ─────────────────────────────────────────────────────────────────────────

const MarkPassedSchema = z.object({
  examId: z.string().min(1),
  /** Recurrent-cycle in monaten (default 12, EASA-standard) */
  validForMonths: z.coerce.number().int().min(1).max(36).default(12),
  resultNotes: z.string().max(2000).optional().or(z.literal('')),
});

export async function markExamPassed(formData: FormData) {
  const { airlineId, user: actor } = await requireAdmin();
  const actorId = actor.id;

  const parsed = MarkPassedSchema.safeParse({
    examId: String(formData.get('examId') ?? ''),
    validForMonths: formData.get('validForMonths') ?? 12,
    resultNotes: String(formData.get('resultNotes') ?? '').trim() || undefined,
  });
  if (!parsed.success) {
    throw new Error('Ungültige Eingabe');
  }

  const exam = await prisma.typeRatingExam.findUnique({
    where: { id: parsed.data.examId },
    select: {
      id: true,
      airlineId: true,
      userId: true,
      aircraftType: true,
      status: true,
    },
  });
  if (!exam || exam.airlineId !== airlineId) {
    throw new Error('Exam nicht gefunden.');
  }
  if (exam.status !== 'SCHEDULED') {
    throw new Error(`Exam ist bereits ${exam.status}. Nur SCHEDULED kann auf PASSED.`);
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + parsed.data.validForMonths);

  // Transaktional: TypeRating up-sert + Exam update.
  // Upsert weil pilot evtl. schon einen TypeRating für diesen aircraft-type
  // hat (recurrent-check) — dann verlängern wir expiresAt + hoursOnType
  // bleibt. Bei initial-rating wird neu erzeugt.
  await prisma.$transaction(async (tx) => {
    const rating = await tx.typeRating.upsert({
      where: {
        userId_aircraftType: {
          userId: exam.userId,
          aircraftType: exam.aircraftType,
        },
      },
      create: {
        userId: exam.userId,
        aircraftType: exam.aircraftType,
        obtainedAt: now,
        expiresAt,
        hoursOnType: 0,
        issuedById: actorId,
      },
      update: {
        // Recurrent: nur expiresAt verlängern, history (obtainedAt,
        // hoursOnType, lastFlownAt) bleibt erhalten.
        expiresAt,
        issuedById: actorId,
      },
      select: { id: true },
    });

    await tx.typeRatingExam.update({
      where: { id: exam.id },
      data: {
        status: 'PASSED',
        completedAt: now,
        typeRatingId: rating.id,
        resultNotes: parsed.data.resultNotes || null,
      },
    });
  });

  revalidatePath('/airline/exams/type-ratings');
  revalidatePath(`/airline/pilots/${exam.userId}`);
  revalidatePath(`/airline/pilots/${exam.userId}/skill-tree`);
  return;
}

// ─────────────────────────────────────────────────────────────────────────
// Mark exam failed / cancelled / no-show
// ─────────────────────────────────────────────────────────────────────────

const TerminalUpdateSchema = z.object({
  examId: z.string().min(1),
  status: z.enum(['FAILED', 'CANCELLED', 'NO_SHOW']),
  resultNotes: z.string().max(2000).optional().or(z.literal('')),
});

export async function setExamTerminalStatus(formData: FormData) {
  const { airlineId } = await requireAdmin();

  const parsed = TerminalUpdateSchema.safeParse({
    examId: String(formData.get('examId') ?? ''),
    status: String(formData.get('status') ?? ''),
    resultNotes: String(formData.get('resultNotes') ?? '').trim() || undefined,
  });
  if (!parsed.success) {
    throw new Error('Ungültige Eingabe');
  }

  const exam = await prisma.typeRatingExam.findUnique({
    where: { id: parsed.data.examId },
    select: { id: true, airlineId: true, status: true, userId: true },
  });
  if (!exam || exam.airlineId !== airlineId) {
    throw new Error('Exam nicht gefunden.');
  }
  if (exam.status !== 'SCHEDULED') {
    throw new Error(`Exam ist bereits ${exam.status}. Nur SCHEDULED kann verändert werden.`);
  }

  await prisma.typeRatingExam.update({
    where: { id: exam.id },
    data: {
      status: parsed.data.status as TypeRatingExamStatus,
      completedAt: new Date(),
      resultNotes: parsed.data.resultNotes || null,
    },
  });

  revalidatePath('/airline/exams/type-ratings');
  revalidatePath(`/airline/pilots/${exam.userId}`);
  return;
}

// ─────────────────────────────────────────────────────────────────────────
// Reschedule (change scheduledFor)
// ─────────────────────────────────────────────────────────────────────────

const RescheduleSchema = z.object({
  examId: z.string().min(1),
  scheduledFor: z.string().min(1),
});

export async function rescheduleExam(formData: FormData) {
  const { airlineId } = await requireAdmin();

  const parsed = RescheduleSchema.safeParse({
    examId: String(formData.get('examId') ?? ''),
    scheduledFor: String(formData.get('scheduledFor') ?? '').trim(),
  });
  if (!parsed.success) {
    throw new Error('Ungültige Eingabe');
  }

  const newDate = new Date(parsed.data.scheduledFor);
  if (Number.isNaN(newDate.getTime())) {
    throw new Error('Datum ungültig.');
  }

  const exam = await prisma.typeRatingExam.findUnique({
    where: { id: parsed.data.examId },
    select: { id: true, airlineId: true, status: true },
  });
  if (!exam || exam.airlineId !== airlineId) {
    throw new Error('Exam nicht gefunden.');
  }
  if (exam.status !== 'SCHEDULED') {
    throw new Error('Nur SCHEDULED exams können umgeplant werden.');
  }

  await prisma.typeRatingExam.update({
    where: { id: exam.id },
    data: { scheduledFor: newDate },
  });

  revalidatePath('/airline/exams/type-ratings');
  return;
}

// ─────────────────────────────────────────────────────────────────────────
// Delete exam (hard-delete, only for non-PASSED)
// ─────────────────────────────────────────────────────────────────────────

export async function deleteExam(formData: FormData) {
  const { airlineId } = await requireAdmin();
  const examId = String(formData.get('examId') ?? '');
  if (!examId) throw new Error('Exam-ID fehlt.');

  const exam = await prisma.typeRatingExam.findUnique({
    where: { id: examId },
    select: { id: true, airlineId: true, status: true },
  });
  if (!exam || exam.airlineId !== airlineId) {
    throw new Error('Exam nicht gefunden.');
  }
  if (exam.status === 'PASSED') {
    throw new Error('PASSED exams können nicht gelöscht werden — sie sind audit-trail für den TypeRating.');
  }

  await prisma.typeRatingExam.delete({ where: { id: exam.id } });

  revalidatePath('/airline/exams/type-ratings');
  return;
}
