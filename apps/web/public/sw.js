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
const CACHE_VERSION = 'vam-sw-v2';

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
