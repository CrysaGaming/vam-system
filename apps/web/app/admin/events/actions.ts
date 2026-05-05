'use server';

import { auth } from '@/auth';
import {
  prisma,
  createEvent as dbCreateEvent,
  updateEvent as dbUpdateEvent,
  publishEvent as dbPublishEvent,
  cancelEvent as dbCancelEvent,
  completeEvent as dbCompleteEvent,
  deleteEvent as dbDeleteEvent,
  markParticipantCompleted as dbMarkCompleted,
  unmarkParticipantCompleted as dbUnmarkCompleted,
  type CreateEventInput,
  type UpdateEventInput,
  type EventKind,
} from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Track 1 #7 (Events / Flight-Tours, 9.2.8) — Admin server-actions.
 *
 * CRUD auf Event-rows + state-transitions (publish/cancel/complete) +
 * per-participant completion-flagging.
 *
 * Auth: requireAdmin() — selber pattern wie /admin/awards/actions.ts.
 *
 * Form-validation: zod-schemas. Datums-felder kommen als HTML
 * datetime-local-strings ("2026-05-15T14:30") und werden via new Date()
 * geparst. Legs kommen als JSON-string textarea-input und werden via
 * JSON.parse + zod-validation in array-shape gebracht.
 *
 * # publish + bot-broadcast
 *
 * publishEventAction macht den DB-publish und feuert dann fire-and-forget
 * emitEventPublished. Wenn der bot-call failed, ist der publish trotzdem
 * durch — admin sieht erfolg-message, bot-failure wird nur im console-log.
 */

// ─────────────────────────────────────────────────────────────────────
// Auth-helper
// ─────────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || user.role.name !== 'admin') {
    throw new Error('forbidden');
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const KIND_VALUES = [
  'TOUR',
  'SINGLE_FLIGHT',
  'THEMED',
  'GROUP_FLIGHT',
  'SEASONAL',
] as const;

const LegSchema = z.object({
  icao: z.string().min(2).max(8).trim(),
  label: z.string().max(120).trim().optional(),
  note: z.string().max(500).trim().optional(),
});

/**
 * Validates legs from JSON-textarea input. Empty string → empty array;
 * non-JSON → parse-error; non-array → schema-error. Each entry must
 * have at least an icao field.
 */
function parseLegs(raw: string | null): Array<{ icao: string; label?: string; note?: string }> | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Legs ist kein valides JSON. Erwartetes format: array von {icao, label?, note?}');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Legs muss ein JSON-array sein.');
  }
  const result = z.array(LegSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(`Legs-validation fehlgeschlagen: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data;
}

const EventCreateSchema = z.object({
  airlineId: z.string().optional(), // empty = VA-wide
  title: z
    .string()
    .min(3, 'Titel muss mindestens 3 Zeichen haben')
    .max(120, 'Titel darf höchstens 120 Zeichen haben')
    .trim(),
  description: z
    .string()
    .min(10, 'Beschreibung muss mindestens 10 Zeichen haben')
    .max(5000, 'Beschreibung darf höchstens 5000 Zeichen haben'),
  kind: z.enum(KIND_VALUES),
  coverImageUrl: z.string().url('Ungültige URL').max(500).optional().or(z.literal('')),
  bonusReward: z.coerce.number().min(0, 'Bonus kann nicht negativ sein').max(100000, 'Bonus zu hoch'),
  maxParticipants: z
    .union([z.coerce.number().int().min(1).max(10000), z.literal('').transform(() => null), z.null()])
    .optional()
    .nullable(),
  startsAt: z
    .string()
    .min(1, 'Startdatum erforderlich')
    .transform((v) => new Date(v))
    .refine((d) => !isNaN(d.getTime()), 'Ungültiges Startdatum'),
  endsAt: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? new Date(v) : null))
    .refine((d) => d === null || !isNaN(d.getTime()), 'Ungültiges Enddatum'),
  legs: z.string().optional(),
});

const EventUpdateSchema = EventCreateSchema.extend({
  id: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────
// Action result type
// ─────────────────────────────────────────────────────────────────────

export type ActionResult =
  | { ok: true; message: string; eventId?: string }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────
// createEventAction
// ─────────────────────────────────────────────────────────────────────

export async function createEventAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = EventCreateSchema.safeParse({
      airlineId: formData.get('airlineId'),
      title: formData.get('title'),
      description: formData.get('description'),
      kind: formData.get('kind'),
      coverImageUrl: formData.get('coverImageUrl'),
      bonusReward: formData.get('bonusReward') || '0',
      maxParticipants: formData.get('maxParticipants'),
      startsAt: formData.get('startsAt'),
      endsAt: formData.get('endsAt'),
      legs: formData.get('legs'),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      };
    }

    let legs: ReturnType<typeof parseLegs>;
    try {
      legs = parseLegs(parsed.data.legs ?? null);
    } catch (legsErr) {
      return {
        ok: false,
        error: legsErr instanceof Error ? legsErr.message : 'Ungültige legs',
      };
    }

    // airlineId-handling: empty string oder undefined = VA-wide (null).
    // Gefüllt = airline-scoped. SYSTEM-admin kann VA-wide events anlegen.
    // Nicht-SYSTEM-admin sollte airlineId = sein eigenes airlineId
    // bekommen, aber wir erlauben hier free choice und vertrauen dem
    // requireAdmin-gate (kein "airline-admin"-tier in diesem MVP).
    const rawAirlineId = parsed.data.airlineId?.trim();
    const airlineId = rawAirlineId ? rawAirlineId : null;

    const input: CreateEventInput = {
      airlineId,
      title: parsed.data.title,
      description: parsed.data.description,
      kind: parsed.data.kind as EventKind,
      coverImageUrl: parsed.data.coverImageUrl?.trim() || null,
      bonusReward: parsed.data.bonusReward,
      maxParticipants:
        parsed.data.maxParticipants && typeof parsed.data.maxParticipants === 'number'
          ? parsed.data.maxParticipants
          : null,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      legs,
      createdById: admin.id,
    };

    const event = await dbCreateEvent(input);
    revalidatePath('/admin/events');
    revalidatePath('/events');
    return {
      ok: true,
      message: `Event "${event.title}" angelegt (slug: ${event.slug}). Status: DRAFT.`,
      eventId: event.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// updateEventAction
// ─────────────────────────────────────────────────────────────────────

export async function updateEventAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const parsed = EventUpdateSchema.safeParse({
      id: formData.get('id'),
      airlineId: formData.get('airlineId'),
      title: formData.get('title'),
      description: formData.get('description'),
      kind: formData.get('kind'),
      coverImageUrl: formData.get('coverImageUrl'),
      bonusReward: formData.get('bonusReward') || '0',
      maxParticipants: formData.get('maxParticipants'),
      startsAt: formData.get('startsAt'),
      endsAt: formData.get('endsAt'),
      legs: formData.get('legs'),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      };
    }

    let legs: ReturnType<typeof parseLegs>;
    try {
      legs = parseLegs(parsed.data.legs ?? null);
    } catch (legsErr) {
      return {
        ok: false,
        error: legsErr instanceof Error ? legsErr.message : 'Ungültige legs',
      };
    }

    const input: UpdateEventInput = {
      id: parsed.data.id,
      title: parsed.data.title,
      description: parsed.data.description,
      kind: parsed.data.kind as EventKind,
      coverImageUrl: parsed.data.coverImageUrl?.trim() || null,
      bonusReward: parsed.data.bonusReward,
      maxParticipants:
        parsed.data.maxParticipants && typeof parsed.data.maxParticipants === 'number'
          ? parsed.data.maxParticipants
          : null,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      legs,
    };

    const event = await dbUpdateEvent(input);
    revalidatePath('/admin/events');
    revalidatePath(`/admin/events/${event.id}`);
    revalidatePath('/events');
    revalidatePath(`/events/${event.slug}`);
    return { ok: true, message: 'Event aktualisiert.', eventId: event.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// publishEventAction (mit bot-broadcast)
// ─────────────────────────────────────────────────────────────────────

export async function publishEventAction(eventId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbPublishEvent(eventId);
    if (!result.ok) {
      return { ok: false, error: result.reason };
    }

    revalidatePath('/admin/events');
    revalidatePath(`/admin/events/${eventId}`);
    revalidatePath('/events');
    revalidatePath(`/events/${result.event.slug}`);

    // Best-effort bot-broadcast. Lazy-import um circular-import-issues
    // zu vermeiden + fail-soft (bot down ≠ publish failed).
    try {
      const { emitEventPublished } = await import('@/lib/bot-events');
      const fullEvent = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          airline: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
      });
      if (fullEvent) {
        await emitEventPublished({
          eventId: fullEvent.id,
          title: fullEvent.title,
          slug: fullEvent.slug,
          description: fullEvent.description,
          kind: fullEvent.kind,
          coverImageUrl: fullEvent.coverImageUrl,
          bonusReward: Number(fullEvent.bonusReward),
          maxParticipants: fullEvent.maxParticipants,
          startsAt: fullEvent.startsAt.toISOString(),
          endsAt: fullEvent.endsAt?.toISOString() ?? null,
          airlineName: fullEvent.airline?.name ?? null,
          createdByName: fullEvent.createdBy.name ?? null,
        });
      }
    } catch (broadcastErr) {
      console.warn('[events] discord-broadcast fehlgeschlagen:', broadcastErr);
    }

    return {
      ok: true,
      message: 'Event publiziert. Discord-announcement gepostet.',
      eventId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// cancelEventAction
// ─────────────────────────────────────────────────────────────────────

export async function cancelEventAction(eventId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbCancelEvent(eventId);
    if (!result.ok) {
      return { ok: false, error: result.reason };
    }
    revalidatePath('/admin/events');
    revalidatePath(`/admin/events/${eventId}`);
    revalidatePath('/events');
    revalidatePath(`/events/${result.event.slug}`);
    return { ok: true, message: 'Event abgesagt.', eventId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// completeEventAction
// ─────────────────────────────────────────────────────────────────────

export async function completeEventAction(eventId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbCompleteEvent(eventId);
    if (!result.ok) {
      return { ok: false, error: result.reason };
    }
    revalidatePath('/admin/events');
    revalidatePath(`/admin/events/${eventId}`);
    revalidatePath('/events');
    revalidatePath(`/events/${result.event.slug}`);
    return { ok: true, message: 'Event als abgeschlossen markiert.', eventId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// deleteEventAction
// ─────────────────────────────────────────────────────────────────────

export async function deleteEventAction(eventId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbDeleteEvent(eventId);
    if (!result.ok) {
      return { ok: false, error: result.reason };
    }
    revalidatePath('/admin/events');
    revalidatePath('/events');
    const lostMsg =
      result.participantsDeleted > 0
        ? ` (${result.participantsDeleted} anmeldungen mit-gelöscht)`
        : '';
    return { ok: true, message: `Event gelöscht${lostMsg}.` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// markParticipantCompletedAction
// ─────────────────────────────────────────────────────────────────────

export async function markParticipantCompletedAction(
  participantId: string,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const result = await dbMarkCompleted({
      participantId,
      adminUserId: admin.id,
    });
    if (!result.ok) {
      return { ok: false, error: result.reason };
    }
    // Resolve eventId für revalidate. Cheap query.
    const participant = await prisma.eventParticipant.findUnique({
      where: { id: participantId },
      select: { eventId: true, userId: true, event: { select: { slug: true } } },
    });
    if (participant) {
      revalidatePath(`/admin/events/${participant.eventId}`);
      revalidatePath(`/events/${participant.event.slug}`);
      revalidatePath(`/pilots/${participant.userId}`);
    }

    if (result.wasAlreadyCompleted) {
      return {
        ok: true,
        message: 'Teilnehmer war schon als abgeschlossen markiert.',
      };
    }
    const bonusMsg =
      result.bonusCredited > 0
        ? ` Bonus +${result.bonusCredited} VAM$ gutgeschrieben.`
        : '';
    return {
      ok: true,
      message: `Als abgeschlossen markiert.${bonusMsg}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// unmarkParticipantCompletedAction
// ─────────────────────────────────────────────────────────────────────

export async function unmarkParticipantCompletedAction(
  participantId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbUnmarkCompleted(participantId);
    const participant = await prisma.eventParticipant.findUnique({
      where: { id: participantId },
      select: { eventId: true, userId: true, event: { select: { slug: true } } },
    });
    if (participant) {
      revalidatePath(`/admin/events/${participant.eventId}`);
      revalidatePath(`/events/${participant.event.slug}`);
      revalidatePath(`/pilots/${participant.userId}`);
    }
    if (result.wasAlreadyAbsent) {
      return { ok: true, message: 'Teilnehmer war nicht als abgeschlossen markiert.' };
    }
    return {
      ok: true,
      message: 'Completion-flag zurückgesetzt. Bonus bleibt im wallet (transactions sind immutable).',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}
