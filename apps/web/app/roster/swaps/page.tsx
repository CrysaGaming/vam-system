import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import {
  listIncomingForPilot,
  listOutgoingForPilot,
  type RosterSwapRequestWithRelations,
} from '@vam/db';
import Link from 'next/link';
import { SwapResponseButtons } from './swap-response-buttons';
import { CancelSwapButton } from './cancel-swap-button';

/**
 * Track 5 #29 (Section F) — /roster/swaps
 *
 * Pilot swap-inbox. Drei tabs (alle in derselben page via search-param):
 *   - incoming (default) — swaps wo ICH der target bin
 *   - outgoing — swaps die ICH initiiert habe
 *   - history — beide, aber nur non-PENDING (audit-view)
 *
 * Inline accept/reject-buttons sind eigene client-components weil sie
 * useTransition + form-state brauchen. List-rendering selber bleibt RSC.
 *
 * # Lazy-expire-display
 *
 * Ein swap mit status=PENDING aber expiresAt<now() wird als "abgelaufen"
 * angezeigt (orange badge statt blue), und accept/reject-buttons sind
 * disabled. Wir setzen den DB-status NICHT um — das wäre ein cron-job-
 * scope. Lazy-display reicht für UX.
 */

type SearchParams = Promise<{ tab?: 'incoming' | 'outgoing' | 'history' }>;

export default async function SwapsInboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const userId = session.user.id;
  const params = await searchParams;
  const tab = params.tab ?? 'incoming';

  const [incoming, outgoing] = await Promise.all([
    listIncomingForPilot({ pilotId: userId, limit: 50 }),
    listOutgoingForPilot({ pilotId: userId, limit: 50 }),
  ]);

  const now = new Date();
  // Counts: PENDING + not-expired
  const incomingPendingCount = incoming.filter(
    (s) => s.status === 'PENDING' && s.expiresAt > now,
  ).length;
  const outgoingPendingCount = outgoing.filter(
    (s) => s.status === 'PENDING' && s.expiresAt > now,
  ).length;

  let visibleSwaps: RosterSwapRequestWithRelations[];
  if (tab === 'incoming') {
    visibleSwaps = incoming;
  } else if (tab === 'outgoing') {
    visibleSwaps = outgoing;
  } else {
    // history: alle non-PENDING aus beiden listen, sortiert by createdAt desc
    visibleSwaps = [...incoming, ...outgoing]
      .filter((s) => s.status !== 'PENDING')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground hover:underline">
            Dashboard
          </Link>
          <span className="mx-2 text-muted-foreground/40">/</span>
          <span>Swap-Anfragen</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">🔄 Swap-Anfragen</h1>
        <p className="text-sm text-muted-foreground">
          Tausche Roster-Assignments mit anderen Piloten. Eingehende Anfragen
          haben Vorrang in der Default-Ansicht.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800" aria-label="Tabs">
        <Tab href="/roster/swaps" label="Eingehend" badge={incomingPendingCount} active={tab === 'incoming'} />
        <Tab href="/roster/swaps?tab=outgoing" label="Ausgehend" badge={outgoingPendingCount} active={tab === 'outgoing'} />
        <Tab href="/roster/swaps?tab=history" label="Verlauf" badge={null} active={tab === 'history'} />
      </nav>

      {visibleSwaps.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleSwaps.map((s) => (
            <SwapCard key={s.id} swap={s} viewerId={userId} now={now} />
          ))}
        </ul>
      )}
    </main>
  );
}

function Tab({
  href,
  label,
  badge,
  active,
}: {
  href: string;
  label: string;
  badge: number | null;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
        active
          ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400'
          : 'border-transparent hover:text-foreground text-muted-foreground'
      }`}
    >
      {label}
      {badge !== null && badge > 0 && (
        <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold">
          {badge}
        </span>
      )}
    </Link>
  );
}

function EmptyState({ tab }: { tab: string }) {
  const message =
    tab === 'incoming'
      ? 'Keine eingehenden Swap-Anfragen. Wenn ein anderer Pilot mit dir tauschen will, taucht das hier auf.'
      : tab === 'outgoing'
        ? 'Keine ausgehenden Anfragen. Du kannst von deinem Dashboard aus einen Swap starten.'
        : 'Noch kein Verlauf — alle deine Swap-Anfragen werden hier dokumentiert.';
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-800 p-12 text-center text-muted-foreground">
      <div className="text-4xl mb-2" aria-hidden="true">🔄</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SwapCard
// ─────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<
  RosterSwapRequestWithRelations['status'],
  { label: string; class: string }
> = {
  PENDING: { label: 'Offen', class: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  ACCEPTED: { label: 'Akzeptiert', class: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  REJECTED: { label: 'Abgelehnt', class: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
  CANCELLED: { label: 'Storniert', class: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300' },
  EXPIRED: { label: 'Abgelaufen', class: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
};

function SwapCard({
  swap,
  viewerId,
  now,
}: {
  swap: RosterSwapRequestWithRelations;
  viewerId: string;
  now: Date;
}) {
  const iAmRequester = swap.requesterId === viewerId;
  const iAmTarget = swap.targetPilotId === viewerId;
  const isExpired = swap.status === 'PENDING' && swap.expiresAt < now;
  // Display status reflektiert lazy-expire
  const displayStatus = isExpired ? 'EXPIRED' : swap.status;
  const badge = STATUS_BADGE[displayStatus];

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDt = (d: Date) => {
    return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
  };

  // Hours bis expiry (negativ wenn schon expired)
  const hoursUntilExpiry =
    (swap.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-col gap-0.5">
          <div className="text-xs text-muted-foreground">
            {iAmRequester
              ? `Du → ${swap.targetPilot.name ?? 'Pilot'}`
              : `${swap.requester.name ?? 'Pilot'} → Du`}
            <span className="mx-2 text-muted-foreground/40">·</span>
            <span title={swap.createdAt.toISOString()}>
              {formatDt(swap.createdAt)}
            </span>
          </div>
          {displayStatus === 'PENDING' && hoursUntilExpiry > 0 && hoursUntilExpiry < 12 && (
            <div className="text-xs text-amber-700 dark:text-amber-400">
              ⏰ Läuft in {Math.round(hoursUntilExpiry)}h ab
            </div>
          )}
        </div>
        <span className={`shrink-0 inline-block px-2 py-0.5 rounded-md text-xs font-medium ${badge.class}`}>
          {badge.label}
        </span>
      </div>

      {/* Flight-pair-visualization */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mb-3">
        <FlightCard
          label={iAmRequester ? 'Du gibst ab' : 'Bekommst du'}
          assignment={swap.requesterAssignment}
          formatDt={formatDt}
        />
        <div className="text-2xl text-muted-foreground" aria-hidden="true">
          ↔
        </div>
        <FlightCard
          label={iAmRequester ? 'Du willst' : 'Du gibst ab'}
          assignment={swap.targetAssignment}
          formatDt={formatDt}
        />
      </div>

      {swap.message && (
        <div className="text-xs italic text-muted-foreground border-l-2 border-indigo-300 dark:border-indigo-700 pl-3 mb-2">
          „{swap.message}"
        </div>
      )}

      {swap.responseMessage && (
        <div className="text-xs italic text-muted-foreground border-l-2 border-gray-300 dark:border-gray-700 pl-3 mb-2">
          Antwort: „{swap.responseMessage}"
        </div>
      )}

      {/* Action buttons */}
      {swap.status === 'PENDING' && !isExpired && iAmTarget && (
        <SwapResponseButtons swapRequestId={swap.id} />
      )}
      {swap.status === 'PENDING' && !isExpired && iAmRequester && (
        <CancelSwapButton swapRequestId={swap.id} />
      )}
    </li>
  );
}

function FlightCard({
  label,
  assignment,
  formatDt,
}: {
  label: string;
  assignment: RosterSwapRequestWithRelations['requesterAssignment'];
  formatDt: (d: Date) => string;
}) {
  const route = assignment.scheduledFlight.route;
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-800 p-2.5 bg-gray-50 dark:bg-gray-950/50">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div className="font-mono text-sm font-medium text-indigo-700 dark:text-indigo-400">
        {route.flightNumber}
      </div>
      <div className="font-mono text-xs text-muted-foreground">
        {route.departure.icao} → {route.arrival.icao}
      </div>
      <div className="font-mono text-xs text-muted-foreground">
        {formatDt(assignment.scheduledFlight.departureTime)}
      </div>
      {route.aircraftTypeIcao && (
        <div className="text-xs text-gray-500 mt-0.5">{route.aircraftTypeIcao}</div>
      )}
    </div>
  );
}
