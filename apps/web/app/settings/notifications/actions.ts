'use server';

import { auth } from '@/auth';
import { prisma, type Prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  parsePrefs,
  setPref,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPrefs,
} from '@/lib/notification-prefs';

/**
 * Track 4 #81 (Section P) — Notification-Preferences server-actions.
 *
 * Diese file paart mit `/settings/notifications/page.tsx` (RSC) +
 * `notifications-card.tsx` (client). Die page lädt prefs via direktem
 * prisma-call im server-component (kein action-call nötig für RSC-render);
 * der client ruft `updateNotificationPref` für jeden toggle-flip auf.
 *
 * # Why kein separates "set whole prefs" RPC?
 *
 * Die UI ist per-toggle (granular). Ein bulk-update wäre vom server her
 * trivialer (single update statement), aber:
 *   - Wir wollten optimistic-updates pro toggle ohne komplex-state-sync.
 *   - Race-conditions zwischen zwei rapid-toggles auf verschiedenen rows
 *     sind via last-write-wins akzeptabel (vorletzter toggle gewinnt).
 *   - Network-cost ist marginal (12 rows × ~50 bytes = 600B pro batch
 *     vs 80B pro single).
 *
 * Wenn ein "reset alle defaults"-button später dazukommt, schreiben wir
 * dafür einen dezidierten `resetNotificationPrefs()` der `notificationPrefs:
 * Prisma.JsonNull` setzt (NULL = alle defaults greifen via getPref()).
 */

// ─────────────────────────────────────────────────────────────────────────
// Schema-validation für updateNotificationPref input
// ─────────────────────────────────────────────────────────────────────────

const UpdateNotificationPrefSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  value: z.boolean(),
});

type UpdateNotificationPrefInput = z.infer<typeof UpdateNotificationPrefSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Read: getNotificationPrefs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Liest die rohen prefs des eingeloggten users und gibt sie geparst zurück.
 *
 * Verwendung primär: client-side falls eine separate /api-route gebraucht
 * wird. Die /settings/notifications page nutzt direkten prisma-call im
 * RSC (siehe page.tsx).
 *
 * Returns IMMER ein NotificationPrefs-object (nie null) damit UI-code
 * keinen null-check braucht — parsePrefs liefert `{}` wenn das DB-field
 * NULL ist.
 */
export async function getNotificationPrefs(): Promise<
  { success: true; prefs: NotificationPrefs } | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notificationPrefs: true },
  });

  if (!user) {
    return { success: false, error: 'user_not_found' };
  }

  return { success: true, prefs: parsePrefs(user.notificationPrefs) };
}

// ─────────────────────────────────────────────────────────────────────────
// Write: updateNotificationPref
// ─────────────────────────────────────────────────────────────────────────

/**
 * Setzt einen einzelnen (category, channel)-toggle für den eingeloggten
 * user. Merget den neuen wert in das existierende prefs-object — andere
 * categories/channels bleiben unverändert.
 *
 * # Read-modify-write
 *
 * Wir lesen current prefs aus der DB, mergen lokal via `setPref()`,
 * schreiben zurück. Nicht atomar gegen concurrent-writes vom SELBEN user
 * — wenn zwei tabs gleichzeitig toggles flippen ist last-write-wins. Im
 * UI-context praktisch unmöglich (user kann nicht parallel klicken),
 * akzeptabel.
 *
 * # Prisma.InputJsonValue cast
 *
 * Prisma's Json field will `InputJsonValue` als value — unser TypeScript-
 * `NotificationPrefs` ist struktur-kompatibel (plain object, primitive
 * values) aber typescript erkennt das nicht automatisch. Cast über
 * `unknown` damit linter nicht meckert.
 */
export async function updateNotificationPref(
  input: UpdateNotificationPrefInput,
): Promise<
  { success: true; prefs: NotificationPrefs } | { success: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'unauthorized' };
  }

  const parsed = UpdateNotificationPrefSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }

  const { category, channel, value } = parsed.data;

  // Read current prefs.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { notificationPrefs: true },
  });

  if (!user) {
    return { success: false, error: 'user_not_found' };
  }

  const current = parsePrefs(user.notificationPrefs);
  const updated = setPref(current, category, channel, value);

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      notificationPrefs: updated as unknown as Prisma.InputJsonValue,
    },
  });

  revalidatePath('/settings/notifications');

  return { success: true, prefs: updated };
}
