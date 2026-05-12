/**
 * Track 5 #24 (Section E) — Web Push VAPID config + send helper
 *
 * Wrappt die `web-push` library und stellt die zwei high-level helpers
 * bereit die der rest der app braucht:
 *
 *   isPushConfigured() → ist VAPID set + können wir push senden?
 *   sendPushToUser(userId, payload) → fan-out an alle devices des users
 *
 * Future features (PIREP-approved notifications, tour-leg-ready, etc.)
 * importieren nur sendPushToUser — sie kennen weder VAPID noch web-push
 * library, sondern beschreiben einfach die notification deklarativ.
 *
 * # VAPID-konfig
 *
 * VAPID (Voluntary Application Server Identification) ist die identifikations-
 * mechanik des Web Push Protokolls (RFC 8292): unser server signiert jede
 * push-request mit dem privaten key, der push-service (FCM/Mozilla/APN)
 * validiert gegen den public key (der bei der subscription mitgegeben wurde).
 *
 * Env-vars (siehe .env.example):
 *   VAPID_PUBLIC_KEY               — base64url-encoded P-256 public key
 *   VAPID_PRIVATE_KEY              — base64url-encoded P-256 private key
 *   VAPID_SUBJECT                  — mailto: oder https:// URL (abuse-contact)
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY   — public-key copy fürs client-bundle
 *
 * Wenn VAPID_PRIVATE_KEY oder VAPID_PUBLIC_KEY missing → push gracefully
 * disabled (isPushConfigured returns false, sendPushToUser noop). Das
 * erlaubt deploys ohne keys ohne dass der whole-app-build kaputt geht.
 *
 * # web-push lazy init
 *
 * webpush.setVapidDetails() wird beim ersten use lazy aufgerufen, nicht
 * beim module-load. Grund: module-load passiert auch beim build-step
 * (next.js prerenders pages) — wenn dort env-vars fehlen, würde ein
 * eager-throw den build abbrechen. Lazy-init verschiebt den check auf
 * die runtime, wo er gracefully degradiert.
 */

import webpush from 'web-push';
import {
  listPushSubscriptionsForUser,
  deletePushSubscriptionByEndpoint,
} from '@vam/db';

/**
 * Payload shape die wir an den browser-SW pushen. Bewusst minimal: der
 * SW-handler (sw.js) packt das direkt in eine self.registration.show-
 * Notification()-call. Erweiterungen (actions, image, vibrate, etc.)
 * hier ergänzen + im SW-handler matchen.
 */
export type PushPayload = {
  title: string;
  body: string;
  /** Optional click-target. Default '/' wenn nicht gesetzt. */
  url?: string;
  /** Optional tag zum coalescing — gleicher tag ersetzt frühere notif. */
  tag?: string;
};

let vapidInitialized = false;

/**
 * Sind VAPID-keys konfiguriert? UI nutzt das um den toggle als "nicht
 * konfiguriert" zu rendern; server-actions returnen ein 'unavailable'-
 * result wenn das false ist. Cheap (kein I/O), nur env-check.
 */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

/**
 * Lazy-init der web-push library mit unseren VAPID-credentials. Wird
 * idempotent: zweiter call ist no-op. Throws wenn env-vars fehlen —
 * caller muss vorher isPushConfigured() checken.
 */
function ensureVapidInitialized(): void {
  if (vapidInitialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      'VAPID env-vars missing (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)',
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidInitialized = true;
}

/**
 * Send eine push-notification an ALLE registrierten devices eines users.
 * Returns ein report mit success/failure-counts plus die total cleanup-
 * actions (stale endpoints die nach 410 Gone gelöscht wurden).
 *
 * # Error handling
 *
 * Web Push Protocol status codes:
 *   201 — Accepted (delivered to push-service)
 *   400 — Bad request (payload too large, missing TTL, etc.)
 *   404 — Subscription not found (browser unsubscribed permanently)
 *   410 — Gone (subscription invalidated, e.g. user revoked permission)
 *   413 — Payload too large
 *   429 — Rate limit
 *
 * 404 + 410 = permanent failure → wir löschen die subscription row damit
 * wir nicht bei jedem push einen sicher-fehlschlagenden roundtrip machen.
 * Andere errors (4xx/5xx) loggen wir aber lassen die row stehen — könnte
 * transient sein (push-service-outage, rate-limit).
 *
 * # Fan-out parallelism
 *
 * Promise.allSettled über alle subscriptions parallel — bei einem user
 * mit 3 devices sparen wir uns 2 sequentielle network-roundtrips. Wenn
 * der user 50 devices hätte (theoretisch möglich, praktisch nie) wäre
 * das immer noch fein, push-services skalieren weit über das hinaus.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  cleanedUp: number;
}> {
  if (!isPushConfigured()) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0 };
  }
  ensureVapidInitialized();

  const subscriptions = await listPushSubscriptionsForUser(userId);
  if (subscriptions.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, cleanedUp: 0 };
  }

  const serializedPayload = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          serializedPayload,
          {
            // TTL = 24h: wenn das device offline ist, hält der push-service
            // die notification 24h vor (max) bis das device wieder online
            // ist. Default ist meist 0 (deliver-now-or-drop) was für notifications
            // mit ein bisschen lebensdauer wie "PIREP approved" suboptimal ist.
            TTL: 60 * 60 * 24,
          },
        );
        return { kind: 'success' as const, endpoint: sub.endpoint };
      } catch (err) {
        // web-push wirft mit statusCode property bei 4xx/5xx responses.
        const statusCode = (err as { statusCode?: number }).statusCode;
        const isGone = statusCode === 404 || statusCode === 410;
        if (isGone) {
          await deletePushSubscriptionByEndpoint(sub.endpoint).catch(() => {
            // Cleanup-failure beim DB-delete ist nicht-fatal — die row
            // bleibt halt drin und der nächste push-versuch wird wieder
            // 410 kriegen und wieder versuchen sie zu löschen. Eventually
            // consistent.
          });
        }
        return {
          kind: 'failure' as const,
          endpoint: sub.endpoint,
          statusCode,
          cleanedUp: isGone,
        };
      }
    }),
  );

  let succeeded = 0;
  let failed = 0;
  let cleanedUp = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.kind === 'success') {
        succeeded++;
      } else {
        failed++;
        if (result.value.cleanedUp) cleanedUp++;
      }
    } else {
      // Promise.allSettled-rejected = unexpected throw inside the inner
      // try/catch (sollte praktisch nicht passieren weil wir alles fangen).
      failed++;
    }
  }

  return {
    attempted: subscriptions.length,
    succeeded,
    failed,
    cleanedUp,
  };
}
