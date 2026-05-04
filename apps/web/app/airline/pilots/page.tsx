import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma, type EmploymentStatus } from '@vam/db';
import Link from 'next/link';
import {
  listPersonnel,
  type PersonnelEntry,
  type PersonnelFilters,
} from './actions';
import { listAvailableRanks } from '../actions';
import { EmploymentStatusToggle } from './employment-status-toggle';
import { RankDropdown } from './rank-dropdown';
import { RankFilterSelect } from './rank-filter-select';

/**
 * /airline/pilots — Personnel-Management-Page (Welle 6 commit 6B-4).
 *
 * Orchestrating-UI für alle 6B-foundations: zeigt alle airline-members
 * in einer einzelnen tabelle mit:
 * - Basis-info: avatar, name, role-badge
 * - Performance-stats: total + last-30d hours, last-flight-recency,
 *   approval-rate, current location vs base
 * - Per-pilot controls: rank-dropdown (manual override) +
 *   employment-status-toggle (ACTIVE | LEAVE | INACTIVE)
 *
 * Filter: URL-params ?status=ACTIVE&rank=<id> für linkable / shareable
 * URLs (siehe airports/page.tsx pattern).
 *
 * Auth-gate: AIRLINE_MANAGER_ROLES (admin | airline-admin | instructor) —
 * spiegelt actions.ts.
 *
 * Different from /pilots:
 * - /pilots ist read-only display (alle members können es sehen, simple
 *   leaderboard).
 * - /airline/pilots ist admin-only mit edit-controls + filter +
 *   performance-aggregation.
 *
 * Out-of-scope für 6B-4:
 * - On-time-rate (würde booking-join brauchen)
 * - Bulk-select multi-action (z.B. mehrere piloten gleichzeitig auf LEAVE)
 * - Pilot-detail-drawer (per-pilot history-graph)
 * - CSV-export der personnel-liste
 */
export default async function AirlinePilotsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; rank?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: { select: { name: true } } },
  });

  const allowedRoles = ['admin', 'airline-admin', 'instructor'];
  if (
    !user?.role ||
    !allowedRoles.includes(user.role.name) ||
    !user.airlineId ||
    !user.airline
  ) {
    redirect('/dashboard');
  }

  const params = await searchParams;

  // Parse + validate filter-params. Invalid values fallen auf "kein filter".
  const VALID_STATUSES = ['ACTIVE', 'LEAVE', 'INACTIVE', 'ALL'] as const;
  const statusFilter =
    params.status && (VALID_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as (typeof VALID_STATUSES)[number])
      : 'ALL';

  // rank-param: '' oder 'NONE' → users ohne rank, sonst rank-id, sonst alle
  let rankFilter: string | null | undefined;
  if (params.rank === 'NONE') {
    rankFilter = null;
  } else if (params.rank) {
    rankFilter = params.rank;
  } else {
    rankFilter = undefined;
  }

  const filters: PersonnelFilters = {
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    rankId: rankFilter,
  };

  const [personnel, availableRanks] = await Promise.all([
    listPersonnel(filters),
    listAvailableRanks(),
  ]);

  // Pre-compute counts per status für die filter-tabs (immer alle statuses,
  // ungefiltert nach rank — sonst würden sich tab-counts beim rank-filter
  // verändern, was confusing ist).
  const statusCounts = await prisma.user.groupBy({
    by: ['employmentStatus'],
    where: { airlineId: user.airlineId },
    _count: { _all: true },
  });
  const totalAll = statusCounts.reduce((acc, row) => acc + row._count._all, 0);
  const countByStatus: Record<EmploymentStatus | 'ALL', number> = {
    ALL: totalAll,
    ACTIVE: 0,
    LEAVE: 0,
    INACTIVE: 0,
  };
  for (const row of statusCounts) {
    countByStatus[row.employmentStatus] = row._count._all;
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-[100rem] mx-auto">
        {/* Header */}
        <header className="flex flex-wrap justify-between items-start gap-4 mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold">Personal</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {user.airline.name} —{' '}
              {personnel.length === totalAll
                ? `${totalAll} ${totalAll === 1 ? 'Pilot' : 'Piloten'}`
                : `${personnel.length} von ${totalAll} ${totalAll === 1 ? 'Pilot' : 'Piloten'}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/airline/ranks"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              🏅 Ränge verwalten
            </Link>
            <Link
              href="/airline"
              className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
            >
              ← Airline-Verwaltung
            </Link>
          </div>
        </header>

        {/* Filter-row: status-tabs + rank-select */}
        <section className="mb-6 flex flex-wrap items-center gap-4">
          {/* Status-tabs */}
          <div
            className="inline-flex bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden"
            role="tablist"
            aria-label="Status-Filter"
          >
            <FilterTab
              label="Alle"
              count={countByStatus.ALL}
              active={statusFilter === 'ALL'}
              href={buildFilterHref({ ...params, status: undefined })}
            />
            <FilterTab
              label="Aktiv"
              count={countByStatus.ACTIVE}
              active={statusFilter === 'ACTIVE'}
              href={buildFilterHref({ ...params, status: 'ACTIVE' })}
              tone="green"
            />
            <FilterTab
              label="Urlaub"
              count={countByStatus.LEAVE}
              active={statusFilter === 'LEAVE'}
              href={buildFilterHref({ ...params, status: 'LEAVE' })}
              tone="amber"
            />
            <FilterTab
              label="Inaktiv"
              count={countByStatus.INACTIVE}
              active={statusFilter === 'INACTIVE'}
              href={buildFilterHref({ ...params, status: 'INACTIVE' })}
              tone="gray"
            />
          </div>

          {/* Rank-filter — client component because the onChange handler
              can't be passed to children from a server component (RSC
              cannot serialize functions). See rank-filter-select.tsx. */}
          <RankFilterSelect
            currentRank={params.rank}
            currentStatus={params.status}
            availableRanks={availableRanks}
          />
        </section>

        {/* Pilot-list */}
        {personnel.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-lg text-gray-700 dark:text-gray-300 mb-2">
              Keine Piloten gefunden
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalAll === 0
                ? 'Diese Airline hat noch keine Mitglieder.'
                : 'Keine Piloten matchen die aktiven Filter.'}
            </p>
          </div>
        ) : (
          <PersonnelTable
            personnel={personnel}
            availableRanks={availableRanks}
            currentUserId={user.id}
          />
        )}

        {/* Info-footer */}
        <aside className="mt-10 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Employment-Status:
            </strong>{' '}
            <span className="text-green-700 dark:text-green-400">Aktiv</span>{' '}
            = normaler operativer pilot.{' '}
            <span className="text-amber-700 dark:text-amber-400">Urlaub</span>{' '}
            = vorübergehend nicht verfügbar (urlaub, sabbatical, prüfungs-
            vorbereitung).{' '}
            <span className="text-gray-700 dark:text-gray-300">Inaktiv</span>{' '}
            = long-term nicht aktiv. Status ist roleplay-info — kein
            hard-gate auf bookings, piloten können trotzdem fliegen wenn
            sie wollen.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Manuelle Rang-Zuweisung:
            </strong>{' '}
            Der Rang-dropdown überschreibt die auto-promotion. Wenn ein
            pilot später die hours-threshold eines höheren rangs erreicht,
            wird er beim nächsten PIREP-Submit wieder hochgepromotet
            (no-demote-policy). Manuelle zuweisung ist eine korrektur,
            kein hard-cap.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Performance-Stats:
            </strong>{' '}
            <code>Letzter Flug</code> = MAX(submitted) aller PIREPs.{' '}
            <code>30d</code> = flights und hours der letzten 30 tage.{' '}
            <code>Approval</code> = % approved von allen submitted PIREPs.
            Approval-rate &lt; 80% kann auf qualitäts-probleme oder
            falsch-eingereichte PIREPs hinweisen.
          </p>
        </aside>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build href with merged search-params. Undefined/empty values werden
 * entfernt (nicht mit '=' am ende serialisiert).
 */
function buildFilterHref(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `/airline/pilots?${qs}` : '/airline/pilots';
}

function FilterTab({
  label,
  count,
  active,
  href,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
  tone?: 'green' | 'amber' | 'gray';
}) {
  // Active state: tone-based highlight für status-tabs (visual-coherence
  // zum employment-status-toggle).
  const activeClass =
    tone === 'green'
      ? 'bg-green-500/15 text-green-700 dark:text-green-300'
      : tone === 'amber'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : tone === 'gray'
          ? 'bg-gray-500/15 text-gray-700 dark:text-gray-300'
          : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300';

  return (
    <Link
      href={href}
      className={`px-3 py-2 text-sm font-medium border-r last:border-r-0 border-gray-200 dark:border-gray-800 transition ${
        active
          ? activeClass
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
      <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-500 tabular-nums">
        ({count})
      </span>
    </Link>
  );
}

function PersonnelTable({
  personnel,
  availableRanks,
  currentUserId,
}: {
  personnel: PersonnelEntry[];
  availableRanks: { id: string; name: string; order: number }[];
  currentUserId: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 dark:bg-gray-800/50">
          <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <th className="px-4 py-3">Pilot</th>
            <th className="px-4 py-3">Rang</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Stunden</th>
            <th className="px-4 py-3 text-right">30d</th>
            <th className="px-4 py-3 text-right">Letzter Flug</th>
            <th className="px-4 py-3 text-right">Approval</th>
            <th className="px-4 py-3">Position</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {personnel.map((p) => (
            <PersonnelRow
              key={p.id}
              pilot={p}
              availableRanks={availableRanks}
              isCurrentUser={p.id === currentUserId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonnelRow({
  pilot,
  availableRanks,
  isCurrentUser,
}: {
  pilot: PersonnelEntry;
  availableRanks: { id: string; name: string; order: number }[];
  isCurrentUser: boolean;
}) {
  return (
    <tr
      className={`transition ${
        isCurrentUser
          ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
      } ${pilot.employmentStatus === 'INACTIVE' ? 'opacity-60' : ''}`}
    >
      {/* Pilot: avatar + name + admin/role-badge + (Du)-marker */}
      <td className="px-4 py-3">
        <Link href={`/pilots/${pilot.id}`} className="flex items-center gap-3">
          {pilot.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pilot.image}
              alt={pilot.name ?? 'Avatar'}
              className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-semibold flex items-center gap-1.5 truncate">
              {pilot.name ?? 'Unbenannt'}
              {isCurrentUser && (
                <span className="text-xs text-indigo-600 dark:text-indigo-400 shrink-0">
                  (Du)
                </span>
              )}
            </p>
            {pilot.roleName && pilot.roleName !== 'pilot' && (
              <p className="text-xs text-gray-500 dark:text-gray-500 truncate">
                {pilot.roleName}
              </p>
            )}
          </div>
        </Link>
      </td>

      {/* Rank: dropdown */}
      <td className="px-4 py-3">
        <RankDropdown
          userId={pilot.id}
          currentRankId={pilot.rankId}
          availableRanks={availableRanks}
        />
      </td>

      {/* Status: segmented toggle */}
      <td className="px-4 py-3">
        <EmploymentStatusToggle
          userId={pilot.id}
          currentStatus={pilot.employmentStatus}
        />
      </td>

      {/* Total hours + flights */}
      <td className="px-4 py-3 text-right tabular-nums">
        <p className="font-medium">{pilot.totalFlightHours.toFixed(1)} h</p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {pilot.totalFlights} {pilot.totalFlights === 1 ? 'Flug' : 'Flüge'}
        </p>
      </td>

      {/* 30d activity */}
      <td className="px-4 py-3 text-right tabular-nums">
        {pilot.flightsLast30d === 0 ? (
          <span className="text-xs text-gray-400 dark:text-gray-600 italic">
            keine
          </span>
        ) : (
          <>
            <p className="font-medium">{pilot.hoursLast30d.toFixed(1)} h</p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {pilot.flightsLast30d}{' '}
              {pilot.flightsLast30d === 1 ? 'Flug' : 'Flüge'}
            </p>
          </>
        )}
      </td>

      {/* Last flight recency */}
      <td className="px-4 py-3 text-right text-xs">
        {pilot.lastFlightAt ? (
          <RecencyBadge date={pilot.lastFlightAt} />
        ) : (
          <span className="text-gray-400 dark:text-gray-600 italic">nie</span>
        )}
      </td>

      {/* Approval rate */}
      <td className="px-4 py-3 text-right tabular-nums text-xs">
        {pilot.approvalRatePct === null ? (
          <span className="text-gray-400 dark:text-gray-600 italic">—</span>
        ) : (
          <ApprovalRateBadge rate={pilot.approvalRatePct} />
        )}
      </td>

      {/* Current location vs base */}
      <td className="px-4 py-3 text-xs">
        {pilot.currentLocationIcao ? (
          <div>
            <p className="font-mono font-medium">
              {pilot.currentLocationIcao}
            </p>
            {pilot.baseIcao &&
              pilot.baseIcao !== pilot.currentLocationIcao && (
                <p className="text-gray-500 dark:text-gray-500">
                  Base: <span className="font-mono">{pilot.baseIcao}</span>
                </p>
              )}
            {pilot.baseIcao === pilot.currentLocationIcao && (
              <p className="text-green-700 dark:text-green-400">@ Base</p>
            )}
          </div>
        ) : pilot.baseIcao ? (
          <p className="text-gray-500 dark:text-gray-500">
            Base: <span className="font-mono">{pilot.baseIcao}</span>
          </p>
        ) : (
          <span className="text-gray-400 dark:text-gray-600 italic">—</span>
        )}
      </td>
    </tr>
  );
}

/**
 * Recency-badge: zeigt "vor X tagen" mit color-coding wie alt der letzte
 * flug ist. <7d = grün, <30d = gray, <90d = amber, >90d = red. Hilft
 * admins schnell inactive-piloten zu identifizieren ohne explizit nach
 * datum zu rechnen.
 */
function RecencyBadge({ date }: { date: Date }) {
  const days = Math.floor(
    (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  let label: string;
  let color: string;
  if (days === 0) {
    label = 'heute';
    color = 'text-green-700 dark:text-green-400';
  } else if (days === 1) {
    label = 'gestern';
    color = 'text-green-700 dark:text-green-400';
  } else if (days < 7) {
    label = `vor ${days} Tagen`;
    color = 'text-green-700 dark:text-green-400';
  } else if (days < 30) {
    label = `vor ${days} Tagen`;
    color = 'text-gray-700 dark:text-gray-300';
  } else if (days < 90) {
    const weeks = Math.floor(days / 7);
    label = `vor ${weeks} Wochen`;
    color = 'text-amber-700 dark:text-amber-400';
  } else {
    const months = Math.floor(days / 30);
    label = `vor ${months} Monaten`;
    color = 'text-red-700 dark:text-red-400';
  }
  return (
    <span
      className={color}
      title={date.toLocaleDateString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })}
    >
      {label}
    </span>
  );
}

/**
 * Approval-rate-badge mit color-coding: ≥95% grün, ≥80% gray, <80% amber,
 * <50% red. Schnelle visual cue für admin: wer braucht ein gespräch über
 * PIREP-qualität?
 */
function ApprovalRateBadge({ rate }: { rate: number }) {
  let color: string;
  if (rate >= 95) color = 'text-green-700 dark:text-green-400';
  else if (rate >= 80) color = 'text-gray-700 dark:text-gray-300';
  else if (rate >= 50) color = 'text-amber-700 dark:text-amber-400';
  else color = 'text-red-700 dark:text-red-400';
  return <span className={color}>{rate}%</span>;
}
