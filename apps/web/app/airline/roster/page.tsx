import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import {
  listAssignmentsForAirline,
  RosterAssignmentStatus,
  type RosterAssignmentWithRelations,
} from '@vam/db';
import Link from 'next/link';

/**
 * Track 5 #26 (Section F) — /airline/roster
 *
 * Admin-overview aller roster-assignments der eigenen airline. Zeigt
 * zugewiesene flights mit pilot, route, datum, aircraft, status.
 *
 * # Filter-tabs
 *
 * Status-filter via search-param `?status=...`. Default ohne filter zeigt
 * ALLE statuses (ASSIGNED + ACCEPTED + COMPLETED + SWAPPED + CANCELLED +
 * NO_SHOW). Common-uses:
 *   - `?status=upcoming` → ASSIGNED + ACCEPTED (häufigster admin-blick)
 *   - `?status=problems` → NO_SHOW + CANCELLED + SWAPPED (review-queue)
 *   - `?status=ASSIGNED` etc. → einzelner status
 *
 * # Was NICHT hier ist (foundation only)
 *
 *   - Create-form für neue assignment (kommt in #27)
 *   - Bulk-assignment + auto-rotation (kommt in #28)
 *   - Swap-request-management (kommt in #29)
 *   - No-show-detection-job (kommt in #30)
 *
 * Die page ist read-only für #26. Admin sieht was zugewiesen ist, kann
 * aber noch nichts erstellen. Das ist absichtlich foundation-only.
 *
 * # Server-component
 *
 * Pure RSC — kein client-bundle für die list-view nötig. Filter-tabs
 * sind Link-tags die search-params ändern, kein useState/useEffect.
 */
type SearchParams = Promise<{ status?: string }>;

const STATUS_GROUPS: Record<string, RosterAssignmentStatus[]> = {
  upcoming: ['ASSIGNED', 'ACCEPTED'],
  problems: ['NO_SHOW', 'CANCELLED', 'SWAPPED'],
  ASSIGNED: ['ASSIGNED'],
  ACCEPTED: ['ACCEPTED'],
  COMPLETED: ['COMPLETED'],
  SWAPPED: ['SWAPPED'],
  CANCELLED: ['CANCELLED'],
  NO_SHOW: ['NO_SHOW'],
};

export default async function AirlineRosterPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireAirlineManagerWithAirlinePage();
  const params = await searchParams;
  // Explicit ternary statt `params.status && STATUS_GROUPS[...]`: bei
  // `params.status = ""` würde `&&` den falsy-empty-string zurückgeben statt
  // undefined, was den unionsfetzten type `"" | RosterAssignmentStatus[]`
  // produziert. Ternary garantiert clean `RosterAssignmentStatus[] | undefined`.
  const statusFilter: RosterAssignmentStatus[] | undefined = params.status
    ? STATUS_GROUPS[params.status]
    : undefined;

  const assignments = await listAssignmentsForAirline({
    airlineId: user.airlineId,
    statuses: statusFilter,
    limit: 200,
  });

  // Counts pro filter-group für die tabs. Eigener query damit die counts
  // auch dann stimmen wenn der user einen filter aktiv hat (sonst würde
  // jede tab nur eigene rows zählen). Cheap: läuft auf dem [airlineId,
  // status] index.
  const allAssignments = statusFilter
    ? await listAssignmentsForAirline({
        airlineId: user.airlineId,
        limit: 200,
      })
    : assignments;

  const counts = {
    upcoming: allAssignments.filter((a) =>
      STATUS_GROUPS.upcoming.includes(a.status),
    ).length,
    problems: allAssignments.filter((a) =>
      STATUS_GROUPS.problems.includes(a.status),
    ).length,
    completed: allAssignments.filter((a) => a.status === 'COMPLETED').length,
    total: allAssignments.length,
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-sm text-muted-foreground">
            <Link
              href="/airline"
              className="hover:text-foreground hover:underline"
            >
              Airline
            </Link>
            <span className="mx-2 text-muted-foreground/40">/</span>
            <span>Roster</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">📋 Roster</h1>
          <p className="text-sm text-muted-foreground">
            Übersicht aller zugewiesenen Flüge. Manuelle Zuweisung über
            den Button rechts; Auto-Rostering kommt in #28.
          </p>
        </div>
        <Link
          href="/airline/roster/new"
          className="inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition"
        >
          <span aria-hidden="true">✏️</span>
          Neue Zuweisung
        </Link>
      </header>

      <FilterTabs current={params.status} counts={counts} />

      {assignments.length === 0 ? (
        <EmptyState filter={params.status} />
      ) : (
        <AssignmentTable assignments={assignments} />
      )}
    </main>
  );
}

function FilterTabs({
  current,
  counts,
}: {
  current?: string;
  counts: { upcoming: number; problems: number; completed: number; total: number };
}) {
  // tabs aren't a UI-spec, just labeled count-links. Active-state via
  // direct comparison gegen current search-param.
  const tabs: Array<{ key: string | null; label: string; count: number; tone: 'default' | 'amber' | 'gray' }> = [
    { key: null, label: 'Alle', count: counts.total, tone: 'default' },
    { key: 'upcoming', label: 'Anstehend', count: counts.upcoming, tone: 'default' },
    { key: 'problems', label: 'Probleme', count: counts.problems, tone: 'amber' },
    { key: 'COMPLETED', label: 'Abgeschlossen', count: counts.completed, tone: 'gray' },
  ];

  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800" aria-label="Filter">
      {tabs.map((t) => {
        const isActive = (t.key ?? '') === (current ?? '');
        const href = t.key ? `/airline/roster?status=${t.key}` : '/airline/roster';
        const toneClass =
          t.tone === 'amber'
            ? 'text-amber-700 dark:text-amber-400'
            : t.tone === 'gray'
              ? 'text-gray-500 dark:text-gray-500'
              : '';
        return (
          <Link
            key={t.key ?? 'all'}
            href={href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              isActive
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400'
                : `border-transparent hover:text-foreground ${toneClass}`
            }`}
          >
            {t.label}
            <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {t.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function EmptyState({ filter }: { filter?: string }) {
  const message = filter
    ? `Keine assignments im filter "${filter}".`
    : 'Noch keine roster-assignments. Nutze „Neue Zuweisung" oben um die erste zu erstellen.';
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-800 p-12 text-center text-muted-foreground">
      <div className="text-4xl mb-2" aria-hidden="true">📋</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

const STATUS_BADGE: Record<RosterAssignmentStatus, { label: string; class: string }> = {
  ASSIGNED: { label: 'Zugewiesen', class: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  ACCEPTED: { label: 'Akzeptiert', class: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
  COMPLETED: { label: 'Erledigt', class: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300' },
  SWAPPED: { label: 'Getauscht', class: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
  CANCELLED: { label: 'Abgebrochen', class: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
  NO_SHOW: { label: 'No-show', class: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
};

function AssignmentTable({ assignments }: { assignments: RosterAssignmentWithRelations[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Pilot</th>
            <th className="px-4 py-3 font-medium">Flug</th>
            <th className="px-4 py-3 font-medium">Datum (UTC)</th>
            <th className="px-4 py-3 font-medium">Aircraft</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Notiz</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {assignments.map((a) => (
            <AssignmentRow key={a.id} assignment={a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignmentRow({ assignment }: { assignment: RosterAssignmentWithRelations }) {
  const route = assignment.scheduledFlight.route;
  const badge = STATUS_BADGE[assignment.status];
  // Compact UTC date+time formatter — keep YYYY-MM-DD HH:mm because pilots
  // think in flightsim-UTC. Locale toLocaleString would give ambiguous
  // results without explicit timeZone='UTC'.
  const dt = new Date(assignment.scheduledFlight.departureTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}Z`;

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="font-medium">{assignment.pilot.name ?? '—'}</div>
        {assignment.pilot.rank && (
          <div className="text-xs text-muted-foreground">{assignment.pilot.rank.name}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-xs">{route.flightNumber}</div>
        <div className="text-xs text-muted-foreground">
          {route.departure.icao} → {route.arrival.icao}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs">{formatted}</td>
      <td className="px-4 py-3">
        {assignment.assignedAircraft ? (
          <span className="font-mono text-xs">
            {assignment.assignedAircraft.registration}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {route.aircraftTypeIcao ?? '—'}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${badge.class}`}>
          {badge.label}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
        {assignment.note ?? <span className="italic">—</span>}
      </td>
    </tr>
  );
}
