import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getPublicAirline,
  FALLBACK_PRIMARY,
  FALLBACK_SECONDARY,
} from './_lib/airline';

/**
 * /a/[icao]/layout — Shared chrome for the public airline pages
 * (Welle 8 commit 8B-2).
 *
 * Owns:
 *   - The visibility/notFound check (centralized here so every sub-page
 *     gets it for free; sub-pages no longer need to repeat the
 *     publicVisible-AND-exists logic).
 *   - The hero (logo, name, tagline, identity chips) — rendered ONCE
 *     and persists across sub-page navigations (Next.js layout semantics).
 *   - Theme-var injection (--brand-primary / --brand-secondary) on the
 *     wrapper. Sub-pages consume them via inline style or plain CSS-vars.
 *   - Sub-nav (Übersicht / Hubs / Fleet / Routes / Schedule) — static link
 *     list, no active highlighting in v1 (the page heading + URL make it
 *     obvious enough; active-state would require client-component or
 *     header-reading, both feel heavier than the value).
 *   - Footer with link back to /airlines directory.
 *
 * Why these are at layout-level (not duplicated per page):
 *   - Visitor navigating between sub-pages doesn't see hero re-mount/flash.
 *   - One source of truth for the visibility policy — fix it once, applies
 *     everywhere under /a/[icao].
 *   - Brand colors don't have to be re-fetched per sub-page.
 *
 * The layout's airline-fetch is `cache()`-wrapped (see _lib/airline.ts),
 * so a sub-page that calls getPublicAirline for its own ID-resolution gets
 * the same row without an extra Postgres roundtrip.
 */
export default async function PublicAirlineLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ icao: string }>;
}) {
  const { icao: icaoRaw } = await params;
  const airline = await getPublicAirline(icaoRaw);

  if (!airline) {
    notFound();
  }

  const primary = airline.primaryColor ?? FALLBACK_PRIMARY;
  const secondary = airline.secondaryColor ?? FALLBACK_SECONDARY;

  const themeVars = {
    ['--brand-primary' as string]: primary,
    ['--brand-secondary' as string]: secondary,
  } as React.CSSProperties;

  const subNavItems: { label: string; href: string }[] = [
    { label: 'Übersicht', href: `/a/${airline.icao}` },
    { label: 'Hubs', href: `/a/${airline.icao}/hubs` },
    { label: 'Fleet', href: `/a/${airline.icao}/fleet` },
    { label: 'Routes', href: `/a/${airline.icao}/routes` },
    { label: 'Schedule', href: `/a/${airline.icao}/schedule` },
  ];

  return (
    <main
      className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white"
      style={themeVars}
    >
      {/* Hero — colored band with logo + identity chips */}
      <section
        className="relative overflow-hidden text-white"
        style={{ backgroundColor: secondary }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: `linear-gradient(135deg, ${primary} 0%, transparent 60%)`,
          }}
          aria-hidden="true"
        />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {airline.logoUrl ? (
              // Plain <img> wrapped in <picture> per project convention
              // (see project notes: <img> + Next 16 + Turbopack interaction).
              <picture>
                <img
                  src={airline.logoUrl}
                  alt={`${airline.name} Logo`}
                  className="h-20 w-20 sm:h-24 sm:w-24 rounded-lg object-contain bg-white/10 backdrop-blur-sm p-2"
                />
              </picture>
            ) : (
              <div
                className="h-20 w-20 sm:h-24 sm:w-24 rounded-lg flex items-center justify-center text-2xl sm:text-3xl font-bold tracking-tight"
                style={{ backgroundColor: primary }}
              >
                {airline.icao}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <Link
                href={`/a/${airline.icao}`}
                className="inline-block hover:opacity-90 transition"
              >
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                  {airline.name}
                </h1>
              </Link>
              {airline.tagline && (
                <p className="mt-2 text-lg text-white/80">{airline.tagline}</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <Chip label="ICAO" value={airline.icao} />
                {airline.iata && <Chip label="IATA" value={airline.iata} />}
                {airline.callsign && (
                  <Chip label="Callsign" value={airline.callsign} />
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sub-nav — sticky-ish horizontal link strip just under the hero */}
      <nav
        className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800"
        aria-label="Airline sections"
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 py-3 text-sm">
            {subNavItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Page content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {children}
      </div>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap justify-between items-center gap-2">
        <span>
          Public profile ·{' '}
          <Link href="/airlines" className="underline">
            VAM System
          </Link>
        </span>
      </footer>
    </main>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white/10 backdrop-blur-sm rounded px-2 py-1">
      <span className="text-white/60 uppercase tracking-wider">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </span>
  );
}
