import { notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';

/**
 * /a/[icao] — Public airline-page (Welle 8 commit 8B-1).
 *
 * No auth: anyone with the URL can view, BUT the airline must have
 * `publicVisible=true` (default) — admin opt-out via /airline settings
 * triggers a 404 here. We treat hidden-airline and missing-airline
 * identically (notFound) to avoid leaking existence-info ("DLH exists
 * but is hidden" → "DLH does not exist", same response).
 *
 * Theming: airline.primaryColor / secondaryColor are injected as
 * CSS-variables on the wrapping element (--brand-primary / --brand-secondary).
 * Sub-components consume them via inline style for hero/button accents.
 * If null in DB, falls back to indigo-600 / gray-800. We deliberately
 * DON'T use arbitrary Tailwind classes like `bg-[var(--brand-primary)]`
 * because Tailwind v4 + Turbopack auto-detection has known quirks with
 * dynamic class names — inline style is more robust and produces the
 * same visual result for these one-off accents.
 *
 * Sub-pages (/schedule, /fleet, /hubs) arrive in 8B-2; the preview-cards
 * here link to them speculatively. They'll 404 until 8B-2 lands —
 * acceptable for the in-progress wave.
 *
 * Caching: server-rendered on each request. We don't set explicit
 * `revalidate` because admin-edits to settings already call
 * revalidatePath('/a/[icao]') — see updateAirlineSettings.
 */
export default async function PublicAirlinePage({
  params,
}: {
  params: Promise<{ icao: string }>;
}) {
  const { icao: icaoRaw } = await params;
  const icao = icaoRaw.toUpperCase();

  const airline = await prisma.airline.findFirst({
    where: { icao, publicVisible: true },
    include: {
      _count: {
        select: {
          hubs: true,
          routes: true,
          aircraft: true,
          scheduleTemplates: true,
        },
      },
    },
  });

  if (!airline) {
    notFound();
  }

  // Parallel fetch of preview-rows. Each capped low for the overview;
  // the sub-pages handle full listings in 8B-2.
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [hubsPreview, fleetPreview, schedulePreview] = await Promise.all([
    prisma.airlineHub.findMany({
      where: { airlineId: airline.id },
      include: { airport: { select: { icao: true, name: true, city: true } } },
      orderBy: [{ isPrimary: 'desc' }, { airportIcao: 'asc' }],
      take: 5,
    }),
    prisma.aircraft.findMany({
      where: { airlineId: airline.id },
      select: { id: true, registration: true, type: true },
      orderBy: { registration: 'asc' },
      take: 6,
    }),
    prisma.scheduledFlight.findMany({
      where: {
        airlineId: airline.id,
        status: 'Planned',
        departureTime: { gte: now, lte: horizonEnd },
      },
      include: {
        route: {
          select: {
            flightNumber: true,
            departure: { select: { icao: true } },
            arrival: { select: { icao: true } },
          },
        },
      },
      orderBy: { departureTime: 'asc' },
      take: 5,
    }),
  ]);

  const primary = airline.primaryColor ?? '#4F46E5';
  const secondary = airline.secondaryColor ?? '#1F2937';

  // CSS-variable injection. Used by accent-elements via inline style.
  // The wrapping <main> sets the variables; nothing else needs to know
  // about them.
  const themeVars = {
    ['--brand-primary' as string]: primary,
    ['--brand-secondary' as string]: secondary,
  } as React.CSSProperties;

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
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                {airline.name}
              </h1>
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

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        {/* Description */}
        {airline.description && (
          <section>
            <p className="text-base leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {airline.description}
            </p>
            {airline.websiteUrl && (
              <a
                href={airline.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-4 text-sm font-medium underline underline-offset-4"
                style={{ color: primary }}
              >
                {prettyUrl(airline.websiteUrl)} ↗
              </a>
            )}
          </section>
        )}

        {/* Quick stats */}
        <section>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Hubs"
              value={airline._count.hubs}
              href={`/a/${airline.icao}/hubs`}
              accent={primary}
            />
            <StatCard
              label="Routes"
              value={airline._count.routes}
              href={`/a/${airline.icao}/routes`}
              accent={primary}
            />
            <StatCard
              label="Fleet"
              value={airline._count.aircraft}
              href={`/a/${airline.icao}/fleet`}
              accent={primary}
            />
            <StatCard
              label="Schedules"
              value={airline._count.scheduleTemplates}
              href={`/a/${airline.icao}/schedule`}
              accent={primary}
            />
          </div>
        </section>

        {/* Hubs preview */}
        {hubsPreview.length > 0 && (
          <PreviewSection
            title="Hubs"
            href={`/a/${airline.icao}/hubs`}
            accent={primary}
          >
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {hubsPreview.map((h) => (
                <li
                  key={h.id}
                  className="py-3 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">
                        {h.airport.icao}
                      </span>
                      {h.isPrimary && (
                        <span
                          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: primary }}
                        >
                          Primary
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {h.airport.name}
                      {h.airport.city && ` · ${h.airport.city}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </PreviewSection>
        )}

        {/* Fleet preview */}
        {fleetPreview.length > 0 && (
          <PreviewSection
            title="Fleet"
            href={`/a/${airline.icao}/fleet`}
            accent={primary}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {fleetPreview.map((a) => (
                <div
                  key={a.id}
                  className="p-3 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950"
                >
                  <div className="font-mono font-semibold text-sm">
                    {a.registration}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {a.type}
                  </div>
                </div>
              ))}
            </div>
          </PreviewSection>
        )}

        {/* Upcoming schedule */}
        {schedulePreview.length > 0 && (
          <PreviewSection
            title="Nächste Flüge"
            href={`/a/${airline.icao}/schedule`}
            accent={primary}
          >
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {schedulePreview.map((s) => (
                <li
                  key={s.id}
                  className="py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-24">
                      {ymdHmUtc(s.departureTime)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-sm">
                        {s.route.flightNumber}
                      </div>
                      <div className="text-xs text-gray-500 font-mono">
                        {s.route.departure.icao} → {s.route.arrival.icao}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </PreviewSection>
        )}

        {/* Footer */}
        <footer className="pt-8 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap justify-between items-center gap-2">
          <span>
            Public profile · powered by{' '}
            <Link href="/airlines" className="underline">
              VAM System
            </Link>
          </span>
        </footer>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-white/10 backdrop-blur-sm rounded px-2 py-1">
      <span className="text-white/60 uppercase tracking-wider">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </span>
  );
}

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="block p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md transition group"
    >
      <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div
        className="mt-1 text-3xl font-bold tabular-nums group-hover:opacity-90"
        style={{ color: accent }}
      >
        {value}
      </div>
    </Link>
  );
}

function PreviewSection({
  title,
  href,
  accent,
  children,
}: {
  title: string;
  href: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link
          href={href}
          className="text-xs font-medium hover:underline"
          style={{ color: accent }}
        >
          Alle anzeigen →
        </Link>
      </header>
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
        {children}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function ymdHmUtc(d: Date): string {
  // Year is intentionally omitted — preview shows MM-DD HH:MM (compact)
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const da = d.getUTCDate().toString().padStart(2, '0');
  const h = d.getUTCHours().toString().padStart(2, '0');
  const mi = d.getUTCMinutes().toString().padStart(2, '0');
  return `${mo}-${da} ${h}:${mi}`;
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}
