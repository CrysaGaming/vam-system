import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import type { AircraftStatus } from '@vam/db';
import Link from 'next/link';

/**
 * /airline/fleet — Subfleet-Übersicht (Welle 6 commit 6A-2).
 *
 * Aggregiert die airframes der eigenen airline pro Aircraft-Type. Eine
 * "subfleet" ist die menge aller aircraft die denselben type teilen
 * (gruppen-key: aircraftTypeId wenn catalog-linked, sonst der raw
 * type-string).
 *
 * Pro subfleet:
 * - Counts aufgesplittet nach status (active / maintenance / stored / retired)
 * - Total Flugstunden (sum über approved-PIREP flightTimeMin / 60)
 * - Total PIREP-count
 * - Letzter Flug (max approvedAt)
 * - Catalog-info wenn verlinkt: manufacturer, name, category, range,
 *   capacity, cruise-speed
 * - Drilldown: <details>-element mit chip-list aller airframes
 *
 * Auth: AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor).
 *
 * Sort: nach total-aircraft-count absteigend (= "größte subfleet zuerst"),
 * bei tie alphabetisch nach icaoType.
 *
 * Out-of-scope:
 * - Fleet-age (kein firstFlightDate-feld am Aircraft-model)
 * - Utilization-rate (hours/day) — bräuchte fleet-since-date als
 *   dividend; in welle 7+ wenn airframe-introduction-date getracked wird
 * - Performance-vergleich zwischen subfleets — separate Stats-page
 * - Filter / search — alle subfleets passen in eine viewport, scroll reicht.
 *
 * Why not eine groupBy-query: Prisma's groupBy ist auf einzelne fields
 * limitiert (entweder aircraftTypeId ODER type, nicht das `??`-fallback-
 * pattern). Stattdessen lade ich alle aircraft + aggregiere im memory.
 * Das ist OK weil airlines selten >100 aircraft haben (selbst große VAs
 * stay unter 200), und group-keys sind cheap.
 */

const STATUS_LABELS: Record<AircraftStatus, string> = {
  ACTIVE: 'Aktiv',
  MAINTENANCE: 'Wartung',
  STORED: 'Eingelagert',
  RETIRED: 'Außer Dienst',
};

const STATUS_BADGE_STYLES: Record<AircraftStatus, string> = {
  ACTIVE:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  MAINTENANCE:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  STORED: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  RETIRED:
    'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
};

const CATEGORY_LABELS: Record<string, string> = {
  narrow_body: 'Narrow-Body',
  wide_body: 'Wide-Body',
  regional: 'Regional',
  cargo: 'Cargo',
  ga: 'General Aviation',
};

interface SubfleetGroup {
  /** Key fürs grouping — aircraftTypeId wenn catalog-linked, sonst raw type. */
  key: string;
  /** ICAO-designator (B738, A20N, …). Bei free-text = raw type. */
  icaoType: string;
  /** Catalog-eintrag falls verlinkt. */
  catalog: {
    id: string;
    name: string;
    manufacturer: string;
    category: string;
    rangeNm: number;
    capacityPax: number;
    cruiseSpeedKt: number;
    verified: boolean;
  } | null;
  /** Counts pro status. */
  counts: Record<AircraftStatus, number>;
  total: number;
  /** Aggregated PIREP-stats. */
  totalFlightHours: number;
  totalPireps: number;
  lastFlight: Date | null;
  /** Liste aller aircraft (registration + status) für drilldown. */
  airframes: Array<{
    id: string;
    registration: string;
    status: AircraftStatus;
    homeIcao: string | null;
  }>;
}

export default async function AirlineFleetPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  // Fetch alle aircraft + catalog-info. PIREP-aggregation als parallel-query
  // auf alle aircraftIds (selbst pattern wie /airline/aircraft).
  const aircraft = await prisma.aircraft.findMany({
    where: { airlineId: user.airlineId },
    include: {
      aircraftType: {
        select: {
          id: true,
          icaoType: true,
          name: true,
          manufacturer: true,
          category: true,
          rangeNm: true,
          capacityPax: true,
          cruiseSpeedKt: true,
          verified: true,
        },
      },
    },
    orderBy: [{ registration: 'asc' }],
  });

  const aircraftIds = aircraft.map((a) => a.id);
  const pirepStats =
    aircraftIds.length > 0
      ? await prisma.pirep.groupBy({
          by: ['aircraftId'],
          where: {
            aircraftId: { in: aircraftIds },
            status: 'Approved',
          },
          _count: { _all: true },
          _sum: { flightTimeMin: true },
          _max: { approvedAt: true },
        })
      : [];

  // Lookup-map aircraftId → stats.
  const statsByAircraftId: Record<
    string,
    { pireps: number; flightMin: number; lastFlight: Date | null }
  > = {};
  for (const s of pirepStats) {
    if (s.aircraftId) {
      statsByAircraftId[s.aircraftId] = {
        pireps: s._count._all,
        flightMin: s._sum.flightTimeMin ?? 0,
        lastFlight: s._max.approvedAt,
      };
    }
  }

  // Group-key resolver: catalog-id wenn vorhanden, sonst raw type-string.
  // "type:" prefix für free-text damit es nie mit einer cuid clasht.
  const groupKey = (a: (typeof aircraft)[number]) =>
    a.aircraftTypeId ? `id:${a.aircraftTypeId}` : `type:${a.type}`;

  // Aggregation in einer pass.
  const groupsMap = new Map<string, SubfleetGroup>();

  for (const a of aircraft) {
    const key = groupKey(a);
    let group = groupsMap.get(key);

    if (!group) {
      group = {
        key,
        icaoType: a.aircraftType?.icaoType ?? a.type,
        catalog: a.aircraftType
          ? {
              id: a.aircraftType.id,
              name: a.aircraftType.name,
              manufacturer: a.aircraftType.manufacturer,
              category: a.aircraftType.category,
              rangeNm: a.aircraftType.rangeNm,
              capacityPax: a.aircraftType.capacityPax,
              cruiseSpeedKt: a.aircraftType.cruiseSpeedKt,
              verified: a.aircraftType.verified,
            }
          : null,
        counts: { ACTIVE: 0, MAINTENANCE: 0, STORED: 0, RETIRED: 0 },
        total: 0,
        totalFlightHours: 0,
        totalPireps: 0,
        lastFlight: null,
        airframes: [],
      };
      groupsMap.set(key, group);
    }

    group.counts[a.status]++;
    group.total++;
    group.airframes.push({
      id: a.id,
      registration: a.registration,
      status: a.status,
      homeIcao: a.homeIcao,
    });

    const stats = statsByAircraftId[a.id];
    if (stats) {
      group.totalFlightHours += stats.flightMin / 60;
      group.totalPireps += stats.pireps;
      if (
        stats.lastFlight &&
        (!group.lastFlight || stats.lastFlight > group.lastFlight)
      ) {
        group.lastFlight = stats.lastFlight;
      }
    }
  }

  // Sort: total-count desc, then icaoType asc.
  const groups = Array.from(groupsMap.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.icaoType.localeCompare(b.icaoType);
  });

  // Top-line stats.
  const totalAircraft = aircraft.length;
  const totalActive = groups.reduce((acc, g) => acc + g.counts.ACTIVE, 0);
  const totalHours = groups.reduce((acc, g) => acc + g.totalFlightHours, 0);
  const totalPireps = groups.reduce((acc, g) => acc + g.totalPireps, 0);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Fleet-Übersicht</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} —{' '}
              {totalAircraft === 0
                ? 'Noch keine Aircraft registriert'
                : `${totalAircraft} Aircraft in ${groups.length} ${
                    groups.length === 1 ? 'Subfleet' : 'Subfleets'
                  }, ${totalActive} aktiv`}
            </p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Link
              href="/airline/aircraft"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Aircraft-Verwaltung
            </Link>
            <Link
              href="/dashboard"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        {/* Top-line stats */}
        {totalAircraft > 0 && (
          <section className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Subfleets" value={String(groups.length)} />
            <StatCard
              label="Aircraft (aktiv)"
              value={`${totalActive} / ${totalAircraft}`}
            />
            <StatCard
              label="Flugstunden total"
              value={`${totalHours.toFixed(0)} h`}
            />
            <StatCard label="PIREPs total" value={String(totalPireps)} />
          </section>
        )}

        {/* Subfleet-cards */}
        {groups.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
              Noch keine Aircraft registriert
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Lege deine ersten Aircraft an um die Subfleet-Übersicht zu sehen.
            </p>
            <Link
              href="/airline/aircraft"
              className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition"
            >
              Zur Aircraft-Verwaltung
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <SubfleetCard key={g.key} group={g} />
            ))}
          </div>
        )}

        {/* Info-footer */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Subfleet-Gruppierung:
            </strong>{' '}
            Aircraft werden nach Catalog-Type gruppiert wenn verlinkt, sonst
            nach dem Free-Text-Type-string. Verlink Aircraft mit dem Catalog
            via Edit-Page für reichere Specs (Range, Sitze, Cruise-Speed).
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Flugstunden:
            </strong>{' '}
            Summe der approved-PIREP-flightTimes aller airframes der Subfleet.
            Submitted oder rejected PIREPs werden nicht gezählt.
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subfleet-card — eine card pro typ-gruppe
// ─────────────────────────────────────────────────────────────────────────

function SubfleetCard({ group }: { group: SubfleetGroup }) {
  const { catalog, counts, icaoType, total, totalFlightHours, totalPireps, lastFlight, airframes } = group;

  return (
    <article className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
      {/* Header-row: type + counts */}
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold font-mono">{icaoType}</h2>
              {catalog?.verified && (
                <span
                  className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold"
                  title="Catalog-Eintrag ist verifiziert"
                  aria-label="verifiziert"
                >
                  ✓ Verified
                </span>
              )}
              {!catalog && (
                <span
                  className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold"
                  title="Nicht mit Catalog verknüpft (Free-Text)"
                >
                  Free-Text
                </span>
              )}
              {catalog?.category && (
                <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                  {CATEGORY_LABELS[catalog.category] ?? catalog.category}
                </span>
              )}
            </div>
            {catalog ? (
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                {catalog.manufacturer} {catalog.name}
              </p>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-500 italic mt-1">
                Kein Catalog-Eintrag verlinkt — verlinke einzelne Aircraft im
                Edit-Dialog für Specs.
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums">{total}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {total === 1 ? 'Aircraft' : 'Aircraft'}
            </p>
          </div>
        </div>

        {/* Status-pills */}
        <div className="flex flex-wrap gap-2 mt-3">
          {(['ACTIVE', 'MAINTENANCE', 'STORED', 'RETIRED'] as AircraftStatus[]).map(
            (s) => (
              <span
                key={s}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border ${
                  counts[s] > 0
                    ? STATUS_BADGE_STYLES[s]
                    : 'bg-transparent text-gray-400 dark:text-gray-600 border-gray-200 dark:border-gray-800'
                }`}
              >
                <span className="font-bold tabular-nums">{counts[s]}</span>
                {STATUS_LABELS[s]}
              </span>
            ),
          )}
        </div>
      </div>

      {/* Catalog-specs row (nur wenn verlinkt) */}
      {catalog && (
        <div className="px-4 sm:px-5 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Spec label="Range" value={`${catalog.rangeNm.toLocaleString('de-DE')} nm`} />
          <Spec label="Sitze (2-class)" value={String(catalog.capacityPax)} />
          <Spec label="Cruise" value={`${catalog.cruiseSpeedKt} kt`} />
          <Spec
            label="Catalog"
            value={
              <Link
                href="/aircraft-types"
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Details
              </Link>
            }
          />
        </div>
      )}

      {/* Stats row */}
      <div className="px-4 sm:px-5 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <Spec
          label="Flugstunden"
          value={`${totalFlightHours.toFixed(1)} h`}
        />
        <Spec label="PIREPs" value={String(totalPireps)} />
        <Spec
          label="Letzter Flug"
          value={
            lastFlight ? lastFlight.toLocaleDateString('de-DE') : '—'
          }
        />
      </div>

      {/* Drilldown: airframes-liste in <details>-disclosure */}
      <details className="border-t border-gray-200 dark:border-gray-800 group">
        <summary className="px-4 sm:px-5 py-3 text-sm cursor-pointer text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition list-none flex items-center justify-between">
          <span>
            <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span>{' '}
            {total} Airframes anzeigen
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            click zum aufklappen
          </span>
        </summary>
        <div className="px-4 sm:px-5 py-3 bg-gray-50 dark:bg-gray-900/50 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {airframes.map((af) => (
            <Link
              key={af.id}
              href={`/airline/aircraft/${af.id}/edit`}
              className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs border bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-500 transition ${
                af.status === 'RETIRED'
                  ? 'border-gray-200 dark:border-gray-800 opacity-60'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
              title={`${af.registration} — ${STATUS_LABELS[af.status]}${af.homeIcao ? ` · ${af.homeIcao}` : ''}`}
            >
              <span className="font-mono font-semibold truncate">
                {af.registration}
              </span>
              <span
                className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                  af.status === 'ACTIVE'
                    ? 'bg-emerald-500'
                    : af.status === 'MAINTENANCE'
                      ? 'bg-amber-500'
                      : af.status === 'STORED'
                        ? 'bg-sky-500'
                        : 'bg-gray-400'
                }`}
                aria-label={STATUS_LABELS[af.status]}
              />
            </Link>
          ))}
        </div>
      </details>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helper-components
// ─────────────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}

function Spec({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="uppercase tracking-wide text-[10px] text-gray-500 dark:text-gray-500">
        {label}
      </p>
      <p className="text-gray-900 dark:text-gray-100 font-medium mt-0.5">
        {value}
      </p>
    </div>
  );
}
