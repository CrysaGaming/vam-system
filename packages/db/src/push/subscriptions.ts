/**
 * Track 5 #24 (Section E) — Push Subscription helpers
 *
 * DB-layer für Web Push subscriptions. Pure aggregator/CRUD-functions —
 * actual web-push library + VAPID config + payload-sending lebt in der
 * apps/web @ /lib/push/ (siehe vapid.ts). Diese helper kennen nur die
 * DB-shape, keine push-protocol details.
 *
 * # CRUD operations
 *
 *   upsertSubscription   — neue oder re-aktivierte subscription persistieren
 *   removeSubscription   — endpoint-based delete (uniqueness key)
 *   listSubscriptions    — alle subscriptions für einen user (für push-send)
 *   deleteByEndpoint     — cleanup für expired endpoints (410 Gone responses)
 */

import { prisma } from '../index.js';

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

/**
 * Upsert via endpoint (which is globally unique). Re-subscribe vom selben
 * browser nach permission-revoke + neuem opt-in kann das selbe endpoint
 * zurückgeben — dann updaten wir p256dh/auth statt einer unique-constraint-
 * verletzung. userId wird beim update mit-gesetzt damit ein endpoint nicht
 * stale an einen anderen user gebunden bleibt wenn der browser zwischen
 * accounts wechselt (selten, aber möglich bei shared devices).
 */
export async function upsertPushSubscription(params: {
  userId: string;
  subscription: PushSubscriptionPayload;
  userAgent?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const { userId, subscription, userAgent } = params;
  const truncatedUA = userAgent ? userAgent.slice(0, 500) : null;

  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
    select: { id: true },
  });

  if (existing) {
    await prisma.pushSubscription.update({
      where: { endpoint: subscription.endpoint },
      data: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: truncatedUA,
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await prisma.pushSubscription.create({
    data: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: truncatedUA,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Delete subscription by endpoint. Wenn die row nicht existiert (z.B. user
 * hat schon vorher unsubscribed in einem anderen tab), idempotent return.
 * Wir filtern auf userId damit ein user nicht versehentlich oder
 * absichtlich eine fremde subscription killen kann via spoofed endpoint.
 */
export async function removePushSubscription(params: {
  userId: string;
  endpoint: string;
}): Promise<{ deleted: boolean }> {
  const { userId, endpoint } = params;
  const result = await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint },
  });
  return { deleted: result.count > 0 };
}

/**
 * Liste aller subscriptions für einen user. Wird vom sendPushToUser-helper
 * aufgerufen um eine notification an ALLE devices des users zu fan-outen.
 * Sortiert nach createdAt desc damit jüngere subscriptions (= das aktive
 * device) zuerst durchgehen — wenn das push-rate-limited wird, hat das
 * primäre device wenigstens die notification bekommen.
 */
export async function listPushSubscriptionsForUser(
  userId: string,
): Promise<
  Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>
> {
  return prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  });
}

/**
 * Cleanup-helper: lösche eine subscription die der push-service als
 * permanent ungültig markiert hat (HTTP 410 Gone oder 404 Not Found).
 * Wird vom sendPushToUser-helper aufgerufen nach failed deliveries —
 * stale rows ansammeln zu lassen kostet bandwidth (jede push-versuch
 * macht einen netzwerk-roundtrip zum push-service).
 *
 * KEINE userId-check hier weil cleanup vom backend kommt (nicht vom
 * authenticated user) und nur ein wegspeziferter endpoint angefasst
 * wird — ein admin/cleanup-job darf das.
 */
export async function deletePushSubscriptionByEndpoint(
  endpoint: string,
): Promise<{ deleted: boolean }> {
  const result = await prisma.pushSubscription.deleteMany({
    where: { endpoint },
  });
  return { deleted: result.count > 0 };
}

/**
 * Count active subscriptions for a user — fürs UI um zu zeigen "du hast
 * push auf 2 geräten aktiviert". Cheap: läuft auf dem userId-index.
 */
export async function countPushSubscriptionsForUser(
  userId: string,
): Promise<number> {
  return prisma.pushSubscription.count({
    where: { userId },
  });
}
