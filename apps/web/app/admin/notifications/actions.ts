'use server';

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/roles';

/**
 * Track 3 #11.2.5 v1-Full Item 8/10 — Notification-Center server actions
 * (vision-doc §9.3.10).
 *
 * # Was hier ist (v1)
 *
 * Genau eine action: `sendNotificationAction`. Admin schickt eine
 * notification entweder broadcast (recipientId="" → null) oder per-user
 * (recipientId=user-id-string).
 *
 * # Was bewusst NICHT hier ist (v2)
 *
 * - Per-airline-broadcast: braucht audience-resolver (alle pilots einer
 *   airline rausziehen + entweder N per-user-rows schreiben oder ein
 *   neues `audience`-feld auf AdminNotification). Schema hat aktuell nur
 *   recipientId-pointer ohne airline-scope.
 * - Schedule/queue (\"erst morgen 9 uhr senden\"): braucht cron oder
 *   workflow-runner.
 * - Edit/delete von gesendeten notifications: kein use-case in v1.
 *   Send-fire-forget. Wenn admin sich vertippt → neue notification mit
 *   korrektur senden.
 * - Pilot-side read-mark-action: separates ticket im rahmen vom pilot-
 *   side notification-drawer (eigenes ticket).
 *
 * # Auth
 *
 * `requireAdmin()` throws bei non-admin. Wir nutzen das returnte user-
 * record als author-pointer — saubere chain ohne extra `auth()`-call.
 */

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

/**
 * Kind-validation: enum statt freier string an der API-grenze. Schema
 * speichert kind als string damit neue typen ohne migration gehen, aber
 * die action whitelisted die kanonischen 4 — verhindert dass admin per
 * DevTools "<script>alert(1)</script>" als kind reinschickt.
 */
const KindSchema = z.enum(['info', 'warning', 'success', 'event']);

const SendSchema = z.object({
  title: z
    .string()
    .min(2, 'Titel braucht mindestens 2 Zeichen')
    .max(120, 'Titel darf höchstens 120 Zeichen haben')
    .trim(),
  body: z
    .string()
    .min(2, 'Nachricht braucht mindestens 2 Zeichen')
    .max(2000, 'Nachricht darf höchstens 2000 Zeichen haben')
    .trim(),
  kind: KindSchema.default('info'),
  // recipientId: leerstring oder "broadcast" → null (broadcast).
  // Sonst muss ein gültiger user-id-string sein. Existenz-check
  // passiert weiter unten gegen prisma damit wir gute fehlermeldung
  // geben können.
  recipientId: z.string().trim().optional().or(z.literal('')),
});

// ─────────────────────────────────────────────────────────────────────
// Action result
// ─────────────────────────────────────────────────────────────────────

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────
// sendNotificationAction
// ─────────────────────────────────────────────────────────────────────

export async function sendNotificationAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = SendSchema.safeParse({
      title: formData.get('title'),
      body: formData.get('body'),
      kind: formData.get('kind') ?? 'info',
      recipientId: formData.get('recipientId'),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join('; '),
      };
    }

    // recipientId-resolution: leerstring/broadcast/undefined → null,
    // sonst muss user existieren.
    const rawRecipient = parsed.data.recipientId?.trim() ?? '';
    let recipientId: string | null = null;
    if (rawRecipient && rawRecipient !== 'broadcast') {
      const user = await prisma.user.findUnique({
        where: { id: rawRecipient },
        select: { id: true },
      });
      if (!user) {
        return {
          ok: false,
          error: 'Empfänger-User-ID nicht gefunden.',
        };
      }
      recipientId = user.id;
    }

    await prisma.adminNotification.create({
      data: {
        authorId: admin.id,
        recipientId,
        title: parsed.data.title,
        body: parsed.data.body,
        kind: parsed.data.kind,
      },
    });

    // Revalidate admin-dashboard (zeigt sent-feed) und — sobald das
    // pilot-side widget existiert — sollten wir auch dessen pfad
    // revalidieren. Aktuell nur das admin-widget.
    revalidatePath('/admin');

    return {
      ok: true,
      message:
        recipientId === null
          ? 'Broadcast an alle piloten gesendet.'
          : 'Notification an pilot gesendet.',
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unbekannter Fehler',
    };
  }
}
