'use client';

/**
 * Track 5 #24 (Section E) — Push-Subscription Toggle Card
 *
 * Settings-card mit dem device-level push-subscribe-toggle. Sitzt UNTER der
 * existing NotificationsCard (Track 4 #81) als separates feature: die
 * NotificationsCard ist per-category (welche events), das hier ist
 * device-level (push als channel überhaupt aktiv?).
 *
 * # State machine
 *
 *   unconfigured     — VAPID nicht gesetzt im server-env → "Nicht konfiguriert"
 *   unsupported      — browser kann kein push (kein PushManager API) → hint
 *   permission-default — user hat permission noch nie gegeben/gedenied → CTA
 *   permission-denied  — browser hat permission permanent blockiert → instructions
 *   permission-granted + not-subscribed — kann jetzt subscriben
 *   subscribed       — alles aktiv, test + unsubscribe buttons sichtbar
 *
 * Permission-flow:
 *   1. user click "Aktivieren" → Notification.requestPermission()
 *   2. browser zeigt OS-native permission dialog
 *   3. permission-state ändert sich → re-render
 *   4. wenn granted: subscribe automatisch hinterher (single click UX)
 *
 * # Why no service-worker re-registration here?
 *
 * Der ServiceWorkerRegistrar (Track 5 #22) registriert den SW schon beim
 * AppShell-mount. Hier nutzen wir nur navigator.serviceWorker.ready was
 * auf die existing registration wartet. Wenn der user die page lädt bevor
 * der SW registriert ist (race), wartet PushManager.subscribe() halt
 * einen frame länger — kein bug.
 */

import { useEffect, useState, useTransition } from 'react';
import {
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPushToSelf,
} from './push-actions';

/**
 * VAPID-public-key kommt als base64url-string daher. Der browser PushManager
 * braucht das als BufferSource. Standard-helper aus dem Web Push spec.
 *
 * base64url ↔ base64: '-' → '+', '_' → '/', kein '=' padding. atob() braucht
 * standard-base64 mit padding.
 *
 * Return-type ist explizit `Uint8Array<ArrayBuffer>` (nicht ArrayBufferLike)
 * weil PushManager.subscribe applicationServerKey nur ArrayBuffer-backed
 * buffer views akzeptiert, nicht SharedArrayBuffer. TypeScript-strict mode
 * würde sonst beim default-typing Uint8Array<ArrayBufferLike> inferieren
 * was eine union mit SharedArrayBuffer ist.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type State =
  | { kind: 'loading' }
  | { kind: 'unconfigured' }
  | { kind: 'unsupported' }
  | { kind: 'permission-default' }
  | { kind: 'permission-denied' }
  | { kind: 'subscribable' } // permission granted but not subscribed
  | { kind: 'subscribed'; endpoint: string };

export function PushSubscriptionCard({
  vapidPublicKey,
}: {
  vapidPublicKey: string | null;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    text: string;
    kind: 'success' | 'error';
  } | null>(null);

  // Initial-detection on mount: feature-availability + permission + subscription.
  useEffect(() => {
    if (!vapidPublicKey) {
      setState({ kind: 'unconfigured' });
      return;
    }
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState({ kind: 'unsupported' });
      return;
    }

    void (async () => {
      const permission = Notification.permission;
      if (permission === 'denied') {
        setState({ kind: 'permission-denied' });
        return;
      }
      if (permission === 'default') {
        setState({ kind: 'permission-default' });
        return;
      }

      // permission === 'granted' → check ob wir schon subscribed sind
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          setState({ kind: 'subscribed', endpoint: existing.endpoint });
        } else {
          setState({ kind: 'subscribable' });
        }
      } catch {
        // SW not ready / unexpected error — treat as subscribable so the
        // user can retry. Don't crash the UI.
        setState({ kind: 'subscribable' });
      }
    })();
  }, [vapidPublicKey]);

  /** Browser-permission request + immediate subscribe wenn granted. */
  async function handleEnable() {
    setMessage(null);
    if (!vapidPublicKey) return;

    // Step 1: permission. Wenn schon granted, skip direkt zum subscribe.
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      setState({
        kind: permission === 'denied' ? 'permission-denied' : 'permission-default',
      });
      return;
    }

    // Step 2: subscribe via PushManager.
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // Step 3: persist on server.
      const json = subscription.toJSON();
      const result = await subscribeToPush({
        endpoint: json.endpoint,
        keys: json.keys,
      });
      if (!result.ok) {
        // Server rejected — clean up the local subscription so we don't
        // have a zombie subscription that fires but isn't recorded.
        await subscription.unsubscribe().catch(() => {});
        setMessage({ text: result.error, kind: 'error' });
        setState({ kind: 'subscribable' });
        return;
      }
      setState({ kind: 'subscribed', endpoint: subscription.endpoint });
      setMessage({
        text: 'Push-Benachrichtigungen aktiviert auf diesem gerät.',
        kind: 'success',
      });
    } catch (err) {
      setMessage({
        text:
          'Aktivierung fehlgeschlagen: ' +
          (err instanceof Error ? err.message : 'unknown error'),
        kind: 'error',
      });
    }
  }

  async function handleDisable() {
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Unsubscribe on the push-service side first, then delete from DB.
        await subscription.unsubscribe();
        await unsubscribeFromPush(subscription.endpoint);
      }
      setState({ kind: 'subscribable' });
      setMessage({
        text: 'Push-Benachrichtigungen deaktiviert auf diesem gerät.',
        kind: 'success',
      });
    } catch (err) {
      setMessage({
        text:
          'Deaktivierung fehlgeschlagen: ' +
          (err instanceof Error ? err.message : 'unknown error'),
        kind: 'error',
      });
    }
  }

  function handleTest() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestPushToSelf();
      if (!result.ok) {
        setMessage({ text: result.error, kind: 'error' });
        return;
      }
      setMessage({
        text: `Test-notification an ${result.data.delivered} ${result.data.delivered === 1 ? 'gerät' : 'geräten'} gesendet.`,
        kind: 'success',
      });
    });
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-start gap-4">
        <div className="text-2xl" aria-hidden="true">
          📲
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold mb-1">Push-Benachrichtigungen</h2>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            Empfange notifications direkt auf diesem gerät — auch wenn der
            browser-tab geschlossen ist. Aktiviert pro browser/gerät.
          </p>

          {state.kind === 'loading' && (
            <p className="text-sm text-muted-foreground italic">
              Status wird geladen…
            </p>
          )}

          {state.kind === 'unconfigured' && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              Push-notifications sind serverseitig nicht konfiguriert (VAPID-
              keys fehlen). Admin muss <code className="font-mono text-xs">
              VAPID_PUBLIC_KEY</code> + <code className="font-mono text-xs">
              VAPID_PRIVATE_KEY</code> in der env setzen.
            </div>
          )}

          {state.kind === 'unsupported' && (
            <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-muted-foreground">
              Dein browser unterstützt keine push-notifications. Auf iOS
              musst du die app erst zum home-screen hinzufügen.
            </div>
          )}

          {state.kind === 'permission-default' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleEnable}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition"
              >
                Push-Benachrichtigungen aktivieren
              </button>
              <p className="text-xs text-muted-foreground">
                Der browser fragt nach erlaubnis. Du kannst die einstellung
                später jederzeit ändern.
              </p>
            </div>
          )}

          {state.kind === 'permission-denied' && (
            <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-900 dark:text-red-200">
              Dein browser hat push-notifications für diese seite permanent
              blockiert. Um sie wieder zu aktivieren: klick auf das schloss-
              symbol in der adressleiste → benachrichtigungen → erlauben.
            </div>
          )}

          {state.kind === 'subscribable' && (
            <button
              type="button"
              onClick={handleEnable}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition"
            >
              Auf diesem gerät aktivieren
            </button>
          )}

          {state.kind === 'subscribed' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <span aria-hidden="true">✓</span>
                <span>Aktiv auf diesem gerät</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={pending}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-900 text-sm font-medium rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pending ? 'Senden…' : 'Test-notification senden'}
                </button>
                <button
                  type="button"
                  onClick={handleDisable}
                  className="px-3 py-1.5 border border-red-300 dark:border-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm font-medium rounded-md transition"
                >
                  Deaktivieren
                </button>
              </div>
            </div>
          )}

          {message && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm ${
                message.kind === 'success'
                  ? 'border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 text-green-900 dark:text-green-200'
                  : 'border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
              }`}
              role="status"
            >
              {message.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
