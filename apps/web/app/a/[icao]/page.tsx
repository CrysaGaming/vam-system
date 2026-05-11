import { notFound } from 'next/navigation';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { getPublicAirline, FALLBACK_PRIMARY } from './_lib/airline';
import { ymdHmUtc, prettyUrl } from './_lib/format';

/**
 * /a/[icao] — Public airline overview page (Welle 8 commit 8B-1, refactored
 * in 8B-2 to delegate hero + sub-nav + visibility-check to the new
 * layout.tsx).
 *
 * Content (everything between the layout's hero and footer):
 *   - Description + websiteUrl (if set)
 *   - 4 StatCards (Hubs / Routes / Fleet / Schedules) linking to sub-pages
 *   - Up to 5 hub-previews
 *   - Up to 6 fleet-preview tiles
 *   - Up to 5 upcoming-schedule preview rows
 *
 * Caching: relies on revalidatePath('/a/[icao]') being called from
 * updateAirlineSettings on the admin side — that already exists in 8A-2.
 */
export default async function PublicAirlinePage({
  params,
}: {
  params: Promise<{ icao: string }>;
}) {
  const { icao: icaoRaw } = await params;
  // Layout already does the visibility-check + 404; this call hits the
  // request-scoped cache from layout (zero extra DB roundtrip). The
  // double-check below is defense-in-depth in case Next.js ever changes
  // the layout-vs-page execution semantics.
  const airline = await getPublicAirline(icaoRaw);
  if (!airline) {
    notFound();
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Counts + previews. Single page-specific query block — none of these
  // live in getPublicAirline because the layout doesn't need them.
  const [counts, hubsPreview, fleetPreview, schedulePreview, featuredPilots] =
    await Promise.all([
      prisma.airline.findUnique({
        where: { id: airline.id },
        select: {
          _count: {
            select: {
              hubs: true,
              routes: true,
              aircraft: true,
              scheduleTemplates: true,
            },
          },
        },
      }),
      prisma.airlineHub.findMany({
        where: { airlineId: airline.id },
        include: {
          airport: { select: { icao: true, name: true, city: true } },
        },
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
      // Track 4 #64 (Section L): Featured Pilots — top-4 by lifetime flight-
      // hours. ACTIVE employment-status only damit inactive/leave-piloten
      // nicht im public-showcase landen (sie sind nicht aktiv operativ und
      // sollten auch nicht "öffentliche aushängeschilder" der airline sein).
      //
      // Take 4: passt visuell in 2x2 grid auf mobile + 4-col row auf desktop.
      // 5+ wäre eine zweite zeile auf desktop = unnötig — wir sind nicht
      // /pilots, sondern ein public-airline-summary.
      //
      // totalFlightHours statt totalFlights weil hours mehr "experience"-
      // signal sind (= viele lange flights > viele short hops).
      prisma.user.findMany({
        where: {
          airlineId: airline.id,
          employmentStatus: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          image: true,
          totalFlightHours: true,
          totalFlights: true,
          rank: { select: { name: true } },
        },
        orderBy: [
          { totalFlightHours: 'desc' },
          { totalFlights: 'desc' },
        ],
        take: 4,
      }),
    ]);

  const primary = airline.primaryColor ?? FALLBACK_PRIMARY;
  const c = counts?._count ?? {
    hubs: 0,
    routes: 0,
    aircraft: 0,
    scheduleTemplates: 0,
  };

  return (
    <div className="space-y-10">
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
            value={c.hubs}
            href={`/a/${airline.icao}/hubs`}
            accent={primary}
          />
          <StatCard
            label="Routes"
            value={c.routes}
            href={`/a/${airline.icao}/routes`}
            accent={primary}
          />
          <StatCard
            label="Fleet"
            value={c.aircraft}
            href={`/a/${airline.icao}/fleet`}
            accent={primary}
          />
          <StatCard
            label="Schedules"
            value={c.scheduleTemplates}
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

      {/* Track 4 #64 (Section L): Featured Pilots — public airline-page
          showcase der top-piloten. 2x2 grid auf mobile, 4-col auf
          desktop. Verlinkt auf jeweilige /pilots/[id]-profile.

          Position: nach Fleet-preview, vor Schedule-preview. Logik:
          erst kommt "was hat die airline" (hubs/fleet), dann "wer
          ist die airline" (piloten), dann "was läuft grade" (schedule).
          Pilot-showcase nach den infrastruktur-blöcken matcht dieses
          narrativ. */}
      {featuredPilots.length > 0 && (
        <section>
          <header className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">🌟 Featured Pilots</h2>
            <Link
              href={`/a/${airline.icao}/pilots`}
              className="text-xs font-medium hover:underline"
              style={{ color: primary }}
            >
              Alle anzeigen →
            </Link>
          </header>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {featuredPilots.map((p, idx) => {
              const medal =
                idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
              return (
                <Link
                  key={p.id}
                  href={`/pilots/${p.id}`}
                  className="block p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md transition group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt={p.name ?? 'Avatar'}
                        className="w-12 h-12 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                        {medal && (
                          <span className="shrink-0" aria-hidden="true">
                            {medal}
                          </span>
                        )}
                        {p.name ?? 'Unbenannt'}
                      </p>
                      {p.rank && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {p.rank.name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span
                      className="font-mono font-semibold tabular-nums"
                      style={{ color: primary }}
                    >
                      {p.totalFlightHours.toFixed(1)} h
                    </span>
                    <span className="text-gray-500 dark:text-gray-500 tabular-nums">
                      {p.totalFlights}{' '}
                      {p.totalFlights === 1 ? 'Flug' : 'Flüge'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

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
