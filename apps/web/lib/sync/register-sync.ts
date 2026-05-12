/**
 * Track 5 #25 (Section E) — Background-Sync Registration Helper
 *
 * Wraps die Background Sync API (chrome/edge) mit einem online-event
 * fallback (firefox/safari/older browsers). Ein einziger entry-point für
 * die UI: queueDraftAndScheduleSync() — wenn die UI was ins queue tut,
 * ruft sie auch das hier auf um den drain irgendwann zu triggern.
 *
 * # Browser-support matrix
 *
 *                       | Chrome  | Edge | Firefox | Safari
 *   Background Sync API |   ✅    |  ✅  |   ❌    |   ❌
 *   navigator.onLine    |   ✅    |  ✅  |   ✅    |   ✅
 *   'online' event      |   ✅    |  ✅  |   ✅    |   ✅
 *
 * Beide pfade führen am ende zu fetch('/api/sync/drain') — entweder vom
 * SW (Background Sync) oder vom client (online-event-fallback).
 *
 * # Sync-tag
 *
 * Wir nutzen einen single tag 'vam-drafts-drain'. Background Sync
 * deduped auf den tag, d.h. mehrfache register()-calls mit dem selben
 * tag = ein einziger drain-attempt. Das ist genau was wir wollen:
 * wenn der user 5 drafts in einem offline-burst enqueued, soll der SW
 * EINMAL drainen wenn er online ist, nicht 5x.
 */

export const DRAFT_SYNC_TAG = 'vam-drafts-drain';

/**
 * Versucht eine Background Sync zu registrieren. Returns true wenn die
 * API verfügbar war + register erfolgreich, false wenn nicht (caller
 * sollte dann auf online-event fallback verlassen).
 *
 * # Why .ready statt .controller?
 *
 * navigator.serviceWorker.ready wartet auf eine ACTIVE registration —
 * das ist was wir wollen für sync.register. .controller könnte null
 * sein wenn der SW grade frisch installiert wurde aber noch keinen tab
 * controlled. ready resolved erst wenn der SW aktiv ist + bereit für
 * sync-tasks.
 */
export async function tryRegisterDraftSync(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    // TypeScript hat 'sync' nicht im default ServiceWorkerRegistration-type
    // weil's noch nicht baseline ist. Wir checken at-runtime + casten lokal.
    const reg = registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (!reg.sync || typeof reg.sync.register !== 'function') {
      return false;
    }
    await reg.sync.register(DRAFT_SYNC_TAG);
    return true;
  } catch {
    // SyncManager.register kann throw werden z.B. wenn permission
    // 'background-sync' denied ist (rare, default ist granted). In
    // dem fall fallback zum online-event-path.
    return false;
  }
}

/**
 * Direct drain-trigger fürs online-event-fallback. Macht den selben
 * POST den der SW machen würde, aber vom client-context. Wird vom
 * BackgroundSyncManager aufgerufen bei window.online events ODER bei
 * page-load wenn navigator.onLine === true UND drafts queued sind.
 *
 * Returns ein report-shape damit caller logging machen können. Errors
 * werden NICHT geworfen — wir wollen das UI nicht crashen wenn der
 * server temporär 5xx-t. retryCount-bump passiert im drain-handler
 * pro draft.
 */
export async function drainDraftsFromClient(): Promise<{
  drained: number;
  failed: number;
  attempted: number;
}> {
  // Lazy import des draft-queue moduls damit dieser file selbst
  // server-side imported werden könnte (kein IDB-access nötig wenn man
  // nur die TAG-konstante braucht). Aktuell wird der file aber nur
  // client-side imported, lazy bleibt aber als safety-net.
  const { listDrafts, removeDraft, incrementRetryCount } = await import(
    './draft-queue'
  );

  const drafts = await listDrafts();
  if (drafts.length === 0) {
    return { drained: 0, failed: 0, attempted: 0 };
  }

  let drained = 0;
  let failed = 0;

  try {
    const response = await fetch('/api/sync/drain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drafts }),
      // Same-origin: cookies inkl. session-cookie werden mitgeschickt.
      credentials: 'same-origin',
    });

    if (!response.ok) {
      // 401/403: auth-fail → drafts bleiben im queue für späteren retry
      // wenn user re-authentifiziert. 4xx/5xx: bump retry-count auf alle.
      for (const draft of drafts) {
        if (typeof draft.id === 'number') {
          await incrementRetryCount(draft.id).catch(() => {});
        }
      }
      return { drained: 0, failed: drafts.length, attempted: drafts.length };
    }

    const result = (await response.json()) as {
      processedIds?: number[];
      failedIds?: number[];
    };
    const processedSet = new Set(result.processedIds ?? []);
    const failedSet = new Set(result.failedIds ?? []);

    for (const draft of drafts) {
      if (typeof draft.id !== 'number') continue;
      if (processedSet.has(draft.id)) {
        await removeDraft(draft.id).catch(() => {});
        drained++;
      } else if (failedSet.has(draft.id)) {
        await incrementRetryCount(draft.id).catch(() => {});
        failed++;
      }
    }

    return { drained, failed, attempted: drafts.length };
  } catch {
    // Network-error (offline trotz navigator.onLine === true, DNS fail,
    // etc.) — drafts bleiben im queue, retry-count NICHT gebumped weil
    // wir gar nicht den server erreicht haben.
    return { drained: 0, failed: 0, attempted: drafts.length };
  }
}
