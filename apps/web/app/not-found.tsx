import Link from 'next/link';

/**
 * Track 4 #51 (Section J) — Custom 404 / Not-Found page.
 *
 * Catch-all für routes die Next nicht matchen kann. Vorher: default-
 * next-not-found-page (graue 404). Jetzt: aviation-themed mit deep-
 * links zu den wichtigsten ressorts.
 *
 * # Wo wird das gerendert?
 *
 *   - Unbekannte URL (z.B. /banane)
 *   - Manual `notFound()`-call aus einer page (z.B. wenn ein
 *     pirep-ID nicht zur airline gehört)
 *
 * # Server-component
 *
 * Bewusst server-component (kein 'use client'), weil reines statisches
 * markup ohne interactivity. Spart hydration-overhead bei der häufig
 * besuchten error-page.
 *
 * # Quick-links
 *
 * Statt nur "← zurück" geben wir mehrere ziele weil ein 404 oft passiert
 * wenn der user direkt zu einer URL navigiert (lesezeichen, geteilter
 * link) — er weiß dann nicht unbedingt wo er hin will. Die häufigsten
 * landing-targets sind Dashboard, Live-Map, Pilots-Roster.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-4" aria-hidden="true">
          🛫
        </div>
        <h1 className="text-2xl font-bold mb-2">404 — Off Course</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">
          Die angeforderte Seite existiert nicht (mehr) oder die URL ist
          falsch. Kein Drama, hier sind die wichtigsten Anflugpunkte:
        </p>

        <div className="grid gap-2">
          <Link
            href="/dashboard"
            className="px-4 py-3 bg-primary text-primary-foreground hover:opacity-90 rounded text-sm transition flex items-center justify-center gap-2"
          >
            <span aria-hidden="true">🏠</span>
            <span>Zum Dashboard</span>
          </Link>
          <Link
            href="/live"
            className="px-4 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition flex items-center justify-center gap-2"
          >
            <span aria-hidden="true">🗺️</span>
            <span>Live-Map</span>
          </Link>
          <Link
            href="/pilots"
            className="px-4 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition flex items-center justify-center gap-2"
          >
            <span aria-hidden="true">👥</span>
            <span>Piloten-Roster</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
