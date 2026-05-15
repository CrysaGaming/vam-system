import Link from 'next/link';
import { prisma, FlightCategory } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import {
  getMultipleAirportWeather,
  type WeatherResult,
} from '@/lib/weather/aviation-weather';
import { WeatherBadge } from '@/app/_components/weather-badge';
import { RefreshButton } from './_refresh-button';

/**
 * Welle P / P1 — Airline-scoped weather overview.
 *
 * Route: /airline/weather
 *
 * Aggregates every airport this airline currently serves and shows
 * each one's live METAR + parsed flight-category. The "currently
 * serves" set is the union of:
 *
 *   1. Departure + arrival ICAOs from all Routes owned by the airline
 *   2. Departure + arrival ICAOs from Bookings created in the last
 *      30 days (catches one-off / repositioning flights not in the
 *      routebook)
 *   3. Hub ICAO from Airline.icao + any User.secondaryBaseIcaos for
 *      airline members (catches the "bases" angle even if no flight
 *      has touched the airport yet this month)
 *
 * # Filter / sort
 *
 * Default: sorted worst-first (LIFR > IFR > MVFR > VFR > UNKNOWN)
 * so the dispatcher's eye lands on the airports that need attention.
 * The header offers a category-only filter via querystring.
 *
 * # Why airline-scoped (not all airports)
 *
 * METAR queries cost NOAA quota and our DB-storage. Aggregating
 * just the airports this airline cares about is the sweet spot —
 * a dispatcher at LEAV Aviation doesn't need to see weather at
 * KORD. A future pilot-facing "global weather map" would be a
 * separate page if there's appetite.
 */

export const dynamic = 'force-dynamic';

// Severity weight for sorting — higher = worse weather. Mirror the
// FlightCategory enum order; UNKNOWN sorts after VFR because "no
// data" is less actionable than "good data, all clear."
const CATEGORY_WEIGHT: Record<FlightCategory, number> = {
  LIFR: 4,
  IFR: 3,
  MVFR: 2,
  VFR: 1,
  UNKNOWN: 0,
};

type Filter = 'all' | 'ifr-or-worse' | 'lifr-only' | 'stale-only';

export default async function AirlineWeatherPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const params = await searchParams;
  const filter = parseFilter(params.filter);

  // ─── Collect the airline's airport-set ───────────────────
  // Three queries in parallel: routes, recent bookings, members'
  // base ICAOs. We deduplicate locally rather than rely on a SQL
  // UNION because the row-shapes differ.
  //
  // Route/Booking use departureId/arrivalId FKs to Airport — we
  // pull the ICAO via the relation rather than denormalising onto
  // those tables. Adds 2 joins per query but they're indexed and
  // cheap.
  const [routes, recentBookings, airline, members] = await Promise.all([
    prisma.route.findMany({
      where: { airlineId: user.airlineId },
      select: {
        departure: { select: { icao: true } },
        arrival: { select: { icao: true } },
      },
    }),
    prisma.booking.findMany({
      where: {
        airlineId: user.airlineId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: {
        route: {
          select: {
            departure: { select: { icao: true } },
            arrival: { select: { icao: true } },
          },
        },
      },
    }),
    prisma.airline.findUnique({
      where: { id: user.airlineId },
      select: { icao: true },
    }),
    prisma.user.findMany({
      where: { airlineId: user.airlineId },
      select: { secondaryBaseIcaos: true },
    }),
  ]);

  const icaoSet = new Set<string>();
  for (const r of routes) {
    if (r.departure?.icao) icaoSet.add(r.departure.icao);
    if (r.arrival?.icao) icaoSet.add(r.arrival.icao);
  }
  for (const b of recentBookings) {
    if (b.route?.departure?.icao) icaoSet.add(b.route.departure.icao);
    if (b.route?.arrival?.icao) icaoSet.add(b.route.arrival.icao);
  }
  if (airline?.icao) icaoSet.add(airline.icao);
  for (const m of members) {
    for (const baseIcao of m.secondaryBaseIcaos) {
      icaoSet.add(baseIcao);
    }
  }
  const icaos = Array.from(icaoSet).sort();

  // ─── Fetch weather for all airports (batched + cached) ───
  const weatherMap = await getMultipleAirportWeather(icaos);

  // ─── Sort + filter ───────────────────────────────────────
  type Row = {
    icao: string;
    result: WeatherResult;
    weight: number;
    isStale: boolean;
  };
  const rows: Row[] = icaos.map((icao) => {
    const result = weatherMap.get(icao) ?? {
      ok: false as const,
      reason: 'no_metar' as const,
    };
    if (!result.ok) {
      return { icao, result, weight: -1, isStale: false };
    }
    const weight = CATEGORY_WEIGHT[result.weather.category as FlightCategory] ?? 0;
    return {
      icao,
      result,
      weight,
      isStale: result.isStale,
    };
  });

  // Apply filter BEFORE sorting so empty-filtered states render
  // cleanly without an empty sort step.
  const filtered = rows.filter((row) => {
    switch (filter) {
      case 'all':
        return true;
      case 'ifr-or-worse':
        return row.weight >= 3;
      case 'lifr-only':
        return row.weight >= 4;
      case 'stale-only':
        return row.isStale;
    }
  });

  // Sort: worst weather first. Within same weight, by ICAO alpha.
  filtered.sort((a, b) => b.weight - a.weight || a.icao.localeCompare(b.icao));

  // Aggregate counts for the header chips (always over the full set,
  // not the filtered subset — that's what dispatchers want to see).
  const counts = {
    total: rows.length,
    lifr: rows.filter((r) => r.weight === 4).length,
    ifr: rows.filter((r) => r.weight === 3).length,
    mvfr: rows.filter((r) => r.weight === 2).length,
    vfr: rows.filter((r) => r.weight === 1).length,
    unknown: rows.filter((r) => r.weight <= 0).length,
    stale: rows.filter((r) => r.isStale).length,
  };

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 border-b border-border pb-4">
          <Link
            href="/airline/dispatch"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Dispatch Board
          </Link>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
            🌬️ Weather Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live METARs für alle airports die deine airline aktuell
            bedient (routes + letzte 30 tage bookings + member-bases).
            Cache 30min, force-refresh per row möglich.
          </p>
        </header>

        {/* Summary chips */}
        <section className="mb-6 flex flex-wrap gap-2">
          <SummaryChip label="Total" value={counts.total} />
          <SummaryChip label="LIFR" value={counts.lifr} tone="rose" />
          <SummaryChip label="IFR" value={counts.ifr} tone="amber" />
          <SummaryChip label="MVFR" value={counts.mvfr} tone="sky" />
          <SummaryChip label="VFR" value={counts.vfr} tone="emerald" />
          <SummaryChip label="No data" value={counts.unknown} tone="slate" />
          {counts.stale > 0 && (
            <SummaryChip label="Stale" value={counts.stale} tone="amber" />
          )}
        </section>

        {/* Filter pills */}
        <section className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Filter:
          </span>
          <FilterPill current={filter} value="all" label="Alle" />
          <FilterPill
            current={filter}
            value="ifr-or-worse"
            label="IFR & worse"
          />
          <FilterPill current={filter} value="lifr-only" label="Nur LIFR" />
          <FilterPill current={filter} value="stale-only" label="Stale only" />
        </section>

        {/* Airport grid */}
        {filtered.length === 0 ? (
          <section className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? 'Keine airports im scope. Lege erst routes oder bookings an, damit hier weather erscheint.'
              : `Keiner der ${rows.length} airports matched filter "${filter}".`}
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((row) => (
              <div key={row.icao} className="space-y-2">
                <WeatherBadge
                  icao={row.icao}
                  weather={row.result.ok ? row.result.weather : null}
                  isStale={row.isStale}
                  compact={false}
                />
                {!row.result.ok && (
                  <p className="text-[10px] text-muted-foreground">
                    {row.result.reason === 'no_metar'
                      ? 'Kein METAR verfügbar — airport veröffentlicht evtl. keine wetter-daten.'
                      : `Fehler: ${row.result.detail ?? row.result.reason}`}
                  </p>
                )}
                <div className="px-1">
                  <RefreshButton icao={row.icao} />
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Footer-hint */}
        <section className="mt-8 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="font-semibold uppercase tracking-wider">
            Datenquelle
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              METARs kommen live von{' '}
              <a
                href="https://aviationweather.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                aviationweather.gov
              </a>
              {' '}(NOAA Aviation Weather Center). Frei + keine API-key
              nötig.
            </li>
            <li>
              FlightCategory-classification: ceiling &lt; 500ft ODER vis
              &lt; 1sm → LIFR · &lt; 1000/3 → IFR · &lt; 3000/5 → MVFR
              · sonst VFR. Worst of beide gewinnt.
            </li>
            <li>
              Cache 30min pro ICAO. Bei upstream-fail wird der stale
              cache mit ⏳-badge angezeigt — besser veraltete daten als
              gar keine im dispatch.
            </li>
            <li>
              Kleinere regional-airports (z.B. EDDK uncontrolled
              satellites) veröffentlichen oft kein METAR — die zeigen
              "—" und sind harmlos.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function parseFilter(raw: string | undefined): Filter {
  switch (raw) {
    case 'ifr-or-worse':
    case 'lifr-only':
    case 'stale-only':
      return raw;
    default:
      return 'all';
  }
}

function SummaryChip({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'rose' | 'amber' | 'sky' | 'emerald' | 'slate';
}) {
  const styles = {
    rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
    emerald:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    slate: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${styles[tone]}`}
    >
      <span className="uppercase tracking-wider">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function FilterPill({
  current,
  value,
  label,
}: {
  current: Filter;
  value: Filter;
  label: string;
}) {
  const isActive = current === value;
  const href = value === 'all' ? '/airline/weather' : `/airline/weather?filter=${value}`;
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        isActive
          ? 'bg-indigo-600 text-white'
          : 'bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  );
}
