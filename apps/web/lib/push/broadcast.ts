/**
 * Welle N / N2 — Broadcast push notifications to many users at once.
 *
 * Higher-level helper über sendPushToUser(). Wird genutzt von:
 *
 *   - Admin-broadcast-action ("Wartung in 30min" an alle airline-pilots)
 *   - NOTAM-publish (L5) — optional, V2 könnte beim publishNotamAction
 *     einen broadcast an alle airline-member triggern (low-prio, weil
 *     pilots eh /notams checken sollten)
 *   - Scheduled-flight-cancel — pilot mit gebuchtem flight notifizieren
 *     wenn der admin die scheduled-flight cancelt
 *
 * # Per-user pref-check
 *
 * Jeder recipient wird vor dem send durch `getPref(prefs, category, 'push')`
 * gefiltert. So respektieren wir user-preferences im broadcast genauso
 * wie im follower-fanout. Die category-id muss explizit übergeben werden
 * (kein default) damit caller bewusst eine wahl trifft — z.B.
 * 'adminBroadcast' für system-ansagen, 'bookingReminder' für
 * cancellation-info, etc.
 *
 * # Fire-and-forget
 *
 * Wie follower-fanout: caller ruft mit `void broadcastPushToUsers(...)`
 * und vergisst es. Errors werden geloggt aber nicht propagiert. Wenn
 * ein push-service-outage besteht ist das nicht der admin-action zu
 * schuld — die action ist schon committed.
 *
 * # Performance
 *
 * Promise.allSettled über alle eligible recipients. Bei 100-member-
 * airline ist das ~100 parallel http-requests an FCM/Mozilla/etc.,
 * die push-services skalieren das problemlos.
 *
 * In-process pre-filter (notification-prefs) ist O(N) ein einziger
 * DB-query mit `User.findMany({where:{id:in[...]}, select:{id,prefs}})`.
 */

import { prisma } from '@vam/db';
import { sendPushToUser, type PushPayload } from './vapid';
import {
  parsePrefs,
  getPref,
  type NotificationCategory,
} from '@/lib/notification-prefs';

export type BroadcastResult = {
  /** Wieviele user-ids wurden eingangs übergeben. */
  requested: number;
  /** Wieviele davon hatten den channel aktiv (= push-eligible). */
  eligible: number;
  /** Anzahl erfolgreich zugestellter device-pushes (sum über alle users). */
  delivered: number;
  /** Anzahl fehlgeschlagener device-pushes. */
  failed: number;
};

/**
 * Sendet eine push-notification an alle gegebenen user-ids, gefiltert
 * nach deren notification-prefs für die category.
 */
export async function broadcastPushToUsers(
  userIds: string[],
  category: NotificationCategory,
  payload: PushPayload,
): Promise<BroadcastResult> {
  if (userIds.length === 0) {
    return { requested: 0, eligible: 0, delivered: 0, failed: 0 };
  }

  // Dedupe + load prefs in einer query
  const uniqueIds = Array.from(new Set(userIds));
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, notificationPrefs: true },
  });

  const eligibleIds = users
    .filter((u) => {
      const prefs = parsePrefs(u.notificationPrefs);
      return getPref(prefs, category, 'push');
    })
    .map((u) => u.id);

  if (eligibleIds.length === 0) {
    return {
      requested: uniqueIds.length,
      eligible: 0,
      delivered: 0,
      failed: 0,
    };
  }

  const results = await Promise.allSettled(
    eligibleIds.map((uid) => sendPushToUser(uid, payload)),
  );

  let delivered = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      delivered += r.value.succeeded;
      failed += r.value.failed;
    } else {
      failed++;
    }
  }

  return {
    requested: uniqueIds.length,
    eligible: eligibleIds.length,
    delivered,
    failed,
  };
}

/**
 * Convenience: alle pilots einer airline mit einer push notifizieren.
 *
 * Lädt die airline-member-list selbst (User.airlineId === airlineId),
 * dann delegiert an broadcastPushToUsers. Caller muss nur die
 * airlineId, category und payload übergeben.
 *
 * Excluded: der actor selber (z.B. admin der eine NOTAM publisht
 * braucht keinen self-push). Optional via `excludeUserId`-param.
 */
export async function broadcastPushToAirline(
  airlineId: string,
  category: NotificationCategory,
  payload: PushPayload,
  options: { excludeUserId?: string | null } = {},
): Promise<BroadcastResult> {
  const exclude = options.excludeUserId ?? null;
  const members = await prisma.user.findMany({
    where: {
      airlineId,
      ...(exclude ? { id: { not: exclude } } : {}),
    },
    select: { id: true },
  });
  if (members.length === 0) {
    return { requested: 0, eligible: 0, delivered: 0, failed: 0 };
  }
  return broadcastPushToUsers(
    members.map((m) => m.id),
    category,
    payload,
  );
}
