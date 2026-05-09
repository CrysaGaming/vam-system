import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import type { AircraftStatus } from '@vam/db';
import { AddAircraftForm } from './add-aircraft-form';
import { AircraftActionsButtons } from './aircraft-actions-buttons';

/**
 * /airline/aircraft — Aircraft-Fleet-Verwaltung für airline-admins.
 *
 * Welle 5 commit 5c — full CRUD aktiv. Add-form oben, status/edit/delete-
 * actions per row.
 *
 * Auth-gate: spiegelt AIRLINE_MANAGER_ROLES in airline/aircraft/actions.ts
 * (admin | airline-admin | instructor). Multi-tenant: nur eigene airline.
 *
 * Features:
 * - Add-form (registration, type, home-icao, status)
 * - Liste aller aircraft als cards mit:
 *   - Status-badge (ACTIVE | MAINTENANCE | STORED | RETIRED)
 *   - Home-ICAO + current-location ("verlegt nach"-hint wenn ≠ home)
 *   - Hours-flown + last-flight + pirep-count via groupBy
 *   - Status-dropdown (auto-submit), Edit-link, Delete-button (nur wenn safe)
 * - Filter über query-params (?status=ACTIVE | ?home=EDDF) mit per-status counts
 *
 * Out-of-scope (5d/Welle 6+):
 * - Auto-position-update bei PIREP-approval → 5d
 * - Bulk-import via CSV → Welle 6+
 * - Per-aircraft SimBrief-overlay UI → Welle 6+
 * - Catalog-typeId-picker im add-form → Welle 6 (UX-flow first klären)
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

const STATUS_ORDER: AircraftStatus[] = [
  'ACTIVE',
  'MAINTENANCE',
  'STORED',
  'RETIRED',
];

// Track 4 #40 (Section G): Category-labels für die catalog-spec-row.
// Spiegelt fleet/page.tsx — wenn die mapping irgendwann erweitert wird,
// am besten in @vam/catalogs zentralisieren.
const CATEGORY_LABELS: Record<string, string> = {
  narrow_body: 'Narrow-Body',
  wide_body: 'Wide-Body',
  regional: 'Regional',
  cargo: 'Cargo',
  ga: 'General Aviation',
};

function isAircraftStatus(v: string | undefined): v is AircraftStatus {
  return v === 'ACTIVE' || v === 'MAINTENANCE' || v === 'STORED' || v === 'RETIRED';
}

export default async function AirlineAircraftPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; home?: string }>;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const params = await searchParams;
  const filterStatus = isAircraftStatus(params.status) ? params.status : undefined;
  const filterHome = params.home?.trim().toUpperCase() || undefined;

  // Fetch aircraft + counts in parallel.
  // Counts werden als separater query gemacht damit die status-filter-bar
  // immer alle status-counts zeigen kann (auch wenn die liste gefiltert ist).
  const [aircraft, statusCounts, allHomeIcaos] = await Promise.all([
    prisma.aircraft.findMany({
      where: {
        airlineId: user.airlineId,
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterHome ? { homeIcao: filterHome } : {}),
      },
      include: {
        aircraftType: {
          select: {
            icaoType: true,
            name: true,
            manufacturer: true,
            // Track 4 #40 (Section G): Catalog-specs für inline-display in
            // der card. Bei free-text-aircraft (kein catalog-link) bleibt
            // alles hidden.
            category: true,
            rangeNm: true,
            capacityPax: true,
            cruiseSpeedKt: true,
            verified: true,
          },
        },
        // _count für canDelete-check im action-buttons-component:
        // wenn pireps oder routes referenzieren, hard-delete blocked.
        _count: {
          select: { pireps: true, routes: true },
        },
      },
      // Sort: ACTIVE zuerst, dann MAINTENANCE, STORED, RETIRED. Innerhalb
      // gruppe alphabetisch nach registration. Postgres sortiert enums
      // by definition order, was hier coincidentally die richtige reihen-
      // folge ist (siehe enum AircraftStatus im schema).
      orderBy: [{ status: 'asc' }, { registration: 'asc' }],
    }),
    prisma.aircraft.groupBy({
      by: ['status'],
      where: { airlineId: user.airlineId },
      _count: { _all: true },
    }),
    // Distinct home-icaos für den filter-dropdown. nullable rauswerfen.
    prisma.aircraft.findMany({
      where: { airlineId: user.airlineId, homeIcao: { not: null } },
      select: { homeIcao: true },
      distinct: ['homeIcao'],
      orderBy: { homeIcao: 'asc' },
    }),
  ]);

  // Counts als lookup-map.
  const countByStatus: Record<AircraftStatus, number> = {
    ACTIVE: 0,
    MAINTENANCE: 0,
    STORED: 0,
    RETIRED: 0,
  };
  for (const c of statusCounts) {
    countByStatus[c.status] = c._count._all;
  }
  const totalAircraft = Object.values(countByStatus).reduce((a, b) => a + b, 0);

  // PIREP-aggregation pro aircraft: hours-flown + last-flight-date + pirep-count.
  // Nur approved PIREPs zählen für hours; submitted/rejected nicht.
  const aircraftIds = aircraft.map((a) => a.id);
  const pirepStats = aircraftIds.length > 0
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

  const statsByAircraftId: Record<
    string,
    { pireps: number; flightHours: number; lastFlight: Date | null }
  > = {};
  for (const s of pirepStats) {
    if (s.aircraftId) {
      statsByAircraftId[s.aircraftId] = {
        pireps: s._count._all,
        flightHours: (s._sum.flightTimeMin ?? 0) / 60,
        lastFlight: s._max.approvedAt,
      };
    }
  }

  const homeIcaos = allHomeIcaos
    .map((a) => a.homeIcao)
    .filter((v): v is string => !!v);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Aircraft-Verwaltung</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} —{' '}
              {totalAircraft === 0
                ? 'Noch keine Aircraft registriert'
                : `${totalAircraft} Aircraft (${countByStatus.ACTIVE} aktiv, ${countByStatus.MAINTENANCE} in Wartung)`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/airline/aircraft/import"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition flex items-center gap-2"
            >
              <span aria-hidden="true">📥</span>
              CSV importieren
            </Link>
            <Link
              href="/dashboard"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Dashboard
            </Link>
          </div>
        </header>

        {/* Add-form section */}
        <section className="mb-8 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-1">Neues Aircraft anlegen</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Trage Registration und Aircraft-Type ein. Optional kannst du
            einen Home-Hub (ICAO) setzen und den Anfangsstatus wählen.
          </p>
          <AddAircraftForm />
        </section>

        {/* Filter-bar — status-tabs + home-icao dropdown */}
        {totalAircraft > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {/* Status-tabs */}
            <div className="flex flex-wrap gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-1">
              <FilterTab
                label="Alle"
                count={totalAircraft}
                active={!filterStatus}
                href={buildHref({ home: filterHome })}
              />
              {STATUS_ORDER.map((s) => (
                <FilterTab
                  key={s}
                  label={STATUS_LABELS[s]}
                  count={countByStatus[s]}
                  active={filterStatus === s}
                  href={buildHref({ status: s, home: filterHome })}
                />
              ))}
            </div>

            {/* Home-ICAO filter (nur wenn mehr als ein home-icao existiert) */}
            {homeIcaos.length > 1 && (
              <form
                method="get"
                className="flex items-center gap-2"
                aria-label="Home-Hub-Filter"
              >
                <label
                  htmlFor="home-filter"
                  className="text-sm text-gray-600 dark:text-gray-400"
                >
                  Home:
                </label>
                {/* Form-as-link-pattern weil server-component — submit
                    via classic GET-form, query-params landen in der URL,
                    page rerendert mit neuem filter. Ohne JS-dependency. */}
                {filterStatus && (
                  <input type="hidden" name="status" value={filterStatus} />
                )}
                <select
                  id="home-filter"
                  name="home"
                  defaultValue={filterHome ?? ''}
                  className="px-2 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono"
                >
                  <option value="">Alle Hubs</option>
                  {homeIcaos.map((icao) => (
                    <option key={icao} value={icao}>
                      {icao}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-2 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-xs transition"
                >
                  Anwenden
                </button>
              </form>
            )}

            {/* Reset-link wenn filter aktiv */}
            {(filterStatus || filterHome) && (
              <Link
                href="/airline/aircraft"
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
              >
                Filter zurücksetzen
              </Link>
            )}
          </div>
        )}

        {/* Aircraft list */}
        {aircraft.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            {totalAircraft === 0 ? (
              <>
                <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
                  Noch keine Aircraft registriert
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Lege oben dein erstes Aircraft an um Routes mit Airframes zu
                  verbinden und Flight-Hours zu tracken.
                </p>
              </>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">
                Keine Aircraft passen zu den aktuellen Filtern.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {aircraft.map((ac) => {
              const stats = statsByAircraftId[ac.id];
              const isVerlegt =
                ac.currentLocationIcao &&
                ac.homeIcao &&
                ac.currentLocationIcao !== ac.homeIcao;
              return (
                <div
                  key={ac.id}
                  className={`bg-white dark:bg-gray-900 border rounded-lg p-4 sm:p-5 transition ${
                    ac.status === 'RETIRED'
                      ? 'border-gray-200 dark:border-gray-800 opacity-60'
                      : 'border-gray-200 dark:border-gray-800'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold font-mono">
                          {ac.registration}
                        </h3>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${STATUS_BADGE_STYLES[ac.status]}`}
                        >
                          {STATUS_LABELS[ac.status]}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono">
                          {ac.aircraftType?.icaoType ?? ac.type}
                        </span>
                        {/* Track 4 #40: catalog-link badges. Verified-tag
                            ist trust-signal vom catalog-team, free-text
                            warnt admin dass specs fehlen + zeigt verlink-
                            opportunity. Category-chip gibt schnellen
                            visuellen overview welcher fleet-typ. */}
                        {ac.aircraftType?.verified && (
                          <span
                            className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold"
                            title="Catalog-Eintrag ist verifiziert"
                          >
                            ✓ Verified
                          </span>
                        )}
                        {!ac.aircraftType && (
                          <span
                            className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold"
                            title="Nicht mit Catalog verknüpft — Specs fehlen"
                          >
                            Free-Text
                          </span>
                        )}
                        {ac.aircraftType?.category && (
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-gray-800/50 rounded">
                            {CATEGORY_LABELS[ac.aircraftType.category] ??
                              ac.aircraftType.category}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {ac.aircraftType
                          ? `${ac.aircraftType.manufacturer} ${ac.aircraftType.name}`
                          : ac.type}
                      </p>
                      {/* Track 4 #40 (Section G): Catalog-specs-row. Nur
                          render wenn aircraft mit catalog verlinkt ist.
                          Range/Sitze/Cruise sind die drei kennzahlen die
                          beim flight-planning relevant sind — kompakt
                          inline statt in expandable details. */}
                      {ac.aircraftType && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                          <span title="Maximum range">
                            <span aria-hidden="true" className="mr-1">
                              📏
                            </span>
                            <span className="font-mono">
                              {ac.aircraftType.rangeNm.toLocaleString('de-DE')}
                            </span>{' '}
                            nm
                          </span>
                          <span title="Sitze in 2-class konfiguration">
                            <span aria-hidden="true" className="mr-1">
                              💺
                            </span>
                            <span className="font-mono">
                              {ac.aircraftType.capacityPax}
                            </span>{' '}
                            Sitze
                          </span>
                          <span title="Cruise speed in knoten">
                            <span aria-hidden="true" className="mr-1">
                              💨
                            </span>
                            <span className="font-mono">
                              {ac.aircraftType.cruiseSpeedKt}
                            </span>{' '}
                            kt
                          </span>
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-2 space-y-0.5">
                        <p>
                          {ac.homeIcao ? (
                            <>
                              <span aria-hidden="true">🏠</span> Home:{' '}
                              <span className="font-mono">{ac.homeIcao}</span>
                            </>
                          ) : (
                            <span className="italic">Kein Home-Hub gesetzt</span>
                          )}
                          {isVerlegt && (
                            <>
                              {' · '}
                              <span aria-hidden="true">📍</span> Aktuell:{' '}
                              <span className="font-mono text-amber-700 dark:text-amber-400">
                                {ac.currentLocationIcao}
                              </span>
                            </>
                          )}
                          {!isVerlegt && ac.currentLocationIcao && (
                            <>
                              {' · '}
                              <span aria-hidden="true">📍</span>{' '}
                              <span className="font-mono">
                                {ac.currentLocationIcao}
                              </span>{' '}
                              (Home)
                            </>
                          )}
                        </p>
                        {stats && stats.pireps > 0 && (
                          <p>
                            {stats.flightHours.toFixed(1)} Stunden ·{' '}
                            {stats.pireps} PIREP
                            {stats.pireps === 1 ? '' : 's'}
                            {stats.lastFlight && (
                              <>
                                {' · '}Letzter Flug:{' '}
                                {stats.lastFlight.toLocaleDateString('de-DE')}
                              </>
                            )}
                          </p>
                        )}
                        {(!stats || stats.pireps === 0) && (
                          <p className="italic">Noch keine Flüge geloggt</p>
                        )}
                      </div>
                    </div>

                    {/* Actions: status-dropdown + edit-link + delete (oder
                        "kann nicht gelöscht werden" hint wenn pireps/routes
                        existieren). Component ist client-component für
                        useTransition + auto-submit. */}
                    <AircraftActionsButtons
                      aircraftId={ac.id}
                      registration={ac.registration}
                      currentStatus={ac.status}
                      pirepCount={ac._count.pireps}
                      routeCount={ac._count.routes}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info-footer */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Aircraft-Status:
            </strong>{' '}
            <span className="font-medium">Aktiv</span> = buchbar &amp; einsatzbereit.{' '}
            <span className="font-medium">Wartung</span> = aktuell in der
            Werkstatt, nicht buchbar.{' '}
            <span className="font-medium">Eingelagert</span> = Long-Term-
            Storage, nicht buchbar.{' '}
            <span className="font-medium">Außer Dienst</span> = dauerhaft
            retired, nur historische PIREPs.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Position-Tracking:
            </strong>{' '}
            Aircraft.Home ist der Heimat-Hub (default-base). Aktuelle Position
            wird automatisch nach jedem PIREP-Approval auf den Arrival-Airport
            gesetzt — ist die aktuelle Position nicht der Home-Hub, ist das
            Aircraft &quot;verlegt&quot; und braucht einen Repositioning-Flug
            zurück.
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Filter-helpers
// ─────────────────────────────────────────────────────────────────────────

function buildHref({
  status,
  home,
}: {
  status?: AircraftStatus;
  home?: string;
}): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (home) params.set('home', home);
  const qs = params.toString();
  return qs ? `/airline/aircraft?${qs}` : '/airline/aircraft';
}

interface FilterTabProps {
  label: string;
  count: number;
  active: boolean;
  href: string;
}

function FilterTab({ label, count, active, href }: FilterTabProps) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
        active
          ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
      <span
        className={`ml-1.5 text-xs ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-600'}`}
      >
        {count}
      </span>
    </Link>
  );
}
