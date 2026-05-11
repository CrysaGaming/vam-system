'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

/**
 * Track 4 #63 (Section L): Pilots-Roster mit Search-Filter.
 *
 * Client-component wrapper für die roster-tabelle. Server-page übergibt
 * die komplette pre-formatted pilots-liste als JSON-prop; wir machen
 * hier nur client-side substring-filter auf name.
 *
 * Filter-strategie:
 *   - Case-insensitive substring-match auf pilot.name
 *   - Empty query = alle anzeigen
 *   - useMemo für die filtered-list damit re-rendering bei jedem
 *     keystroke nicht das ganze pilots-array re-walked
 *
 * UX-details:
 *   - Search-input oben mit ⌘K-style placeholder + count-suffix
 *     "(N gefiltert)" damit user sieht ob filter aktiv ist
 *   - Sticky-position WÄRE NICE aber bei einer einzelnen-screen-tabelle
 *     ist's overkill; lassen wir's einfach am top
 *   - Empty-state bei 0 matches: subtiler hint mit "alle anzeigen"-link
 *   - Keine debounce nötig — pure client filter ist instant
 *
 * Performance: bei ~50-100 piloten ist linear-search trivial. Wenn die
 * roster mal in die thousands geht, würde man hier eine search-library
 * (fuzzy-match, MiniSearch) einsetzen. Für jetzt ausreichend.
 */
export interface PilotRowData {
  id: string;
  name: string | null;
  image: string | null;
  rankName: string | null;
  roleName: string | null;
  totalFlightHours: number;
  totalFlights: number;
  createdAt: string; // ISO-date string vom server (serialization-friendly)
  lastActiveLabel: string;
  lastActiveColor: string;
  lastActiveTimestamp: string | null; // ISO oder null
  isMe: boolean;
  medal: '🥇' | '🥈' | '🥉' | null;
}

export function PilotsRosterTable({ pilots }: { pilots: PilotRowData[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pilots;
    return pilots.filter((p) => (p.name ?? '').toLowerCase().includes(q));
  }, [query, pilots]);

  return (
    <div className="space-y-3">
      {/* Search-input — oben über der table. Auto-focus NICHT setzen
          weil bei deeplink/back-navigation der scroll-position springt;
          user fokussiert manuell durch klick. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pilot suchen…"
            className="w-full px-3 py-2 pl-9 pr-9 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded text-sm focus:outline-none focus:border-indigo-500 transition"
            aria-label="Piloten durchsuchen"
          />
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-600 pointer-events-none"
            aria-hidden="true"
          >
            🔎
          </span>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-1 transition"
              aria-label="Suche zurücksetzen"
            >
              ✕
            </button>
          )}
        </div>
        {query && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {filtered.length} von {pilots.length} gefiltert
          </p>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Kein Pilot mit Namen{' '}
              <span className="font-mono text-gray-700 dark:text-gray-300">
                &ldquo;{query}&rdquo;
              </span>{' '}
              gefunden.
            </p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Alle anzeigen
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800/50">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Pilot</th>
                <th className="px-4 py-3">Rang</th>
                <th className="px-4 py-3">Rolle</th>
                <th className="px-4 py-3 text-right">Stunden</th>
                <th className="px-4 py-3 text-right">Flüge</th>
                <th className="px-4 py-3 text-right">Letzter Flug</th>
                <th className="px-4 py-3 text-right">Beigetreten</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {filtered.map((pilot) => (
                <tr
                  key={pilot.id}
                  className={`group transition cursor-pointer ${
                    pilot.isMe
                      ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/pilots/${pilot.id}`}
                      className="flex items-center gap-3"
                    >
                      {pilot.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={pilot.image}
                          alt={pilot.name ?? 'Avatar'}
                          className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700" />
                      )}
                      <div>
                        <p className="font-semibold flex items-center gap-2">
                          {pilot.medal && <span>{pilot.medal}</span>}
                          {pilot.name ?? 'Unbenannt'}
                          {pilot.isMe && (
                            <span className="text-xs text-indigo-600 dark:text-indigo-400">
                              (Du)
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    <Link href={`/pilots/${pilot.id}`} className="block">
                      {pilot.rankName ?? '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    <Link href={`/pilots/${pilot.id}`} className="block">
                      {pilot.roleName ?? 'pilot'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/pilots/${pilot.id}`} className="block">
                      {pilot.totalFlightHours.toFixed(1)} h
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/pilots/${pilot.id}`} className="block">
                      {pilot.totalFlights}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    <Link
                      href={`/pilots/${pilot.id}`}
                      className={`block font-medium ${pilot.lastActiveColor}`}
                      title={
                        pilot.lastActiveTimestamp
                          ? new Date(pilot.lastActiveTimestamp).toLocaleString(
                              'de-DE',
                            )
                          : undefined
                      }
                    >
                      {pilot.lastActiveLabel}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                    <Link href={`/pilots/${pilot.id}`} className="block">
                      {new Date(pilot.createdAt).toLocaleDateString('de-DE', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
