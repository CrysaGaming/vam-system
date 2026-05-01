'use client';

import { useState, useMemo } from 'react';

interface Airport {
  id: string;
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
  verified: boolean;
}

interface AirportBrowserProps {
  airports: Airport[];
}

type FilterMode = 'all' | 'verified' | 'unverified';

export function AirportBrowser({ airports }: AirportBrowserProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return airports.filter((a) => {
      if (filter === 'verified' && !a.verified) return false;
      if (filter === 'unverified' && a.verified) return false;
      if (!q) return true;
      return (
        a.icao.includes(q) ||
        (a.iata?.includes(q) ?? false) ||
        a.name.toUpperCase().includes(q) ||
        (a.city?.toUpperCase().includes(q) ?? false) ||
        a.country.toUpperCase().includes(q)
      );
    });
  }, [airports, query, filter]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="ICAO, IATA, Name, Stadt, Land…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[240px] px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700">
          {(['all', 'verified', 'unverified'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-4 py-2 text-sm transition ${
                filter === mode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {mode === 'all'
                ? `Alle (${airports.length})`
                : mode === 'verified'
                  ? '✓ Verified'
                  : '⚠ Unverified'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <p className="text-gray-500 dark:text-gray-400">
            Keine Airports gefunden. Vielleicht{' '}
            <a
              href="/airports/request"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              einen vorschlagen
            </a>
            ?
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800/50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">ICAO/IATA</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Land/Stadt</th>
                <th className="px-4 py-3 font-semibold">Position</th>
                <th className="px-4 py-3 font-semibold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {filtered.slice(0, 200).map((a) => (
                <tr
                  key={a.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/30"
                >
                  <td className="px-4 py-3 font-mono">
                    <div className="font-semibold">{a.icao}</div>
                    {a.iata && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {a.iata}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    <div>{a.country}</div>
                    {a.city && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {a.city}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {a.latitude.toFixed(3)}, {a.longitude.toFixed(3)}
                    {a.elevation != null && (
                      <div>{a.elevation} ft</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {a.verified ? (
                      <span
                        className="inline-block px-2 py-1 text-xs font-semibold rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                        title="Verified — Daten von System-Admin geprüft"
                      >
                        ✓ Verified
                      </span>
                    ) : (
                      <span
                        className="inline-block px-2 py-1 text-xs font-semibold rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                        title="Unverified — provisional, Daten noch nicht geprüft"
                      >
                        ⚠ Unverified
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-200 dark:border-gray-800">
              {filtered.length} matches — anzeige limitiert auf 200. Suche
              verfeinern.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
