/**
 * Track 5 #22 (Section E) — Service Worker
 *
 * Offline-cache + fetch-strategy layer für VAM System. Vanilla SW, kein
 * Workbox/next-pwa — Next.js 16 + Turbopack + Tailwind v4 ist ein
 * spezifischer-genug stack dass plugin-magic mehr probleme schafft als
 * löst. ~200 zeilen reines fetch-event-routing sind transparent + debugbar.
 *
 * # Cache strategy matrix
 *
 *   Request kind                          | Strategy              | Why
 *   ─────────────────────────────────────────────────────────────────────
 *   /_next/static/* (JS/CSS hashed)       | cache-first           | Filename hash → immutable
 *   /_next/image, *.png/svg/jpg/gif/webp  | stale-while-revalidate| Fast + fresh in background
 *   /icon.svg, /manifest.webmanifest      | stale-while-revalidate| Same as images
 *   Navigation (mode=navigate, RSC)       | network-first         | Always try fresh, fallback offline
 *   /api/*                                | bypass (no cache)     | Mutations + dynamic data
 *   ?ofp_id=… (SimBrief callback)         | bypass                | One-shot, server consumes
 *   /_next/data/* (RSC payload prefetch)  | bypass                | Let next-router handle freshness
 *   Other GET                             | network-first         | Default safe choice
 *
 * # Cache versioning
 *
 * Single CACHE_VERSION konstante als single-source-of-truth. Beim bump
 * cleart der activate-handler alle alten caches. Format: `vam-sw-vN`.
 * Browsers cachen den SW selbst max 24h regardless of cache-headers, also
 * propagiert ein SW-update innerhalb eines tages an alle clients.
 *
 * # skipWaiting policy
 *
 * Wir rufen self.skipWaiting() NICHT auf — bei aktiven tabs könnte das
 * mid-page eine RSC-version mismatchen mit static-assets. Stattdessen:
 * neuer SW wartet bis alle tabs geschlossen sind, dann aktiviert er sich
 * beim nächsten visit. clients.claim() auch nicht — selber grund.
 *
 * Trade-off: user kriegt updates erst beim nächsten kompletten browser-
 * tab-close + reopen. Für ein VA-app akzeptabel weil daily-active-pilot
 * den browser eh oft schließt. Eine "Update verfügbar"-banner-UX kommt
 * separat in einem späteren feature (out-of-scope für #22).
 *
 * # Minimaler precache (Track 5 #23)
 *
 * Wir precachen nur /offline beim install-event. Klassische SW-tutorials
 * precachen den ganzen "app shell" aber bei Next.js 16 sind static-assets
 * hashed (`/_next/static/chunks/page-abc123.js`) und ändern sich pro-build
 * — ein vollständiges precache-manifest müsste vom build-step generiert
 * werden (was Workbox/next-pwa machen).
 *
 * Stattdessen: on-demand caching für die meisten assets. Erster page-visit
 * ist online (cache miss → network → cache). Nachfolgende visits zeigen
 * cached content sofort. /offline wird trotzdem aktiv precached weil's der
 * navigation-fallback bei totalem cache-miss ist (siehe networkFirst).
 */

// CACHE_VERSION bump-history:
//   v1 — Initial release (Track 5 #22)
//   v2 — Add /offline precache for navigation-fallback (Track 5 #23)
//   v3 — Add push + notificationclick event-handlers (Track 5 #24)
//   v4 — Add sync event-handler for IDB-drained drafts (Track 5 #25)
const CACHE_VERSION = 'vam-sw-v4';

// Routes die beim install-event aktiv geholt + gecached werden (statt
// on-demand). Aktuell nur /offline damit der navigation-fallback in
// networkFirst() funktioniert auch wenn der user die offline-page nie
// online besucht hat. Best-effort: fetch-failure beim precache crasht
// das SW-install NICHT (Promise.allSettled + try/catch).
//
// Was NICHT precached wird:
//   - Static assets (/_next/static/...) — hashed filenames ändern sich
//     pro build, ein precache-manifest müsste vom build-step generiert
//     werden. Stattdessen: on-demand-caching via cache-first.
//   - Dashboard/pages — würden user-spezifische daten cachen die offline
//     veraltet wären. Stattdessen: network-first cached organisch.
const PRECACHE_URLS = ['/offline'];

// Pfad-prefixe die NIE durch den SW gehen — direkt an network weiter.
// Reihenfolge: most-specific first damit early-return cheap ist.
const BYPASS_PATH_PREFIXES = [
  '/api/', // Server-actions + REST endpoints — mutations dürfen nie aus cache.
  '/_next/data/', // RSC-payload prefetch, next-router handles freshness selbst.
  '/auth/', // NextAuth callbacks — strictly fresh.
];

// Query-params deren presence einen bypass triggert. ofp_id ist SimBrief's
// callback-marker und wird server-side im booking/[id]/page.tsx konsumiert
// (state-transition + redirect). Cache-hit hier würde die transition
// silent-skippen.
const BYPASS_QUERY_PARAMS = ['ofp_id', 'ofp_error'];

// File-extensions die als "image-ähnlich" behandelt werden → SWR-strategy.
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|avif)$/i;

// ─────────────────────────────────────────────────────────────────────
// Install — registration-zeitpunkt, läuft pro SW-version genau 1x
// ─────────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Best-effort precache: jede URL einzeln fetchen + cachen. Promise.
      // allSettled damit eine failure (z.B. /offline noch nicht deployed
      // bei rolling-deploy) NICHT den ganzen SW-install zerlegt — wäre
      // ein outage worst-case. cache: 'no-cache' am fetch zwingt einen
      // frischen request statt browser-cache (sonst könnten wir veraltete
      // versionen einlocken).
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response.ok) {
              await cache.put(url, response);
            }
          } catch {
            // Network-fail beim precache → ignorieren. Cache-miss bei
            // späterem navigation-fallback bedeutet halt browser-default
            // offline-error, was wir auch vor #23 hatten. Kein regression.
          }
        }),
      );
    })(),
  );
});

// ─────────────────────────────────────────────────────────────────────
// Activate — wenn dieser SW die kontrolle übernimmt (typisch nach
// install und nachdem alle alten tabs geschlossen sind)
// ─────────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Alte cache-buckets aufräumen — wir behalten nur CACHE_VERSION.
      // Ohne cleanup würde der browser über zeit pro deploy ~1MB an
      // toten caches sammeln.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      );
    })(),
  );
});

// ─────────────────────────────────────────────────────────────────────
// Fetch — der heart of the SW. Route jeden GET-request durch die
// passende strategy (siehe matrix im header).
// ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Non-GET methods: POST/PUT/PATCH/DELETE etc. immer direkt durchlassen.
  // Server-actions kommen als POST mit Next-Action header — niemals cachen.
  if (request.method !== 'GET') return;

  // Nur same-origin. CDN-fetches (z.B. avatar-images vom auth-provider,
  // SimBrief-OFP-fetches) gehen am SW vorbei damit wir nicht versehentlich
  // CORS-responses cachen die später als opaque-response unusable wären.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Bypass-paths: API, RSC-prefetch, auth.
  if (BYPASS_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  // Bypass-query-params: SimBrief callback markers etc.
  if (BYPASS_QUERY_PARAMS.some((param) => url.searchParams.has(param))) {
    return;
  }

  // Route nach asset-typ:
  if (url.pathname.startsWith('/_next/static/')) {
    // Hashed bundles — cache-first, immutable.
    event.respondWith(cacheFirst(request));
    return;
  }

  if (
    url.pathname.startsWith('/_next/image') ||
    IMAGE_EXTENSIONS.test(url.pathname) ||
    url.pathname === '/manifest.webmanifest'
  ) {
    // Images + manifest — SWR. Fast first paint vom cache, refresh im hintergrund.
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Navigation + RSC + alles andere — network-first, cache als fallback.
  // request.mode === 'navigate' für top-level HTML-document-requests.
  // RSC-requests haben mode='cors' aber wir poolen die hier zusammen weil
  // network-first für beide korrekt ist.
  event.respondWith(networkFirst(request));
});

// ─────────────────────────────────────────────────────────────────────
// Strategy implementations
// ─────────────────────────────────────────────────────────────────────

/**
 * cache-first: probiere zuerst den cache, fall back auf network. Bei
 * network-success wird der cache aktualisiert. Geeignet für hashed-
 * immutable bundles wo der filename selbst die version trägt — ein
 * cache-hit kann NIE outdated sein weil ein neuer build zu einer
 * anderen URL führt.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Nur successful responses cachen. 4xx/5xx würden bei nächstem visit
    // ein "kaputtes asset" servieren — better die nächste request retry-en.
    if (response.ok) {
      // response.clone() weil response-streams nur 1x konsumiert werden können.
      cache.put(request, response.clone()).catch(() => {
        // Quota-exceeded oder andere cache-write-errors stillschweigend
        // schlucken — die response geht trotzdem zum client weiter.
      });
    }
    return response;
  } catch (err) {
    // Network-failure auf einem cache-miss → nichts können wir tun.
    // Browser zeigt den default offline-error. Eine offline-page-route
    // (Track 5 #23) wird hier später ein navigation-fallback bekommen,
    // aber für statische assets gibt's keinen sinnvollen fallback.
    throw err;
  }
}

/**
 * stale-while-revalidate: gib cache-version sofort zurück (wenn da),
 * triggere parallel einen network-fetch um den cache zu updaten.
 * Geeignet für nicht-immutable assets die "fresh enough" sein dürfen
 * (images, manifest). User sieht alten content beim ersten paint, beim
 * nächsten besuch dann den frischen.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  // Network-fetch immer starten, egal ob cache-hit oder -miss. Bei
  // success wird der cache überschrieben. Errors silently swallowed —
  // bei cache-hit hat der user trotzdem content, bei cache-miss wird
  // der throw weiter unten gefangen.
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  // Cache-hit: sofort zurückgeben, network im hintergrund.
  if (cached) return cached;

  // Cache-miss: warte auf network. Wenn das fehlschlägt, throw.
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  throw new Error('staleWhileRevalidate: cache miss + network failure');
}

/**
 * network-first: probiere network, fall back auf cache. Bei success
 * wird der cache aktualisiert. Geeignet für navigation/RSC wo wir
 * frische daten bevorzugen aber offline-fallback brauchen.
 *
 * # Navigation-fallback (Track 5 #23)
 *
 * Wenn der request eine navigation war (mode === 'navigate'), und weder
 * network noch cache funktionieren, servieren wir die precachierte
 * /offline-page statt einen browser-default-error zu zeigen. Die page
 * detektiert client-side wann der user wieder online ist und redirected
 * dann automatisch.
 *
 * RSC-requests (mode === 'cors' aber gleicher accept-header) kriegen
 * den fallback NICHT — sie würden HTML servieren wo der client RSC-payload
 * erwartet, was hydration komplett verseucht. Stattdessen wirft network-
 * first für RSC und next-router fängt das als navigation-error → triggert
 * eine echte navigation → kommt dann durch den navigate-branch.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // Network failed → versuche cache.
    const cached = await cache.match(request);
    if (cached) return cached;

    // Track 5 #23: navigation-fallback zur precachierten /offline-page.
    // Nur für echte top-level navigations (request.mode === 'navigate')
    // — RSC-fetches kriegen einen throw damit next-router das richtig
    // als navigation-error behandelt.
    if (request.mode === 'navigate') {
      const offlineFallback = await cache.match('/offline');
      if (offlineFallback) return offlineFallback;
    }

    // Letzter resort: throw → browser zeigt default offline-error.
    // Sollte praktisch nie passieren wenn /offline im precache landet.
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Push notifications (Track 5 #24)
//
// Empfängt eine push-payload vom push-service und zeigt eine system-
// notification an. Der payload kommt vom server (apps/web/lib/push/vapid.ts)
// als JSON.stringify-output der PushPayload-shape:
//
//   { title: string, body: string, url?: string, tag?: string }
//
// Wir packen das in self.registration.showNotification() — der OS-native
// notification-handler zeigt's an und der user kann drauf klicken (siehe
// notificationclick-handler unten).
//
// # Robuste payload-handhabung
//
// Wenn der payload kein JSON ist (theoretisch möglich bei wrong-server-
// code oder beim push-service-spam), zeigen wir trotzdem eine generische
// notification statt zu crashen — eine SW exception würde dem push-service
// einen 5xx-equivalent signalisieren und der nächste push würde retry-en,
// was eine notification-flood produzieren kann.
//
// # userVisibleOnly compliance
//
// Wir haben beim PushManager.subscribe() userVisibleOnly:true gesetzt.
// Das BEDEUTET: jeder push MUSS in einer sichtbaren notification enden,
// sonst dropt der browser zukünftige pushes komplett (und der user kriegt
// keinen visuellen indikator dass push-permission revoked ist). Deshalb
// zeigen wir bei JEDEM push-event eine notification, auch bei kaputtem
// payload.
// ─────────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  // Default-payload falls server-payload nicht parsbar — siehe userVisibleOnly-
  // kommentar oben. Bewusst generisch damit der user weiß dass was kam aber
  // ohne falsche/erratenen content anzuzeigen.
  let payload = {
    title: 'VAM System',
    body: 'Neue Benachrichtigung',
    url: '/',
    tag: undefined,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      // Defensive copy — wir nehmen nur die felder die wir kennen, damit ein
      // payload mit zusätzlichen unerwarteten fields nicht ungewollt
      // forwarded wird (XSS-vermeidung in notification-options).
      payload = {
        title:
          typeof parsed.title === 'string' && parsed.title.length > 0
            ? parsed.title
            : 'VAM System',
        body:
          typeof parsed.body === 'string' && parsed.body.length > 0
            ? parsed.body
            : 'Neue Benachrichtigung',
        url: typeof parsed.url === 'string' ? parsed.url : '/',
        tag: typeof parsed.tag === 'string' ? parsed.tag : undefined,
      };
    } catch {
      // JSON parse fail — fall through with default payload.
    }
  }

  const notificationOptions = {
    body: payload.body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag, // Coalescing: gleicher tag ersetzt frühere notif
    data: { url: payload.url },
    // requireInteraction: false (default) damit notifications auto-dismissen
    // nach ein paar sekunden — wir wollen nicht den notification-tray
    // dauerhaft mit VAM-zeug fluten.
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions),
  );
});

/**
 * Notification-click handler. Wenn der user auf eine notification klickt:
 *
 *   1. Notification schließen (default browser-verhalten, aber explizit machen)
 *   2. Schauen ob ein VAM-tab schon offen ist
 *      → ja: focus + navigate zum url
 *      → nein: neuen tab/window öffnen mit dem url
 *
 * Der url kommt aus dem data.url der notification (gesetzt im push-handler).
 * Default '/' wenn kein url gesetzt.
 *
 * # Why clients.matchAll vor openWindow?
 *
 * Wenn der user die app schon offen hat (typischer fall — PWA installiert,
 * tab im hintergrund), wollen wir keinen DUPLIKAT-tab öffnen sondern den
 * existing focus-en. Nur wenn KEIN VAM-tab offen ist, öffnen wir einen
 * neuen. Das ist das selbe pattern wie z.B. Discord oder Slack web-apps.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Suche nach einem existing VAM-tab. Same-origin filter weil clients
      // outside unserer origin (sollte nicht passieren bei type:'window',
      // aber defensive) nicht von uns gesteuert werden können.
      for (const client of allClients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        // Existing tab gefunden → navigieren + focus.
        // client.navigate() ist die korrekte API (postMessage wäre nur
        // für arbitrary-data-passing, navigate ist für URL-changes).
        if ('navigate' in client) {
          try {
            await client.navigate(targetUrl);
          } catch {
            // navigate kann throw werden wenn die ziel-URL cross-origin
            // ist oder andere edge-cases — fallback ist nur focus.
          }
        }
        return client.focus();
      }

      // Kein existing tab → neuen öffnen.
      return self.clients.openWindow(targetUrl);
    })(),
  );
});

// ─────────────────────────────────────────────────────────────────────
// Background Sync (Track 5 #25)
//
// Wenn der user offline drafts ins IDB-queue tut (apps/web/lib/sync/
// draft-queue.ts), registriert der client einen sync-task mit tag
// 'vam-drafts-drain'. Wenn der browser detected dass connectivity zurück
// ist, feuert ein sync-event im SW — wir reagieren mit einem batched
// POST an /api/sync/drain, und löschen die successful-drafts aus IDB.
//
// # Browser-support
//
// Background Sync API: chrome/edge YES, firefox/safari NO.
// Firefox/Safari user kriegen den selben effect via window.online-event
// im BackgroundSyncManager (apps/web/components/BackgroundSyncManager.tsx)
// — beide pfade hitten die selbe /api/sync/drain route + sind idempotent.
//
// # IDB-schema (geteilt mit draft-queue.ts!)
//
// MUSS identisch zu den constants in draft-queue.ts sein. Wenn dort was
// ändert, MUSS hier auch ändern (oder der SW liest die alte DB-version
// die ein anderes schema hat → broken state).
// ─────────────────────────────────────────────────────────────────────

const DRAFT_DB_NAME = 'vam-drafts-v1';
const DRAFT_STORE = 'drafts';
const DRAFT_DB_VERSION = 1;
const DRAFT_SYNC_TAG = 'vam-drafts-drain';

/**
 * Open the draft-queue DB read-write. Identical schema zur client-side
 * draft-queue.ts. Wenn die DB noch nicht existiert (z.B. SW läuft auf
 * einem device wo der user nie offline-drafts hatte), wird sie hier
 * created (upgrade-event) — onupgradeneeded mirrored damit der state
 * konsistent ist.
 */
function openDraftDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        const store = db.createObjectStore(DRAFT_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('kind', 'kind', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/** Read all drafts from IDB. */
function readAllDrafts(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readonly');
    const store = tx.objectStore(DRAFT_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('getAll failed'));
  });
}

/** Delete one draft by id. */
function deleteDraftById(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('delete failed'));
  });
}

/** Increment retryCount on a draft (für failed/skipped ids). */
function bumpRetryCount(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return resolve();
      record.retryCount = (record.retryCount || 0) + 1;
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error || new Error('put failed'));
    };
    getReq.onerror = () => reject(getReq.error || new Error('get failed'));
  });
}

/**
 * Drain all drafts: read from IDB, POST batched zu /api/sync/drain,
 * apply server's per-draft verdict (processed → delete, failed/skipped →
 * bump retryCount).
 *
 * Throws bei network-error damit der SW-sync-manager retry-en kann
 * (sync.register mit dem selben tag macht das automatisch).
 */
async function drainDrafts() {
  const db = await openDraftDb();
  const drafts = await readAllDrafts(db);
  if (drafts.length === 0) return; // nothing to do

  // Batched POST. credentials werden vom SW-fetch automatisch mitgeschickt
  // (cookies inkl. session-cookie sind same-origin).
  const response = await fetch('/api/sync/drain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drafts }),
  });

  if (!response.ok) {
    // 401/403/5xx → throw, SW retries. retryCount NICHT gebumped weil
    // wir gar nicht zu per-draft verdicts gekommen sind — der ganze
    // batch ist transiently failed.
    throw new Error(`drain failed: ${response.status}`);
  }

  const result = await response.json();
  const processedIds = new Set(result.processedIds || []);
  const failedIds = new Set([
    ...(result.failedIds || []),
    ...(result.skippedIds || []),
  ]);

  // Apply per-draft verdicts. processed → DB-delete, failed/skipped →
  // retryCount-bump. Promise.allSettled damit eine DB-write-failure (rare,
  // quota etc.) nicht den ganzen rest blockt.
  await Promise.allSettled([
    ...[...processedIds].map((id) => deleteDraftById(db, id)),
    ...[...failedIds].map((id) => bumpRetryCount(db, id)),
  ]);
}

self.addEventListener('sync', (event) => {
  if (event.tag !== DRAFT_SYNC_TAG) return;
  event.waitUntil(
    drainDrafts().catch((err) => {
      // Throw zurück, damit der SW-sync-manager weiß dass wir nicht
      // erfolgreich waren und einen retry scheduled. Browser exponential-
      // backoff handhabt das (typisch: 5min, 30min, 1h, 5h, ...).
      throw err;
    }),
  );
});

