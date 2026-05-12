'use server';

/**
 * Track 5 #24 (Section E) — Push-Subscription Server-Actions
 *
 * Drei actions die das client-side push-toggle UI braucht:
 *
 *   subscribeToPush    — POST: persistiert eine neue PushSubscription
 *   unsubscribeFromPush — DELETE: löscht eine bestehende subscription
 *   sendTestPushToSelf  — UTILITY: testet die delivery pipeline
 *
 * Alle drei sind auth-gated (auth() → session.user.id). Die push-payload-
 * shape ist via zod validiert weil sie vom client kommt und nicht trust-
 * worthy ist. Wir checken NICHT für VAPID-konfiguration in den subscribe/
 * unsubscribe-actions — die DB-row braucht keine VAPID-keys. Nur das
 * sendTestPushToSelf gibt einen freundlichen unavailable-state zurück
 * wenn VAPID nicht konfiguriert ist.
 *
 * # Why no API routes?
 *
 * Wir nutzen Next.js server-actions statt API-routes (POST /api/push/...).
 * Server-actions kriegen automatic CSRF protection + werden von next-form
 * Submissions sauber gehandelt + sind type-safe RPC-style. API-routes wären
 * nur sinnvoll wenn external systems (z.B. external service worker context)
 * direkt callen müssten — alles hier kommt aus dem same-origin auth'd
 * browser-tab des users, server-actions sind die richtige tool dafür.
 */

import { z } from 'zod';
import { headers } from 'next/headers';
import { auth } from '@/auth';
import {
  upsertPushSubscription,
  removePushSubscription,
} from '@vam/db';
import { isPushConfigured, sendPushToUser } from '@/lib/push/vapid';

// Zod schema für die push-subscription shape die PushManager.subscribe()
// auf dem client zurückgibt. browser-API gibt das als PushSubscriptionJSON
// (web-platform type) zurück, wir validieren beim eintreffen weil's vom
// browser geserved und über server-action gepusht wird → untrusted.
const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().min(1).max(2000),
  keys: z.object({
    // p256dh ist ein ECDH-public-key (uncompressed P-256), base64url-encoded
    // = 65 bytes raw → 88 chars base64. Wir lassen einen großzügigen range
    // weil verschiedene push-services manchmal padding-edge-cases haben.
    p256dh: z.string().min(40).max(200),
    // auth-secret ist 16 bytes raw → 22-24 chars base64. Wieder generous bounds.
    auth: z.string().min(10).max(100),
  }),
});

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Subscribe das current browser-device an push-notifications. Idempotent:
 * gleicher endpoint zweimal → upsert (kein duplicate).
 */
export async function subscribeToPush(
  rawSubscription: unknown,
): Promise<ActionResult<{ created: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht angemeldet' };
  }

  const parsed = PushSubscriptionInputSchema.safeParse(rawSubscription);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Ungültige push-subscription-daten vom browser',
    };
  }

  // userAgent für device-identification beim späteren multi-device-listing.
  // Optional — wenn header missing (z.b. crawler), passt der DB-column auf null.
  const userAgent = (await headers()).get('user-agent');

  const result = await upsertPushSubscription({
    userId: session.user.id,
    subscription: parsed.data,
    userAgent,
  });

  return { ok: true, data: { created: result.created } };
}

/**
 * Unsubscribe das current device. Idempotent — wenn die row nicht existiert
 * (z.B. user hat in einem anderen tab schon unsubscribed) trotzdem ok.
 */
export async function unsubscribeFromPush(
  endpoint: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht angemeldet' };
  }

  // Defensive validation — auch wenn endpoint vom client kommt, könnte
  // theoretisch ein super-langer string DOS-en. Match die schema-bounds
  // vom subscribe-action.
  if (typeof endpoint !== 'string' || endpoint.length < 1 || endpoint.length > 2000) {
    return { ok: false, error: 'Ungültiger endpoint' };
  }

  const result = await removePushSubscription({
    userId: session.user.id,
    endpoint,
  });

  return { ok: true, data: { deleted: result.deleted } };
}

/**
 * Test-action: schickt eine test-notification an alle devices des current
 * users. Damit kann der user nach dem subscribe direkt verifizieren dass
 * die delivery pipeline funktioniert.
 */
export async function sendTestPushToSelf(): Promise<
  ActionResult<{ delivered: number; cleaned: number }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: 'Nicht angemeldet' };
  }

  if (!isPushConfigured()) {
    return {
      ok: false,
      error: 'Push-notifications sind serverseitig nicht konfiguriert',
    };
  }

  const result = await sendPushToUser(session.user.id, {
    title: '🔔 Test-notification',
    body: 'Wenn du das siehst, funktionieren push-notifications auf diesem gerät.',
    url: '/settings/notifications',
    // tag damit wiederholte tests die alte notification ersetzen statt
    // zu stapeln.
    tag: 'vam-push-test',
  });

  if (result.attempted === 0) {
    return {
      ok: false,
      error: 'Keine push-subscriptions für deinen account gefunden',
    };
  }

  return {
    ok: true,
    data: { delivered: result.succeeded, cleaned: result.cleanedUp },
  };
}
