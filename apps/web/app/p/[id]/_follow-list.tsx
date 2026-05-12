/**
 * Track 5 #13 (Section C) — Geteilte FollowList-Komponente.
 *
 * Wird von /p/[id]/followers und /p/[id]/following genutzt. Server-
 * component (kein client-state nötig — pure rendering der vorgeladenen
 * entries).
 *
 * Underscore-prefix im filename macht das ein "private" segment in
 * Next.js's app-router — wird NICHT als route exposed.
 */

import Link from 'next/link';
import type { FollowListEntry } from '@vam/db';

export function FollowList({
  profileId,
  profileName,
  mode,
  entries,
}: {
  profileId: string;
  profileName: string | null;
  mode: 'followers' | 'following';
  entries: FollowListEntry[];
}) {
  const label = mode === 'followers' ? 'Follower' : 'Folgt';
  const heading =
    mode === 'followers'
      ? `Follower von ${profileName ?? 'Unbenannt'}`
      : `${profileName ?? 'Unbenannt'} folgt`;
  const emptyText =
    mode === 'followers'
      ? 'Noch keine Follower.'
      : 'Folgt noch niemandem.';

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto">
        <header className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-800">
          <Link
            href={`/p/${profileId}`}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition"
          >
            ← Zurück zum Profil
          </Link>
          <h1 className="text-2xl font-bold mt-2">{heading}</h1>
          <p className="text-xs text-gray-500 mt-1">
            {entries.length}{' '}
            {entries.length === 1 ? label.replace('en', '') : label}
          </p>
        </header>

        {entries.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
            <p className="text-sm text-gray-500">{emptyText}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((u) => (
              <li key={u.id}>
                <FollowEntryCard entry={u} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function FollowEntryCard({ entry }: { entry: FollowListEntry }) {
  // Wenn der user sein public-profile abgeschaltet hat seit dem follow:
  // wir zeigen ihn weiterhin in der liste (das follow-record existiert),
  // aber der name-link führt zu einer 404. Privacy-balanced: count
  // bleibt aktuell, aber er ist nicht mehr "klickbar".
  const linkable = entry.isProfilePublic;

  const inner = (
    <div className="flex items-center gap-3">
      {entry.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <picture>
          <img
            src={entry.image}
            alt=""
            className="w-10 h-10 rounded-full border border-gray-200 dark:border-gray-700 shrink-0"
          />
        </picture>
      ) : (
        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">
          {entry.name ?? 'Unbenannt'}
          {!linkable && (
            <span className="ml-2 text-[10px] text-gray-400 font-normal">
              (Profil privat)
            </span>
          )}
        </p>
        <div className="text-xs text-gray-500 flex items-baseline gap-2 flex-wrap">
          {entry.rankName && <span>{entry.rankName}</span>}
          {entry.airlineIcao && (
            <span className="font-mono">
              {entry.airlineIcao} {entry.airlineName}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  if (linkable) {
    return (
      <Link
        href={`/p/${entry.id}`}
        className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 hover:border-indigo-300 dark:hover:border-indigo-700 transition"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 opacity-60">
      {inner}
    </div>
  );
}
