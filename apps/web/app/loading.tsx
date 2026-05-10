import { Skeleton } from '@/components/ui/skeleton';

/**
 * Track 4 #54 (Section J) — Global Route-Loading Skeleton.
 *
 * Next.js erwartet `app/loading.tsx` als Suspense-fallback der gerendert
 * wird während ein server-component-segment noch streamt. Vorher: bei
 * server-component-navigation (besonders auf langsamen DB-queries wie
 * /admin/stats oder /live) sah der user die alte page bis die neue
 * fertig war — kein loading-indicator, gefühlt "klick passiert nichts".
 *
 * Jetzt: route-skeleton mit page-shape (header-strip + KPI-grid + content-
 * blocks). Generisch genug für alle pages, spezifisch genug dass es nicht
 * wie ein default-spinner aussieht.
 *
 * # Was rendert das nicht?
 *
 *   - Der AppShell (header + sidebar) — der ist im outer layout und
 *     bleibt stehen während dieser content-bereich tauscht. Heißt: die
 *     nav ist während ladezeit weiter sichtbar+interaktiv, was der
 *     wichtigste UX-win ist.
 *   - View-transitions — die ablaufen unabhängig vom loading.tsx und
 *     greifen über den nav-event (siehe lib/view-transitions.ts).
 *
 * # Server-component
 *
 * Reines statisches markup mit Skeleton-pulse via CSS animation.
 * Server-render damit kein client-bundle-cost — loading.tsx wird sowieso
 * nur als fallback gerendert, sollte so leicht wie möglich sein.
 *
 * # Per-route customization
 *
 * Wenn einzelne routes ein page-spezifisches loading-skeleton brauchen
 * (z.B. /live mit map-preview-shape), können die ihr eigenes
 * `loading.tsx` in der route-folder droppen — Next.js' nested-fallback-
 * pattern picked dann das spezifischere file.
 */
export default function Loading() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        {/* Header-strip: title + subtitle + actions auf der rechten seite.
            Matched die meisten landing-pages (Dashboard, Bookings, Admin-
            Stats, etc.) damit der layout-shift beim swap minimal ist. */}
        <header className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-32" />
          </div>
        </header>

        {/* KPI-grid placeholder. Vier cards weil das das häufigste pattern
            ist (Dashboard, /admin/stats). Auto-fit + minmax sorgt dafür dass
            es auf schmalen viewports zu 2-spalten kollabiert wie die echten
            grids im app. */}
        <div
          className="grid gap-6 mb-8"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 space-y-3"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>

        {/* Content-block placeholder. Drei row-blöcke approximieren eine
            typische listing-page (PIREPs, Bookings, Pilots-Roster). */}
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>

        {/* Screen-reader hint — aria-live mit polite damit assistive-tech
            den ladezustand mitkriegt. Visuell hidden via sr-only damit's
            sehende user nicht sehen (die haben ja schon die skeleton-
            pulse als visueller indicator). */}
        <span className="sr-only" aria-live="polite">
          Inhalt wird geladen…
        </span>
      </div>
    </main>
  );
}
