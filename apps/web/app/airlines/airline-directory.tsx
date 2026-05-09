'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

/**
 * Track 4 #35 (Section G): Client-side directory mit search + sort.
 *
 * Vorher war /airlines ein pure server-render mit grid-cards alphabetisch.
 * Skaliert OK bis ~50 airlines, danach wird die scroll-suche mühsam. Statt
 * server-side filtering (kostet round-trip + URL-state) machen wir's client-
 * side: alle airlines kommen sowieso schon im initial-payload mit (≤ 5kb
 * für 100 airlines), und der filter feels-instant.
 *
 * Sort-Optionen:
 *   - name (default, alphabetisch) — wie die alte server-default-order
 *   - hubs (deszendierend) — größte airlines zuerst
 *   - aircraft (deszendierend) — flotten-größe als proxy für aktivität
 *
 * Search filtert über icao, iata, name und tagline (case-insensitive). Der
 * tagline-match ist der subtilste — manche airlines haben charakteristische
 * tag-lines wie "Cargo only" oder "Vintage props", da kann der user auch
 * danach suchen ohne den genauen namen zu kennen.
 */
type Airline = {
  id: string;
  icao: string;
  iata: string | null;
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  primaryColor: string | null;
  _count: { hubs: number; aircraft: number };
};

type SortMode = 'name' | 'hubs' | 'aircraft';

export function AirlineDirectory({ airlines }: { airlines: Airline[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('name');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = airlines;
    if (q) {
      list = airlines.filter(
        (a) =>
          a.icao.toLowerCase().includes(q) ||
          (a.iata?.toLowerCase().includes(q) ?? false) ||
          a.name.toLowerCase().includes(q) ||
          (a.tagline?.toLowerCase().includes(q) ?? false),
      );
    }
    // Sort: NICHT in-place, sonst mutiert der prop. Slice erst, dann sort.
    const sorted = list.slice();
    if (sort === 'hubs') {
      sorted.sort((a, b) => b._count.hubs - a._count.hubs || a.name.localeCompare(b.name));
    } else if (sort === 'aircraft') {
      sorted.sort(
        (a, b) => b._count.aircraft - a._count.aircraft || a.name.localeCompare(b.name),
      );
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [airlines, query, sort]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="ICAO, IATA, Name oder Tagline…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[240px] px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
          aria-label="Airlines durchsuchen"
        />
        <div
          className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700"
          role="group"
          aria-label="Sortierung"
        >
          {(
            [
              { mode: 'name' as const, label: 'A–Z' },
              { mode: 'hubs' as const, label: 'Hubs' },
              { mode: 'aircraft' as const, label: 'Aircraft' },
            ]
          ).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setSort(mode)}
              className={`px-4 py-2 text-sm transition ${
                sort === mode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              aria-pressed={sort === mode}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Keine airlines mit „{query}" gefunden.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {filtered.length} von {airlines.length} airlines
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((a) => {
              const accent = a.primaryColor ?? '#4F46E5';
              return (
                <li key={a.id}>
                  <Link
                    href={`/a/${a.icao}`}
                    className="block h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:shadow-md transition overflow-hidden"
                  >
                    <div className="flex h-full">
                      <div
                        className="w-1 flex-shrink-0"
                        style={{ backgroundColor: accent }}
                        aria-hidden="true"
                      />
                      <div className="flex-1 p-4 flex flex-col gap-3">
                        <div className="flex items-start gap-3">
                          {a.logoUrl ? (
                            <picture>
                              <img
                                src={a.logoUrl}
                                alt={`${a.name} Logo`}
                                className="h-12 w-12 rounded object-contain bg-gray-100 dark:bg-gray-800 p-1 flex-shrink-0"
                              />
                            </picture>
                          ) : (
                            <div
                              className="h-12 w-12 rounded flex items-center justify-center text-xs font-bold tracking-tight text-white flex-shrink-0"
                              style={{ backgroundColor: accent }}
                            >
                              {a.icao}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-base truncate">
                              {a.name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                              <span className="font-mono uppercase">
                                {a.icao}
                              </span>
                              {a.iata && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono uppercase">
                                    {a.iata}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {a.tagline && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                            {a.tagline}
                          </p>
                        )}

                        <div className="mt-auto pt-2 flex items-center gap-4 text-[11px] text-gray-500 dark:text-gray-400">
                          <span>
                            <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-300">
                              {a._count.hubs}
                            </span>{' '}
                            {a._count.hubs === 1 ? 'Hub' : 'Hubs'}
                          </span>
                          <span>
                            <span className="tabular-nums font-semibold text-gray-700 dark:text-gray-300">
                              {a._count.aircraft}
                            </span>{' '}
                            Aircraft
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
