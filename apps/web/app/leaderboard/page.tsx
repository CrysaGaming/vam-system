/**
 * Track 5 #9 — Airline Leaderboards Page.
 *
 * Route: /leaderboard
 *
 * Cross-pilot rankings innerhalb der airline des eingeloggten users.
 * 5 boards: Most Flights, Most Hours, Most Distance, Smoothest Pilot,
 * Most Recent Activity.
 *
 * # Why airline-scoped, not global
 *
 * Eine global leaderboard über alle airlines hätte zwei probleme:
 *   1. Privacy — pilots wollen meist nicht dass cross-airline-fremde
 *      ihre stats vergleichen
 *   2. Apples-to-oranges — eine 100-pilot-airline rankt anders als
 *      eine 5-pilot-airline; vergleich ist nicht fair
 *
 * V2 könnte global-leaderboards mit opt-in haben. V1 ist airline-internal.
 *
 * # Auth
 *
 * Nur logged-in user mit airlineId. Sonst → /dashboard redirect.
 *
 * # Layout
 *
 * 2-col grid auf desktop, 1-col mobile. 5 board-cards, jede zeigt
 * top-10. Current-user wird highlighted wenn er im board ist.
 */

import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import {
  prisma,
  getAirlineLeaderboards,
  type LeaderboardEntry,
} from '@vam/db';
import Link from 'next/link';

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/');

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      airlineId: true,
      airline: { select: { name: true, icao: true } },
    },
  });
  if (!currentUser?.airlineId) redirect('/dashboard');

  const boards = await getAirlineLeaderboards(currentUser.airlineId);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* ── Header ── */}
        <header className="mb-8 pb-6 border-b border-gray-200 dark:border-gray-800">
          <h1 className="text-3xl font-bold flex items-baseline gap-3 flex-wrap">
            Leaderboards 🏁
            {currentUser.airline && (
              <span className="text-sm font-normal text-gray-500">
                <span className="font-mono">{currentUser.airline.icao}</span>{' '}
                {currentUser.airline.name}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Top pilots deiner Airline. Stats nur über approved PIREPs.
          </p>
        </header>

        {/* ── 2-col grid mit boards ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BoardCard
            title="Most Flights"
            emoji="✈️"
            description="Anzahl approved PIREPs lifetime"
            entries={boards.mostFlights}
            currentUserId={currentUser.id}
          />
          <BoardCard
            title="Most Hours"
            emoji="⏱️"
            description="Summe der Flugzeit"
            entries={boards.mostHours}
            currentUserId={currentUser.id}
          />
          <BoardCard
            title="Most Distance"
            emoji="🗺️"
            description="Summe der nautical miles"
            entries={boards.mostDistance}
            currentUserId={currentUser.id}
          />
          <BoardCard
            title="Smoothest Pilot"
            emoji="🪶"
            description="Ø |fpm| beim touchdown (min. 5 Landings)"
            entries={boards.smoothestPilot}
            currentUserId={currentUser.id}
          />
          <BoardCard
            title="Most Recent Activity"
            emoji="🔥"
            description="Flüge in den letzten 7 Tagen"
            entries={boards.mostRecentActivity}
            currentUserId={currentUser.id}
            className="lg:col-span-2"
          />
        </div>
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BoardCard — eine ranking-card
// ──────────────────────────────────────────────────────────────────────

function BoardCard({
  title,
  emoji,
  description,
  entries,
  currentUserId,
  className,
}: {
  title: string;
  emoji: string;
  description: string;
  entries: LeaderboardEntry[];
  currentUserId: string;
  className?: string;
}) {
  return (
    <section
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 ${className ?? ''}`}
    >
      <header className="mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <span aria-hidden="true">{emoji}</span>
          {title}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {description}
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          Noch keine Daten — sobald Piloten der Airline Flüge einreichen,
          erscheint hier ein Ranking.
        </p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry, idx) => (
            <RankRow
              key={entry.pilot.id}
              rank={idx + 1}
              entry={entry}
              isMe={entry.pilot.id === currentUserId}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function RankRow({
  rank,
  entry,
  isMe,
}: {
  rank: number;
  entry: LeaderboardEntry;
  isMe: boolean;
}) {
  // Top 3 kriegen medaillen, top 10 normalen rank-zahl
  const medal =
    rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  return (
    <li>
      <Link
        href={`/pilots/${entry.pilot.id}`}
        className={`flex items-center gap-3 px-3 py-2 rounded transition ${
          isMe
            ? 'bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-300 dark:border-indigo-700/40 hover:bg-indigo-100 dark:hover:bg-indigo-950/60'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        {/* Rank/medal */}
        <span className="w-8 shrink-0 text-center text-sm font-mono text-gray-500 dark:text-gray-400 tabular-nums">
          {medal ?? `#${rank}`}
        </span>

        {/* Avatar */}
        {entry.pilot.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- internal user avatar
          <picture>
            <img
              src={entry.pilot.image}
              alt=""
              className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700 shrink-0"
            />
          </picture>
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
        )}

        {/* Name + rank */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {entry.pilot.name ?? 'Unbenannt'}
            {isMe && (
              <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-indigo-600 dark:text-indigo-400">
                Du
              </span>
            )}
          </p>
          {entry.pilot.rankName && (
            <p className="text-[10px] text-gray-500 dark:text-gray-500 truncate">
              {entry.pilot.rankName}
            </p>
          )}
        </div>

        {/* Value */}
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap">
          {entry.displayValue}
        </span>
      </Link>
    </li>
  );
}
