'use server';

import { prisma, Prisma, type EventKind } from '@vam/db';
import { requireAdmin } from '@/lib/roles';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

/**
 * Track 4 #98 (Section S) — EventTemplate server-actions.
 *
 * Auth: requireAdmin().
 * Multi-tenant: alle queries airlineId-gescoped auf admin.airlineId.
 *
 * Action-surface:
 *   - createTemplateAction:      neuer template
 *   - deleteTemplateAction:      hard-delete (verwende EditFlow für updates
 *                                — V1 hat kein update, admin deletes +
 *                                recreates wenn nötig)
 *   - spawnEventFromTemplateAction:  erzeugt new DRAFT-event mit pre-
 *                                filled fields. Admin setzt danach
 *                                startsAt/endsAt via /admin/events/[id]/edit.
 *
 * Alle return Promise<void> oder redirect; bei errors throw new Error
 * (form-action triggert next.js error-boundary).
 */

const KINDS = ['TOUR', 'SINGLE_FLIGHT', 'THEMED', 'GROUP_FLIGHT', 'SEASONAL'] as const;

const CreateSchema = z.object({
  name: z.string().trim().min(1, 'Template-Name fehlt').max(100),
  title: z.string().trim().min(1, 'Event-Titel fehlt').max(200),
  description: z.string().trim().min(1, 'Beschreibung fehlt').max(5000),
  kind: z.enum(KINDS),
  bonusReward: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.trim() === '') return '0';
      return v.trim();
    })
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Bonus muss eine zahl sein (max 2 dezimalstellen)'),
  maxParticipants: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.trim() === '') return null;
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n < 1) return null;
      return n;
    }),
  legsRaw: z.string().optional(),
});

/**
 * Parse legs-text-input → JSON-array.
 * Format: jede zeile "ICAO|label|note" — alle felder optional ausser ICAO.
 * Beispiel:
 *   EDDF|Frankfurt|Hub
 *   LFPG|Paris CDG
 *   EHAM
 */
function parseLegs(raw: string | undefined): Array<{
  icao: string;
  label?: string;
  note?: string;
}> {
  if (!raw || raw.trim() === '') return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 20) // cap at 20 legs
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim());
      const icao = parts[0]?.toUpperCase();
      if (!icao || icao.length < 3 || icao.length > 4) {
        throw new Error(
          `Ungültiger leg-eintrag: "${line}". Erwartet "ICAO|label|note" mit 3-4 buchstaben ICAO.`,
        );
      }
      return {
        icao,
        label: parts[1] || undefined,
        note: parts[2] || undefined,
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Create template
// ─────────────────────────────────────────────────────────────────────────

export async function createTemplateAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin.airlineId) {
    throw new Error('Admin hat keine airline-zuordnung.');
  }

  const parsed = CreateSchema.safeParse({
    name: formData.get('name') ?? '',
    title: formData.get('title') ?? '',
    description: formData.get('description') ?? '',
    kind: formData.get('kind') ?? 'THEMED',
    bonusReward: formData.get('bonusReward') ?? '0',
    maxParticipants: formData.get('maxParticipants') ?? '',
    legsRaw: formData.get('legsRaw') ?? '',
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Ungültige Eingabe');
  }

  // Parse legs (may throw)
  const legs = parseLegs(parsed.data.legsRaw);

  await prisma.eventTemplate.create({
    data: {
      airlineId: admin.airlineId,
      name: parsed.data.name,
      title: parsed.data.title,
      description: parsed.data.description,
      kind: parsed.data.kind as EventKind,
      bonusReward: parsed.data.bonusReward,
      maxParticipants: parsed.data.maxParticipants,
      legs: legs.length > 0 ? (legs as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      createdById: admin.id,
    },
  });

  revalidatePath('/admin/events/templates');
  revalidatePath('/admin/events');
}

// ─────────────────────────────────────────────────────────────────────────
// Delete template
// ─────────────────────────────────────────────────────────────────────────

export async function deleteTemplateAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin.airlineId) {
    throw new Error('Admin hat keine airline-zuordnung.');
  }

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Template-ID fehlt.');

  const tpl = await prisma.eventTemplate.findUnique({
    where: { id },
    select: { id: true, airlineId: true },
  });
  if (!tpl || tpl.airlineId !== admin.airlineId) {
    throw new Error('Template nicht gefunden.');
  }

  await prisma.eventTemplate.delete({ where: { id: tpl.id } });

  revalidatePath('/admin/events/templates');
}

// ─────────────────────────────────────────────────────────────────────────
// Spawn event from template
// ─────────────────────────────────────────────────────────────────────────

/**
 * Erzeugt einen neuen DRAFT-event mit fields aus dem template kopiert.
 * startsAt wird default auf "in 7 tagen" gesetzt, admin muss das per-
 * instance noch korrigieren. endsAt bleibt null (themed/single-flight)
 * oder wird vom admin gesetzt.
 *
 * Slug-handling: title aus template wird zu slug. Bei kollision (template
 * mehrmals gespawnt) hängt prisma einen suffix an — oder unique-violation,
 * dann probieren wir mit -2, -3 etc. (defensive retry).
 */
export async function spawnEventFromTemplateAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin.airlineId) {
    throw new Error('Admin hat keine airline-zuordnung.');
  }

  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('Template-ID fehlt.');

  const tpl = await prisma.eventTemplate.findUnique({
    where: { id },
  });
  if (!tpl || tpl.airlineId !== admin.airlineId) {
    throw new Error('Template nicht gefunden.');
  }

  // Default startsAt = in 7 tagen, gerundet auf full hour
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 7);
  startsAt.setUTCMinutes(0, 0, 0);

  // Slug: title kebab-case + timestamp-suffix für uniqueness
  const baseSlug = tpl.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  // Suffix mit kurzer timestamp damit gleicher template-spawn nicht kollidiert
  const slug = `${baseSlug}-${Date.now().toString(36).slice(-5)}`;

  // Create event + increment template-useCount in einer transaction
  const event = await prisma.$transaction(async (tx) => {
    const ev = await tx.event.create({
      data: {
        airlineId: admin.airlineId,
        title: tpl.title,
        slug,
        description: tpl.description,
        kind: tpl.kind,
        status: 'DRAFT',
        bonusReward: tpl.bonusReward,
        maxParticipants: tpl.maxParticipants,
        startsAt,
        endsAt: null,
        legs: tpl.legs ?? Prisma.JsonNull,
        createdById: admin.id,
      },
    });
    await tx.eventTemplate.update({
      where: { id: tpl.id },
      data: { useCount: { increment: 1 } },
    });
    return ev;
  });

  revalidatePath('/admin/events');
  revalidatePath('/admin/events/templates');
  redirect(`/admin/events/${event.id}`);
}
