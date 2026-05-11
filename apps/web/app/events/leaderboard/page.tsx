import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@vam/db';

/**
 * Track 4 #97 (Section S) — Event-Leaderboard.
 *
 * /events/leaderboard — top pilots by event-completions. Derived view
 * aus EventParticipant + Event aggregations.
 *
 * # Rankings (3 tabs)
 *
 * - "Completions" — most completed events all-time. Primary sort.
 *   Tiebreaker: completion-rate desc, dann name asc.
 * - "Bonus-Earned" — total bonus-VAM$ aus completed events. Visualisiert
 *   die monetary-reward dimension der event-participation.
 * - "Participation" — most events joined (regardless of completion).
 *   Engagement-metric. Tiebreaker: completion-rate desc.
 *
 * # Scoping
 *
 * Multi-tenant: leaderboard zeigt nur pilots der user-airline. VA-wide
 * events (airlineId=null) zählen für alle airlines mit (cross-airline
 * mixin), aber pilots aus anderen airlines bleiben unsichtbar.
 *
 * # Out-of-scope für v1
 *
 * - Time-window-filter (alle-zeit vs. letzten 12 monate): nice-to-have
 *   aber MVP nutzt all-time, einfacher mentaler model.
 * - Per-kind-leaderboards (TOP-tour-pilot, TOP-themed-pilot): events sind
 *   typischerweise nicht häufig genug pro kind um separate rankings
 *   sinnvoll zu machen.
 * - Bonus-display nur an completers — keine extra revenue-tracking,
 *   das ist die domäne von /wallet.
 */

interface Props {
  searchParams: Promise<{ sort?: string }>;
}

type SortMode = 'completions' | 'bonus' | 'participation';

function parseSortMode(value: string | undefined): SortMode {
  if (value === 'bonus' || value === 'participation') return value;
  return 'completions';
}

interface PilotStats {
  userId: string;
  name: string | null;
  image: string | null;
  rankName: string | null;
  totalJoined: number;
  totalCompleted: number;
  completionRate: number; // 0-100
  totalBonusEarned: number; // VAM$
}

export default async function EventLeaderboardPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await searchParams;
  const sort = parseSortMode(params.sort);

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { airlineId: true },
  });
  if (!currentUser?.airlineId) {
    // User ohne airline kann theoretisch nicht hier sein (sidebar-link
    // ist gegated), aber defensive: zeig empty-state.
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">Event-Leaderboard</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Du musst einer airline angehören um das leaderboard zu sehen.
          </p>
        </div>
      </main>
    );
  }

  // Query: EventParticipant rows der pilots in user's airline, inkl.
  // event-data (für bonus-calc + scoping check).
  //
  // Wir scopen die PARTICIPANTS auf die airline (user.airlineId =
  // currentUser.airlineId) — Cross-airline event-participations
  // bleiben damit aus dem ranking. VA-wide events zählen mit weil
  // die teilnehmer-user trotzdem aus der user-airline kommen können.
  const participations = await prisma.eventParticipant.findMany({
    where: {
      user: { airlineId: currentUser.airlineId },
    },
    select: {
      userId: true,
      completed: true,
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          rank: { select: { name: true } },
        },
      },
      event: {
        select: {
          bonusReward: true,
        },
      },
    },
  });

  // Aggregate per pilot
  const byPilot = new Map<string, PilotStats>();
  for (const p of participations) {
    const existing = byPilot.get(p.userId) ?? {
      userId: p.userId,
      name: p.user.name,
      image: p.user.image,
      rankName: p.user.rank?.name ?? null,
      totalJoined: 0,
      totalCompleted: 0,
      completionRate: 0,
      totalBonusEarned: 0,
    };
    existing.totalJoined += 1;
    if (p.completed) {
      existing.totalCompleted += 1;
      existing.totalBonusEarned += Number(p.event.bonusReward);
    }
    byPilot.set(p.userId, existing);
  }
  // Compute completion-rate
  for (const stats of byPilot.values()) {
    stats.completionRate =
      stats.totalJoined > 0
        ? Math.round((stats.totalCompleted / stats.totalJoined) * 100)
        : 0;
  }

  // Sort by selected mode
  const allPilots = Array.from(byPilot.values());
  const sorted = sortBy(allPilots, sort);

  // Stats
  const totalParticipations = participations.length;
  const totalCompletions = participations.filter((p) => p.completed).length;
  const totalBonusPayout = participations.reduce(
    (sum, p) => (p.completed ? sum + Number(p.event.bonusReward) : sum),
    0,
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-6">
          <Link
            href="/events"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-2 inline-block"
          >
            ← Events-Katalog
          </Link>
          <h1 className="text-3xl font-bold">🏆 Event-Leaderboard</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Top pilots der airline nach event-engagement
          </p>
        </header>

        {/* Summary cards */}
        <section className="grid grid-cols-3 gap-3 mb-6">
          <SummaryCard
            label="Anmeldungen"
            value={totalParticipations.toString()}
          />
          <SummaryCard
            label="Completions"
            value={totalCompletions.toString()}
            accent
          />
          <SummaryCard
            label="Bonus-Ausschüttung"
            value={`${totalBonusPayout.toLocaleString('de-DE')}`}
            sublabel="VAM$"
          />
        </section>

        {/* Sort-mode tabs */}
        <div className="flex flex-wrap gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-1 mb-6">
          <SortTab
            label="🏅 Completions"
            href="/events/leaderboard"
            active={sort === 'completions'}
          />
          <SortTab
            label="💰 Bonus-Earned"
            href="/events/leaderboard?sort=bonus"
            active={sort === 'bonus'}
          />
          <SortTab
            label="🎯 Participation"
            href="/events/leaderboard?sort=participation"
            active={sort === 'participation'}
          />
        </div>

        {/* Leaderboard list */}
        {sorted.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              Noch keine event-teilnahmen.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500">
              Sobald pilots events joinen, erscheinen sie hier im ranking.
            </p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {sorted.slice(0, 25).map((pilot, idx) => (
              <PilotRow
                key={pilot.userId}
                pilot={pilot}
                rank={idx + 1}
                sortMode={sort}
              />
            ))}
          </ol>
        )}

        {sorted.length > 25 && (
          <p className="text-xs text-gray-500 dark:text-gray-500 italic text-center mt-4">
            Top 25 angezeigt. Insgesamt {sorted.length} pilots mit
            event-teilnahmen.
          </p>
        )}

        {/* Info footer */}
        <aside className="mt-8 bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Sortier-modi:
            </strong>{' '}
            Completions zählt erfolgreich abgeschlossene events;
            Bonus-Earned summiert VAM$-rewards aus completed events;
            Participation zählt alle teilnahmen unabhängig vom
            completion-flag.
          </p>
          <p>
            <strong className="text-gray-700 dark:text-gray-300">
              Scope:
            </strong>{' '}
            Nur pilots der user-airline. VA-wide events zählen für
            alle airlines mit, aber pilots aus anderen airlines bleiben
            ausgeblendet.
          </p>
        </aside>
      </div>
    </main>
  );
}

function sortBy(pilots: PilotStats[], mode: SortMode): PilotStats[] {
  const sorted = [...pilots];
  switch (mode) {
    case 'completions':
      sorted.sort((a, b) => {
        if (b.totalCompleted !== a.totalCompleted)
          return b.totalCompleted - a.totalCompleted;
        if (b.completionRate !== a.completionRate)
          return b.completionRate - a.completionRate;
        return (a.name ?? '').localeCompare(b.name ?? '');
      });
      return sorted;
    case 'bonus':
      sorted.sort((a, b) => {
        if (b.totalBonusEarned !== a.totalBonusEarned)
          return b.totalBonusEarned - a.totalBonusEarned;
        return b.totalCompleted - a.totalCompleted;
      });
      return sorted;
    case 'participation':
      sorted.sort((a, b) => {
        if (b.totalJoined !== a.totalJoined)
          return b.totalJoined - a.totalJoined;
        if (b.completionRate !== a.completionRate)
          return b.completionRate - a.completionRate;
        return (a.name ?? '').localeCompare(b.name ?? '');
      });
      return sorted;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`border rounded-lg p-3 ${
        accent
          ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
      }`}
    >
      <p
        className={`text-[10px] uppercase tracking-wide font-medium ${
          accent
            ? 'text-emerald-700 dark:text-emerald-400'
            : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {label}
      </p>
      <p
        className={`text-xl font-bold font-mono mt-0.5 ${
          accent ? 'text-emerald-900 dark:text-emerald-200' : ''
        }`}
      >
        {value}
        {sublabel && (
          <span className="text-xs text-gray-500 dark:text-gray-500 ml-1 font-normal">
            {sublabel}
          </span>
        )}
      </p>
    </div>
  );
}

function SortTab({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
        active
          ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </Link>
  );
}

function PilotRow({
  pilot,
  rank,
  sortMode,
}: {
  pilot: PilotStats;
  rank: number;
  sortMode: SortMode;
}) {
  // Highlight-style nur für top 3 + nur in primary-mode (completions).
  // In andere sort-modes ist top-3 etwas weniger eyecatcher-wert weil
  // bonus/participation einen anderen "winner"-charakter haben.
  const isTop3 = rank <= 3 && sortMode === 'completions';
  const medal =
    rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  // Primary metric je nach sort-mode
  let primaryValue: string;
  let primaryLabel: string;
  if (sortMode === 'completions') {
    primaryValue = pilot.totalCompleted.toString();
    primaryLabel = pilot.totalCompleted === 1 ? 'Completion' : 'Completions';
  } else if (sortMode === 'bonus') {
    primaryValue = pilot.totalBonusEarned.toLocaleString('de-DE');
    primaryLabel = 'VAM$';
  } else {
    primaryValue = pilot.totalJoined.toString();
    primaryLabel = pilot.totalJoined === 1 ? 'Teilnahme' : 'Teilnahmen';
  }

  return (
    <li
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
        rank === 1 && isTop3
          ? 'bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-300 dark:border-yellow-500/40'
          : rank === 2 && isTop3
            ? 'bg-gray-100 dark:bg-gray-800/70 border border-gray-300 dark:border-gray-700'
            : rank === 3 && isTop3
              ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40'
              : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800'
      }`}
    >
      <span
        className="text-base shrink-0 w-8 text-center font-bold"
        aria-hidden="true"
      >
        {medal ?? `${rank}.`}
      </span>
      {pilot.image ? (
        <picture className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pilot.image}
            alt=""
            className="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-gray-800"
          />
        </picture>
      ) : (
        <div
          className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-sm font-semibold text-gray-500 dark:text-gray-400 shrink-0"
          aria-hidden="true"
        >
          {(pilot.name ?? '?').charAt(0).toUpperCase()}
        </div>
      )}
      <Link
        href={`/pilots/${pilot.userId}`}
        className="flex-1 min-w-0 group"
      >
        <div className="font-semibold text-sm truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition">
          {pilot.name ?? 'Anonym'}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
          {pilot.rankName && <span>{pilot.rankName}</span>}
          <span>
            {pilot.totalJoined} joined · {pilot.completionRate}% complete-rate
          </span>
          {pilot.totalBonusEarned > 0 && sortMode !== 'bonus' && (
            <span className="text-amber-600 dark:text-amber-400">
              💰 {pilot.totalBonusEarned.toLocaleString('de-DE')} VAM$
            </span>
          )}
        </div>
      </Link>
      <div className="text-right shrink-0">
        <div className="font-mono font-bold text-base">{primaryValue}</div>
        <div className="text-[10px] text-gray-500 dark:text-gray-500 uppercase tracking-wide">
          {primaryLabel}
        </div>
      </div>
    </li>
  );
}
