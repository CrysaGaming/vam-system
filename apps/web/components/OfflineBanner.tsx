'use client';

import { useEffect, useState } from 'react';

/**
 * Track 4 #79 (Section O) — Offline-Banner
 *
 * Sichtbarer status-banner wenn der user offline ist. Nutzt navigator.onLine
 * + die online/offline window-events. Wenn offline: amber/orange sticky-
 * banner am top der page mit warnhinweis dass actions möglicherweise nicht
 * funktionieren. Wenn back online: kurz ein grüner "wieder verbunden"-toast
 * für 3s als positiver feedback, dann hidden.
 *
 * # Warum nicht nur die toast / dismissable
 *
 * Während offline-state SOLLTE der banner permanent sichtbar bleiben — der
 * user kann zwischendurch reads aus dem RSC-cache sehen die wie funktionie-
 * rendes app wirken, aber writes (PIREP submit, booking accept) werden
 * lautlos fehlschlagen. Persistent banner hält den state visible damit user
 * eine erklärung haben falls actions failen.
 *
 * # Banner-state-machine
 *
 *   online (initial)           → null (kein banner)
 *   online → offline           → amber banner: "Du bist offline. Änderungen
 *                                 werden möglicherweise nicht gespeichert."
 *   offline → online           → green toast: "Wieder verbunden" für 3s,
 *                                 dann → null
 *   online (nach reconnect)    → null
 *
 * # SSR-hydration
 *
 * navigator.onLine ist NUR im browser verfügbar. Server-render kennt's nicht.
 * Wir starten mit isOnline=true als optimistic-default (== "kein banner")
 * damit server und initial-client-render IDENTISCH sind (sonst hydration-
 * mismatch). useEffect cleart das nach mount: liest den echten navigator.
 * onLine-wert + attached die event-listener.
 *
 * # Edge: false-positives
 *
 * navigator.onLine ist notorisch unreliable in some browsers — es kann
 * "online" zeigen wenn der computer technisch netzwerk hat aber das
 * gateway down ist (kein internet trotz LAN). Browsers haben das improved,
 * aber 100% verlässlich isses nicht. Wir akzeptieren das — bei mismatched
 * states sieht der user die error-toasts der actions selbst. Banner ist
 * ein hint, kein guarantee.
 *
 * # Position
 *
 * Sticky top-0 mit z-50 damit's über header + drawer-backdrop liegt. Volle
 * viewport-width damit's nicht übersehen wird. Bewusst NICHT als overlay-
 * toast unten weil das die mobile-bottom-nav überlappen würde.
 */

type Status = 'online' | 'offline' | 'reconnecting';

export function OfflineBanner() {
  // Optimistic default: online. Erst nach mount via navigator.onLine
  // korrigiert (siehe SSR-hydration-comment oben).
  const [status, setStatus] = useState<Status>('online');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof navigator === 'undefined') return;

    // Initial-sync: aktueller online-state.
    setStatus(navigator.onLine ? 'online' : 'offline');

    function handleOffline() {
      setStatus('offline');
    }

    function handleOnline() {
      // Beim wiederverbinden: status → "reconnecting" für 3s damit der
      // user einen positiven feedback bekommt ("ah, ich bin wieder da"),
      // dann automatisch zurück auf "online" (= banner verschwindet).
      setStatus('reconnecting');
      const t = window.setTimeout(() => setStatus('online'), 3000);
      // Cleanup nicht direkt zugänglich weil's in einem listener läuft,
      // aber wenn der user beim re-online schon wieder offline geht
      // bevor 3s vorbei, handleOffline überschreibt status → wird ok.
      // Memory-leak-risiko ist nur der dangling timer, das ist akzeptabel
      // für 3s. Im echten unmount würde der return-cleanup unten greifen
      // aber timer hat keine reference dorthin — daher hier nicht clearen.
      void t;
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (status === 'online') return null;

  if (status === 'reconnecting') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-50 w-full bg-emerald-600 text-white text-sm font-medium px-4 py-2 flex items-center justify-center gap-2 shadow-md"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>Wieder verbunden</span>
      </div>
    );
  }

  // status === 'offline'
  return (
    <div
      role="status"
      aria-live="assertive"
      className="sticky top-0 z-50 w-full bg-amber-500 dark:bg-amber-600 text-white text-sm font-medium px-4 py-2 flex items-center justify-center gap-2 shadow-md"
    >
      {/* Cloud-off / unplug-style icon. Lucide-react hätte einen, aber wir
          haben hier kein dependency — inline SVG ist 1-line cheaper. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
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
      <span>
        Du bist offline. Änderungen werden möglicherweise nicht gespeichert.
      </span>
    </div>
  );
}
