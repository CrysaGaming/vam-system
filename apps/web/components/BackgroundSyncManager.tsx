'use client';

/**
 * Track 5 #25 (Section E) — Background Sync Manager
 *
 * Mount-once component für den client-side fallback der Background Sync API.
 * Sitzt im AppShell (parallel zu OfflineBanner, ServiceWorkerRegistrar etc).
 *
 * # Was es macht
 *
 *   1. Beim mount: wenn navigator.onLine === true UND es liegen drafts in
 *      IDB → drain sofort (catch-up-fall, z.B. nach refresh nach offline-
 *      session).
 *
 *   2. window.addEventListener('online'): wenn der user wieder online geht,
 *      drain trigger. Das ist DER fallback für browsers die keine Background
 *      Sync API haben (Firefox, Safari). Auf chrome/edge feuert der SW
 *      sync-event PARALLEL — kein bug weil /api/sync/drain idempotent ist.
 *
 *   3. Re-render-resistent: alle event-listeners werden im useEffect-cleanup
 *      entfernt. Wenn die page hot-reloaded (next-dev) bleibt kein leak.
 *
 * # Was es NICHT macht
 *
 *   - Periodischer poll. Wenn der user die ganze zeit online ist aber ein
 *     draft im IDB hat (z.B. weil ein submit-attempt fehlschlug), wird der
 *     drain erst beim nächsten online-event oder page-load getriggert.
 *     Für V1 ok — adäquates verhalten weil offline-drafts seltene events
 *     sind, kein hot-path.
 *
 *   - Conflict-resolution. Wenn der server einen draft als 'failed' markiert
 *     (z.B. validation-error) bleibt der draft im queue mit retryCount++.
 *     Dead-letter-handling ist UI-aufgabe (zeig dem user die failed drafts,
 *     biete delete oder edit-and-retry).
 *
 *   - Visuelles feedback bei drain-success. Der drain läuft silent im
 *     hintergrund — wenn der user feedback will, fired sendPushToUser
 *     (für demo-ping) eine push-notification. Andere kinds können später
 *     ein in-app-notification triggern.
 *
 * # Render-output
 *
 * null. Pure side-effect component. Kein DOM, kein layout-impact.
 */

import { useEffect } from 'react';

export function BackgroundSyncManager() {
  useEffect(() => {
    // Wenn wir nicht im browser sind (SSR pre-hydration), nix tun. Würde
    // sonst beim server-render crashen weil window/navigator nicht da sind.
    if (typeof window === 'undefined') return;

    let canceled = false;

    /**
     * Hauptdrain-action. Lazy-imported damit der draft-queue + register-sync
     * code nur ins client-bundle ladet wenn drain wirklich passiert (sonst
     * ist's tree-shaken weg in dem unlikely-fall dass weder mount noch
     * online-event passiert).
     */
    const doDrain = async () => {
      if (canceled) return;
      try {
        const { countDrafts } = await import('@/lib/sync/draft-queue');
        const pending = await countDrafts();
        if (pending === 0) return;
        const { drainDraftsFromClient } = await import(
          '@/lib/sync/register-sync'
        );
        await drainDraftsFromClient();
      } catch {
        // Silent fail — wenn IDB nicht verfügbar (private-mode firefox o.ä.)
        // oder das module dynamisch nicht resolved, geben wir auf. Der
        // user merkt nichts; wenn drafts im memory waren sind sie auch
        // weg sobald die page refreshed (private-mode hat eh keine
        // persistence).
      }
    };

    // Trigger 1: page-load catch-up. Wenn wir online sind, sofort drainen.
    if (navigator.onLine) {
      void doDrain();
    }

    // Trigger 2: online-event listener. Wenn der user von offline → online
    // wechselt, drain ausführen. Auch wenn der SW Background Sync hat,
    // schadet's nicht — /api/sync/drain ist idempotent.
    const onOnline = () => {
      void doDrain();
    };
    window.addEventListener('online', onOnline);

    return () => {
      canceled = true;
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
}
