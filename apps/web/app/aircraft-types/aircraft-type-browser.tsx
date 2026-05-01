'use client';

import { useState, useMemo } from 'react';

interface AircraftType {
  id: string;
  icaoType: string;
  name: string;
  manufacturer: string;
  category: string;
  rangeNm: number;
  capacityPax: number;
  cruiseSpeedKt: number;
  fuelBurnKgH: number;
  verified: boolean;
}

interface AircraftTypeBrowserProps {
  types: AircraftType[];
}

type FilterMode = 'all' | 'verified' | 'unverified';
type CategoryFilter = 'all' | string;

const CATEGORY_LABELS: Record<string, string> = {
  narrow_body: 'Narrow-Body',
  wide_body: 'Wide-Body',
  regional: 'Regional',
  cargo: 'Cargo',
  ga: 'General Aviation',
};

export function AircraftTypeBrowser({ types }: AircraftTypeBrowserProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');

  // Distinct categories present in data — drives the category dropdown so we
  // don't show empty filters when seed lacks a category.
  const categories = useMemo(() => {
    const set = new Set(types.map((t) => t.category));
    return Array.from(set).sort();
  }, [types]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return types.filter((t) => {
      if (filter === 'verified' && !t.verified) return false;
      if (filter === 'unverified' && t.verified) return false;
      if (category !== 'all' && t.category !== category) return false;
      if (!q) return true;
      return (
        t.icaoType.includes(q) ||
        t.name.toUpperCase().includes(q) ||
        t.manufacturer.toUpperCase().includes(q)
      );
    });
  }, [types, query, filter, category]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="ICAO-Type, Name, Hersteller…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[240px] px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">Alle Kategorien</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c] ?? c}
            </option>
          ))}
        </select>
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
                ? `Alle (${types.length})`
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
            Keine Aircraft-Types gefunden. Vielleicht{' '}
            <a
              href="/aircraft-types/request"
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
                <th className="px-4 py-3 font-semibold">ICAO</th>
                <th className="px-4 py-3 font-semibold">Hersteller / Model</th>
                <th className="px-4 py-3 font-semibold">Kategorie</th>
                <th className="px-4 py-3 font-semibold text-right">Range</th>
                <th className="px-4 py-3 font-semibold text-right">Pax</th>
                <th className="px-4 py-3 font-semibold text-right">Speed</th>
                <th className="px-4 py-3 font-semibold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {filtered.slice(0, 200).map((t) => (
                <tr
                  key={t.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/30"
                >
                  <td className="px-4 py-3 font-mono font-semibold">
                    {t.icaoType}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.manufacturer}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 text-xs">
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {t.rangeNm.toLocaleString()} nm
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {t.capacityPax}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {t.cruiseSpeedKt} kt
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.verified ? (
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
