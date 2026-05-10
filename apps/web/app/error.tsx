'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Track 4 #50 (Section J) — Route-level Error Boundary.
 *
 * Next.js erwartet `app/error.tsx` als client-component die unerwartete
 * Fehler in den child-segments abfängt. Vorher: bei jeder uncaught
 * exception sah der user die default-next-error-screen-overlay (in dev)
 * oder einen leeren screen (in prod). Jetzt: hübsche fallback-page mit
 * retry-button + zurück-zum-dashboard-link.
 *
 * # Was wird hier nicht abgefangen?
 *
 * Errors aus dem root-layout selbst (auth-fetch, theme-provider crash)
 * — die brauchen ein `global-error.tsx` parallel zur layout. Siehe
 * `global-error.tsx` für den fall.
 *
 * # Reset-button
 *
 * Next gibt eine `reset()`-funktion mit die den error-boundary
 * re-rendert (versucht den failed segment nochmal). Sinnvoll wenn der
 * error transient war (network-blip, race condition). Bei fundamental-
 * broken-state ist der retry no-op und der user merkt's am gleichen
 * error.
 *
 * # Logging
 *
 * Next loggt errors auf server-side automatisch (mit digest). Hier
 * setzen wir noch ein useEffect mit console.error für client-side
 * debugging. In prod könnten wir hier sentry/datadog beacons schicken.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[Route-Error]', error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-4" aria-hidden="true">
          💥
        </div>
        <h1 className="text-2xl font-bold mb-2">Etwas ist schiefgelaufen</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
          Beim Laden dieser Seite ist ein unerwarteter Fehler aufgetreten.
          Du kannst es nochmal versuchen oder zurück zum Dashboard gehen.
        </p>

        {error.digest && (
          <p className="text-xs font-mono text-gray-400 dark:text-gray-600 mb-6">
            Fehler-ID: {error.digest}
          </p>
        )}

        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded text-sm transition"
          >
            Nochmal versuchen
          </button>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
          >
            ← Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
