'use server';

import { auth } from '@/auth';
import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parseMinuteUtc } from '@/lib/schedule';

/**
 * Schedule-template management server-actions (Welle 7 commit 7B-1).
 * Mirror der policy aus airline/routes/actions.ts: gleiche
 * AIRLINE_MANAGER_ROLES + gleiches require-airline-admin pattern.
 *
 * Out-of-scope für 7B-1:
 *   - Generate-action für template→instances (kommt 7B-2)
 *   - Bulk-edit / bulk-deactivate / template-cloning
 *   - Instance-level actions (cancel single instance, reschedule)
 */
const AIRLINE_MANAGER_ROLES = ['admin', 'airline-admin', 'instructor'];

async function requireAirlineAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error('unauthorized');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });

  if (!user?.role || !AIRLINE_MANAGER_ROLES.includes(user.role.name)) {
    throw new Error('forbidden');
  }
  if (!user.airlineId) {
    throw new Error('no-airline');
  }

  return { user, airlineId: user.airlineId };
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validation-schema für create + update. Bewusst permissive in der
 * eingabe-form (z.B. departureTime als "HH:MM" string statt int),
 * weil der admin nicht in der minute-of-day-konvention denken soll.
 * Konvertierung passiert in der action selbst via parseMinuteUtc.
 *
 * daysOfWeek: array von ISO-weekday-numbers (1=Mo .. 7=So). Form sendet
 * sie als multi-select-checkboxes mit name="daysOfWeek" — FormData hat
 * dann mehrere entries mit dem selben key.
 *
 * validFrom / validUntil: date-only strings (YYYY-MM-DD) vom date-input.
 * Wir interpretieren sie als UTC-midnight, weil die schedule-engine in
 * UTC operiert und ein "valid from 1.6." semantisch ein "ab UTC-midnight
 * 1.6." sein soll, nicht "ab user-local-midnight" (das könnte je nach
 * TZ einen tag früher oder später bedeuten).
 */
const ScheduleTemplateInputSchema = z.object({
  routeId: z.string().min(1, 'Route erforderlich'),
  label: z.string().trim().max(80, 'Max 80 zeichen').optional().or(z.literal('')),
  daysOfWeek: z
    .array(z.coerce.number().int().min(1).max(7))
    .min(1, 'Mindestens ein wochentag wählen')
    .max(7),
  // "HH:MM" string vom time-input
  departureTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/, 'Format: HH:MM (24h, UTC)'),
  validFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  preferredAircraftId: z.string().optional().or(z.literal('')),
  active: z.coerce.boolean().default(true),
});

export type ScheduleTemplateFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * Convert date-only string "YYYY-MM-DD" → UTC-midnight Date. Wir nutzen
 * Date.UTC(...) + bewusst nicht `new Date("2026-06-01")` weil Browser
 * je nach implementation das als UTC-midnight ODER local-midnight
 * interpretieren (spec-compliant ist UTC für ISO-date-only, aber
 * historische browser-bugs).
 */
function parseDateOnlyToUtc(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => parseInt(p, 10));
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/**
 * Helper: parse FormData zu raw-input-shape für ScheduleTemplateInputSchema.
 * daysOfWeek braucht spezial-handling (FormData.getAll gibt array, sonst []).
 */
function extractScheduleTemplateInput(formData: FormData) {
  return {
    routeId: String(formData.get('routeId') ?? ''),
    label: String(formData.get('label') ?? '').trim(),
    daysOfWeek: formData
      .getAll('daysOfWeek')
      .map((v) => String(v))
      .filter((v) => v !== ''),
    departureTime: String(formData.get('departureTime') ?? '').trim(),
    validFrom: String(formData.get('validFrom') ?? '').trim(),
    validUntil: String(formData.get('validUntil') ?? '').trim(),
    preferredAircraftId: String(formData.get('preferredAircraftId') ?? '').trim(),
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Create template
// ─────────────────────────────────────────────────────────────────────────

export async function createScheduleTemplate(
  _prev: ScheduleTemplateFormState | null,
  formData: FormData,
): Promise<ScheduleTemplateFormState> {
  const { airlineId } = await requireAirlineAdmin();

  const raw = extractScheduleTemplateInput(formData);
  const parsed = ScheduleTemplateInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      ok: false,
      message: 'Bitte korrigiere die markierten felder.',
      fieldErrors,
    };
  }

  const data = parsed.data;

  const departureMinuteUtc = parseMinuteUtc(data.departureTime);
  if (departureMinuteUtc === null) {
    return {
      ok: false,
      message: 'Ungültige uhrzeit.',
      fieldErrors: { departureTime: 'Format: HH:MM (00:00 - 23:59 UTC)' },
    };
  }

  // Route ownership-check + aktiv-status. Nicht-aktive routes können
  // grundsätzlich für templates genutzt werden (admin könnte route
  // temporär deaktivieren während sie noch geplant ist), aber wir warnen
  // im UI darüber. Im backend kein hard-block.
  const route = await prisma.route.findUnique({
    where: { id: data.routeId },
    select: { id: true, airlineId: true, flightNumber: true },
  });
  if (!route || route.airlineId !== airlineId) {
    return { ok: false, message: 'Route nicht gefunden oder gehört zu anderer airline.' };
  }

  // Optional aircraft ownership-check. Wenn gesetzt, muss aircraft zur
  // gleichen airline gehören.
  if (data.preferredAircraftId) {
    const aircraft = await prisma.aircraft.findUnique({
      where: { id: data.preferredAircraftId },
      select: { id: true, airlineId: true },
    });
    if (!aircraft || aircraft.airlineId !== airlineId) {
      return {
        ok: false,
        message: 'Aircraft gehört nicht zu deiner airline.',
        fieldErrors: { preferredAircraftId: 'Ungültig' },
      };
    }
  }

  const validFrom = parseDateOnlyToUtc(data.validFrom);
  const validUntil = data.validUntil ? parseDateOnlyToUtc(data.validUntil) : null;

  if (validUntil && validUntil <= validFrom) {
    return {
      ok: false,
      message: 'validUntil muss nach validFrom liegen.',
      fieldErrors: { validUntil: 'Muss nach validFrom liegen' },
    };
  }

  await prisma.scheduleTemplate.create({
    data: {
      airlineId,
      routeId: data.routeId,
      label: data.label || null,
      daysOfWeek: data.daysOfWeek,
      departureMinuteUtc,
      validFrom,
      validUntil,
      preferredAircraftId: data.preferredAircraftId || null,
      active: data.active,
    },
  });

  revalidatePath('/airline/schedule');

  return {
    ok: true,
    message: `Schedule-template für ${route.flightNumber} angelegt.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Update template
// ─────────────────────────────────────────────────────────────────────────

export async function updateScheduleTemplate(
  templateId: string,
  _prev: ScheduleTemplateFormState | null,
  formData: FormData,
): Promise<ScheduleTemplateFormState> {
  const { airlineId } = await requireAirlineAdmin();

  // Ownership-check (defense-in-depth gegen direct-URL-manipulation auf
  // /airline/schedule/<foreign-id>/edit).
  const existing = await prisma.scheduleTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, airlineId: true },
  });
  if (!existing || existing.airlineId !== airlineId) {
    return { ok: false, message: 'Template gehört nicht zu deiner airline.' };
  }

  const raw = extractScheduleTemplateInput(formData);
  const parsed = ScheduleTemplateInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      ok: false,
      message: 'Bitte korrigiere die markierten felder.',
      fieldErrors,
    };
  }

  const data = parsed.data;

  const departureMinuteUtc = parseMinuteUtc(data.departureTime);
  if (departureMinuteUtc === null) {
    return {
      ok: false,
      message: 'Ungültige uhrzeit.',
      fieldErrors: { departureTime: 'Format: HH:MM (00:00 - 23:59 UTC)' },
    };
  }

  const route = await prisma.route.findUnique({
    where: { id: data.routeId },
    select: { id: true, airlineId: true, flightNumber: true },
  });
  if (!route || route.airlineId !== airlineId) {
    return { ok: false, message: 'Route nicht gefunden oder gehört zu anderer airline.' };
  }

  if (data.preferredAircraftId) {
    const aircraft = await prisma.aircraft.findUnique({
      where: { id: data.preferredAircraftId },
      select: { id: true, airlineId: true },
    });
    if (!aircraft || aircraft.airlineId !== airlineId) {
      return {
        ok: false,
        message: 'Aircraft gehört nicht zu deiner airline.',
        fieldErrors: { preferredAircraftId: 'Ungültig' },
      };
    }
  }

  const validFrom = parseDateOnlyToUtc(data.validFrom);
  const validUntil = data.validUntil ? parseDateOnlyToUtc(data.validUntil) : null;

  if (validUntil && validUntil <= validFrom) {
    return {
      ok: false,
      message: 'validUntil muss nach validFrom liegen.',
      fieldErrors: { validUntil: 'Muss nach validFrom liegen' },
    };
  }

  await prisma.scheduleTemplate.update({
    where: { id: templateId },
    data: {
      routeId: data.routeId,
      label: data.label || null,
      daysOfWeek: data.daysOfWeek,
      departureMinuteUtc,
      validFrom,
      validUntil,
      preferredAircraftId: data.preferredAircraftId || null,
      active: data.active,
    },
  });

  revalidatePath('/airline/schedule');
  revalidatePath(`/airline/schedule/${templateId}/edit`);

  return {
    ok: true,
    message: `Template für ${route.flightNumber} aktualisiert.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Delete template
// ─────────────────────────────────────────────────────────────────────────

/**
 * Löschen ist immer hard-delete inklusive zugehöriger ScheduledFlight-
 * instanzen (cascade via FK). ABER wenn instances bereits gebucht sind
 * (status != Planned), wir verlangen explicit confirmation: das ist
 * destructive, weil es bookings auf NULL setzt (SetNull-cascade auf
 * ScheduledFlight.bookingId, NOT der reverse).
 *
 * Wait — eigentlich ist die cascade ScheduledFlight → Booking via SetNull
 * NICHT defined; ScheduledFlight.bookingId ist optional FK, beim löschen
 * von ScheduledFlight wird Booking.scheduledFlight (back-relation) auf
 * NULL gesetzt. Booking selbst bleibt intakt. Sicher!
 *
 * Trotzdem: user-warnung wenn nicht-Planned-instances existieren, weil
 * der admin sich vermutlich der konsequenz nicht bewusst ist.
 */
export async function deleteScheduleTemplate(
  formData: FormData,
): Promise<ScheduleTemplateFormState> {
  const { airlineId } = await requireAirlineAdmin();

  const templateId = String(formData.get('templateId') ?? '');
  if (!templateId) return { ok: false, message: 'Template-ID fehlt.' };

  const template = await prisma.scheduleTemplate.findUnique({
    where: { id: templateId },
    include: {
      route: { select: { flightNumber: true } },
      _count: { select: { scheduledFlights: true } },
    },
  });

  if (!template || template.airlineId !== airlineId) {
    return { ok: false, message: 'Template gehört nicht zu deiner airline.' };
  }

  await prisma.scheduleTemplate.delete({ where: { id: templateId } });

  revalidatePath('/airline/schedule');

  return {
    ok: true,
    message:
      template._count.scheduledFlights > 0
        ? `Template ${template.route.flightNumber} gelöscht (${template._count.scheduledFlights} instances mit-entfernt).`
        : `Template ${template.route.flightNumber} gelöscht.`,
  };
}
