'use client';

import { useEffect, useState } from 'react';

/**
 * Track 5 #23 (Section E) — Offline Fallback Content (client-component)
 *
 * Interaktive teile der offline-page. Siehe page.tsx für architektur-rationale.
 *
 * # State machine
 *
 *   mount       → isOnline = true (SSR-default für hydration-safety)
 *   useEffect   → isOnline = navigator.onLine (echter wert)
 *   'online'    → setOnline(true) + auto-redirect nach 1.5s zu /
 *   'offline'   → setOnline(false)
 *
 * Der SSR-default ist BEWUSST optimistic (online). Wenn der user die page
 * direkt aufruft (= ist online), sieht er keinen flash. Wenn der SW die
 * cached page serviert (= ist offline), gibt's einen kurzen flash von
 * "online" → "offline" beim ersten paint, aber das ist OK weil die page
 * eh zum lesen da ist, nicht zum interagieren.
 *
 * Alternative wäre suppressHydrationWarning + navigator.onLine im
 * useState-initializer, aber das ist mehr code für minimal UX-gain.
 *
 * # Auto-redirect bei online-event
 *
 * navigator.onLine + 'online'-event sind unsere best-effort signale.
 * navigator.onLine lügt manchmal — es zeigt "online" wenn das netzwerk-
 * interface verbunden ist auch wenn DNS/server unreachable sind. Für
 * unsere zwecke (retry-trigger) trotzdem nützlich.
 *
 * Wir warten 1.5s vor dem redirect damit der user den "wieder verbunden"
 * confirmation-state kurz sieht. Sonst würde die page sofort wegblinkern
 * sobald wi-fi zurück ist und der user wäre verwirrt.
 */
export function OfflineContent() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      // Kurze pause damit user den "wieder verbunden"-state sieht.
      window.setTimeout(() => {
        // Hard navigation statt next-router weil offline → online wechsel
        // bedeutet wir wollen einen frischen page-load, nicht einen
        // client-side-router-update (der ggf. stale-cache nutzt).
        window.location.href = '/';
      }, 1500);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleRetry = () => {
    // location.reload() ist die richtige action: wenn der SW noch aktiv
    // ist und cache hat → fresh fetch wird versucht → bei success normal
    // page, bei failure landet user wieder hier. Idempotent + kein
    // router-state-drift.
    window.location.reload();
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-6">
      <div className="max-w-md w-full text-center">
        {/* Status-icon: green-wifi-on bei isOnline, amber-wifi-off bei offline.
            Beide SVGs sind feather-style stroke-icons (no fill) damit der
            farb-wechsel sauber durch text-color geht. */}
        <div className="mb-8 flex justify-center">
          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${
              isOnline
                ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
            }`}
          >
            {isOnline ? (
              // Wifi-on icon (feather/lucide style)
              <svg
                className="w-10 h-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            ) : (
              // Wifi-off icon — wifi-shape mit diagonalem strikethrough
              <svg
                className="w-10 h-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            )}
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-3">
          {isOnline ? 'Wieder verbunden!' : 'Du bist offline'}
        </h1>

        <p className="text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
          {isOnline
            ? 'Verbindung wiederhergestellt — du wirst gleich weitergeleitet…'
            : 'Diese seite ist nicht im offline-cache. Bereits geladene seiten bleiben verfügbar — du kannst sie über die zurück-taste oder einen direkten link erreichen.'}
        </p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={isOnline}
            className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
          >
            {isOnline ? 'Wird weitergeleitet…' : 'Erneut versuchen'}
          </button>

          {!isOnline && (
            <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
              Tipp: PIREP-entwürfe und kürzlich besuchte routes funktionieren
              auch offline weiter — der service-worker hält sie im cache.
            </p>
          )}
        </div>

        {/* Footer: feature-attribution + small VAM brand-mark damit die
            page nicht völlig anonym wirkt. ✈ statt full-logo weil's auch
            offline ohne external-asset-fetch funktioniert. */}
        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800">
          <p className="text-xs text-gray-500 flex items-center justify-center gap-2">
            <span aria-hidden="true">✈</span>
            <span>VAM System · Service Worker offline-fallback</span>
          </p>
        </div>
      </div>
    </main>
  );
}
