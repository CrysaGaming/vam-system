import {
  listAssignmentsForPilot,
  countActiveAssignmentsForPilot,
  RosterAssignmentStatus,
} from '@vam/db';
import Link from 'next/link';

/**
 * Track 5 #26 (Section F) — Dashboard Roster-Card
 *
 * Pilot-facing widget für die /dashboard page. Zeigt die nächsten N
 * aktiven roster-assignments (ASSIGNED + ACCEPTED) sortiert nach
 * departureTime asc.
 *
 * # Render-modes
 *
 *   - 0 assignments → render null. Kein "leer-state" — wenn der pilot
 *     keine zuweisungen hat, soll die card nicht platz fressen mit
 *     "du hast nichts". Dashboard ist sowieso card-dicht.
 *   - 1-N → kompakte liste mit max 5 entries + "alle anzeigen"-link
 *     wenn mehr existieren.
 *
 * # Server-component
 *
 * Pure RSC mit data-fetching auf dem server. Keine state, keine
 * interaction — pilot kann die assignment nur via einem follow-up-flow
 * (in #27) bestätigen/ablehnen. Für jetzt: read-only display.
 *
 * # Future hooks (#27+)
 *
 * Pro row wird später ein "akzeptieren"-button hinzukommen (für
 * status=ASSIGNED rows). Status=ACCEPTED rows kriegen einen "swap
 * anfragen"-button (in #29). Für #26 nur display.
 */
export async function DashboardRosterCard({ pilotId }: { pilotId: string }) {
  // Limit auf 6 damit wir 5 anzeigen + "more"-indicator wenn ≥6.
  const assignments = await listAssignmentsForPilot({
    pilotId,
    includeFinished: false,
    limit: 6,
  });

  if (assignments.length === 0) return null;

  const totalActive = await countActiveAssignmentsForPilot(pilotId);
  const showMoreLink = totalActive > 5;
  const displayAssignments = assignments.slice(0, 5);

  return (
    <section className="bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-wider text-gray-500">
          📋 Deine zugewiesenen Flüge
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-500">
          {totalActive} {totalActive === 1 ? 'flight' : 'flights'}
        </span>
      </div>

      <ul className="divide-y divide-gray-200 dark:divide-gray-800 -mx-2">
        {displayAssignments.map((a) => (
          <li key={a.id} className="px-2 py-3">
            <AssignmentRowCompact assignment={a} />
          </li>
        ))}
      </ul>

      {showMoreLink && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          <Link
            href="/pireps"
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Alle {totalActive} anzeigen →
          </Link>
        </div>
      )}
    </section>
  );
}

const STATUS_DOT: Record<RosterAssignmentStatus, string> = {
  ASSIGNED: 'bg-blue-500',
  ACCEPTED: 'bg-green-500',
  COMPLETED: 'bg-gray-400',
  SWAPPED: 'bg-purple-500',
  CANCELLED: 'bg-red-500',
  NO_SHOW: 'bg-orange-500',
};

const STATUS_LABEL: Record<RosterAssignmentStatus, string> = {
  ASSIGNED: 'Zugewiesen',
  ACCEPTED: 'Akzeptiert',
  COMPLETED: 'Erledigt',
  SWAPPED: 'Getauscht',
  CANCELLED: 'Abgebrochen',
  NO_SHOW: 'No-show',
};

function AssignmentRowCompact({
  assignment,
}: {
  assignment: Awaited<ReturnType<typeof listAssignmentsForPilot>>[number];
}) {
  const route = assignment.scheduledFlight.route;
  const dt = new Date(assignment.scheduledFlight.departureTime);
  const pad = (n: number) => String(n).padStart(2, '0');
  // Kompakte format für dashboard-row: "Sa 15.05 08:00Z". Wochentag-kurzform
  // hilft mental-mapping mehr als YYYY-MM-DD; Pilots sehen "Sa" und wissen
  // "ah, samstag".
  const weekday = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][dt.getUTCDay()];
  const dateStr = `${weekday} ${pad(dt.getUTCDate())}.${pad(dt.getUTCMonth() + 1)} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}Z`;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[assignment.status]}`}
        aria-label={STATUS_LABEL[assignment.status]}
        title={STATUS_LABEL[assignment.status]}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-medium text-xs">{route.flightNumber}</span>
          <span className="text-xs text-muted-foreground">
            {route.departure.icao} → {route.arrival.icao}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">
          {dateStr}
        </div>
      </div>
      {assignment.assignedAircraft && (
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {assignment.assignedAircraft.registration}
        </span>
      )}
    </div>
  );
}
