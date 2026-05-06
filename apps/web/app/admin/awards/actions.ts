'use server';

import { auth } from '@/auth';
import {
  prisma,
  createAward as dbCreateAward,
  updateAward as dbUpdateAward,
  deleteAward as dbDeleteAward,
  grantAward as dbGrantAward,
  revokeAward as dbRevokeAward,
  type CreateAwardInput,
  type UpdateAwardInput,
} from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/roles';

/**
 * Track 1 #1 (Awards UI, 9.2.3) — Server actions für admin-side award-
 * management. CRUD auf Award-typen plus grant/revoke auf UserAward-
 * vergaben.
 *
 * Auth-pattern: zentralen `requireAdmin()` aus lib/roles. Throws bei
 * non-admin damit die action im UI als next.js error rendert (kein
 * silent fail). Track 3 #11.2.5 M2: ehemals lokal dupliziert, jetzt
 * konsolidiert.
 *
 * Form-validation: zod-schemas pro action. Input ist FormData (von
 * server-action <form>'s) oder direct objects (von client components
 * die explizit aufrufen). Wir designen die signatures so dass beide
 * pfade funktionieren — actions nehmen `prevState, formData` für die
 * useFormState-pattern.
 */

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const AwardCreateSchema = z.object({
  name: z
    .string()
    .min(2, 'Name muss mindestens 2 Zeichen haben')
    .max(80, 'Name darf höchstens 80 Zeichen haben')
    .trim(),
  description: z.string().max(500).trim().optional().or(z.literal('')),
  iconUrl: z
    .string()
    .url('Ungültige URL')
    .max(500)
    .optional()
    .or(z.literal('')),
});

const AwardUpdateSchema = AwardCreateSchema.extend({
  id: z.string().min(1),
});

// ─────────────────────────────────────────────────────────────────────
// Action results
// ─────────────────────────────────────────────────────────────────────

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────
// createAward
// ─────────────────────────────────────────────────────────────────────

export async function createAwardAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const parsed = AwardCreateSchema.safeParse({
      name: formData.get('name'),
      description: formData.get('description'),
      iconUrl: formData.get('iconUrl'),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      };
    }

    const input: CreateAwardInput = {
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      iconUrl: parsed.data.iconUrl?.trim() || null,
    };

    await dbCreateAward(input);
    revalidatePath('/admin/awards');
    revalidatePath('/awards');
    return { ok: true, message: `Award "${input.name}" angelegt.` };
  } catch (err) {
    // P2002 = unique-constraint (name bereits vergeben)
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return {
        ok: false,
        error: 'Ein Award mit diesem Namen existiert bereits.',
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// updateAward
// ─────────────────────────────────────────────────────────────────────

export async function updateAwardAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();

    const parsed = AwardUpdateSchema.safeParse({
      id: formData.get('id'),
      name: formData.get('name'),
      description: formData.get('description'),
      iconUrl: formData.get('iconUrl'),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      };
    }

    const input: UpdateAwardInput = {
      id: parsed.data.id,
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      iconUrl: parsed.data.iconUrl?.trim() || null,
    };

    await dbUpdateAward(input);
    revalidatePath('/admin/awards');
    revalidatePath(`/admin/awards/${input.id}`);
    revalidatePath('/awards');
    revalidatePath(`/awards/${input.id}`);
    return { ok: true, message: 'Award aktualisiert.' };
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return {
        ok: false,
        error: 'Ein Award mit diesem Namen existiert bereits.',
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// deleteAward
// ─────────────────────────────────────────────────────────────────────

export async function deleteAwardAction(awardId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbDeleteAward(awardId);
    revalidatePath('/admin/awards');
    revalidatePath('/awards');
    const lostMsg =
      result.userAwardsDeleted > 0
        ? ` (${result.userAwardsDeleted} vergaben mit-gelöscht)`
        : '';
    return { ok: true, message: `Award gelöscht${lostMsg}.` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// grantAward
// ─────────────────────────────────────────────────────────────────────

export async function grantAwardAction(
  awardId: string,
  userId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbGrantAward(userId, awardId);

    revalidatePath('/admin/awards');
    revalidatePath(`/admin/awards/${awardId}`);
    revalidatePath(`/awards/${awardId}`);
    revalidatePath(`/pilots/${userId}`);
    revalidatePath('/awards/personal');

    if (result.wasAlreadyEarned) {
      return {
        ok: true,
        message: 'Pilot hatte den Award schon — keine Änderung.',
      };
    }

    // Best-effort: feuere bot-event für discord-broadcast. Import
    // dynamic damit das modul lazy-loaded wird (vermeidet eventuelle
    // server-only-circular-imports beim build).
    try {
      const { emitAwardEarned } = await import('@/lib/bot-events');
      const [pilot, award] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, discordId: true },
        }),
        prisma.award.findUnique({
          where: { id: awardId },
          select: { name: true, description: true, iconUrl: true },
        }),
      ]);
      if (pilot && award) {
        await emitAwardEarned({
          userId,
          pilotName: pilot.name ?? 'Unbenannt',
          pilotDiscordId: pilot.discordId,
          awardId,
          awardName: award.name,
          awardDescription: award.description,
          awardIconUrl: award.iconUrl,
        });
      }
    } catch (broadcastErr) {
      // Nicht fatal — der DB-write ist durch, nur die discord-notification
      // hat gefehlt. Loggen und weiter.
      console.warn('[awards] discord-broadcast fehlgeschlagen:', broadcastErr);
    }

    return { ok: true, message: 'Award vergeben.' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// revokeAward
// ─────────────────────────────────────────────────────────────────────

export async function revokeAwardAction(
  awardId: string,
  userId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const result = await dbRevokeAward(userId, awardId);

    revalidatePath('/admin/awards');
    revalidatePath(`/admin/awards/${awardId}`);
    revalidatePath(`/awards/${awardId}`);
    revalidatePath(`/pilots/${userId}`);
    revalidatePath('/awards/personal');

    if (result.wasAlreadyAbsent) {
      return {
        ok: true,
        message: 'Pilot hatte den Award eh nicht — nichts geändert.',
      };
    }
    return { ok: true, message: 'Award entzogen.' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}
