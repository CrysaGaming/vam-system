'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

/**
 * Admin /admin/pilots client-component. Reine read-only UI mit clientside
 * filter/sort/pagination — keine server-actions weil alle write-flows
 * für cross-airline operations (delete user, force-airline-change, etc.)
 * zu kritisch sind und ein eigenes design-review verdienen.
 *
 * Pattern-parallel zu airline/member-table.tsx — search, sort-toggle,
 * pagination kommen aus dem gleichen mental model. Unterschiede:
 *   - Hier: cross-airline scope → braucht airline-filter
 *   - Hier: keine bulk-checkbox-spalte (intentional, siehe oben)
 *   - Hier: Stats-aggregation (airlineCount, noAirlineCount) bleibt im
 *     parent server-component weil's vor-filter-stats sind
 *
 * Performance-anmerkung: filter/sort/pagination sind alle clientside.
 * Bei 500+ users würde der initial-data-payload + clientside-arbeit
 * spürbar — dann muss zu serverside-pagination mit URL-search-params
 * migriert werden (Next.js searchParams pattern). Bei aktuellem stand
 * (~handvoll users) ist clientside einfacher und schnell genug.
 */

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  totalFlightHours: number;
  totalFlights: number;
  createdAt: Date;
  rank: { name: string } | null;
  role: { name: string } | null;
  airline: { id: string; name: string; icao: string } | null;
}

interface Props {
  users: AdminUser[];
  /**
   * Distinct airlines die in der user-liste vorkommen — für den airline-
   * filter-dropdown. Wird im server-component aus den users-results
   * abgeleitet damit der dropdown nur airlines zeigt die auch tatsächlich
   * piloten haben (statt allen system-airlines).
   */
  availableAirlines: Array<{ id: string; name: string; icao: string }>;
  /**
   * Distinct rollen die in der user-liste vorkommen. Analog
   * availableAirlines — nur rollen die mind. 1x zugewiesen sind.
   */
  availableRoles: Array<{ name: string }>;
  currentUserId: string;
}

type SortKey = 'name' | 'airline' | 'hours' | 'flights' | 'created';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

/**
 * Special filter-values für die dropdowns. Empty string = "alle" (no
 * filter applied). `__none__` = explicit "kein wert gesetzt" (user ohne
 * airline / user ohne rolle). Wir verwenden eine sentinel-string statt
 * null/undefined damit native <select> das mit value="..." matchen kann.
 */
const FILTER_NONE = '__none__';

export function AdminPilotsTable({
  users,
  availableAirlines,
  availableRoles,
  currentUserId,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [airlineFilter, setAirlineFilter] = useState<string>(''); // '' = alle, FILTER_NONE = ohne airline, sonst airline.id
  const [roleFilter, setRoleFilter] = useState<string>(''); // '' = alle, FILTER_NONE = ohne rolle, sonst role.name

  const [sortKey, setSortKey] = useState<SortKey>('hours');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pagination — page-index 0-based intern, 1-based in der UI angezeigt
  const [page, setPage] = useState(0);

  // Filtered + sorted view. useMemo damit nicht bei jedem state-change
  // (z.B. page-toggle) die filter neu durchlaufen — nur wenn die inputs
  // (search/airline/role/sort) sich ändern.
  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let arr = users;

    // Suchfeld — über name + email. Lowercase einmal beim filtern.
    if (q) {
      arr = arr.filter((u) => {
        const name = (u.name ?? '').toLowerCase();
        const email = u.email.toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    // Airline-filter
    if (airlineFilter === FILTER_NONE) {
      arr = arr.filter((u) => u.airline === null);
    } else if (airlineFilter !== '') {
      arr = arr.filter((u) => u.airline?.id === airlineFilter);
    }

    // Rolle-filter
    if (roleFilter === FILTER_NONE) {
      arr = arr.filter((u) => u.role === null);
    } else if (roleFilter !== '') {
      arr = arr.filter((u) => u.role?.name === roleFilter);
    }

    // Stable copy vor sort, damit das original (props.users) nicht
    // mutiert wird. Ohne den copy würde React's reconciler unhappy.
    const sorted = [...arr].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = (a.name ?? '').localeCompare(b.name ?? '');
          break;
        case 'airline':
          // null-airlines ans ende der ascending sortierung. Falls
          // beide null, fall through zu cmp=0 (stable sort).
          cmp = (a.airline?.name ?? '\uFFFF').localeCompare(
            b.airline?.name ?? '\uFFFF',
          );
          break;
        case 'hours':
          cmp = a.totalFlightHours - b.totalFlightHours;
          break;
        case 'flights':
          cmp = a.totalFlights - b.totalFlights;
          break;
        case 'created':
          cmp = a.createdAt.getTime() - b.createdAt.getTime();
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [users, searchQuery, airlineFilter, roleFilter, sortKey, sortDir]);

  // Pagination derived state. Reset page wenn sich filtered-list ändert
  // (sonst landet man auf seite 5 mit nur 2 ergebnissen). useMemo macht
  // hier keinen sinn — das ist arithmetik, kein expensive computation.
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filteredAndSorted.length);
  const pageRows = filteredAndSorted.slice(pageStart, pageEnd);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Strings asc, numbers/dates desc — natural defaults
      setSortDir(key === 'name' || key === 'airline' ? 'asc' : 'desc');
    }
    setPage(0); // Reset auf erste seite bei sort-change
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <span className="opacity-30">↕</span>;
    return (
      <span className="text-indigo-500 dark:text-indigo-400">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );
  }

  // Reset-helper — ein klick statt 4 separate setStates
  function resetFilters() {
    setSearchQuery('');
    setAirlineFilter('');
    setRoleFilter('');
    setPage(0);
  }

  const hasActiveFilters =
    searchQuery !== '' || airlineFilter !== '' || roleFilter !== '';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* Filter-bar — sticky-feel nicht nötig, die tabelle hat ihren
          eigenen scroll-container. Wrap auf flex-wrap für schmale viewports. */}
      <div className="border-b border-gray-200 dark:border-gray-800 p-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Suche (Name, Email)…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(0);
          }}
          className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none w-64"
        />

        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Airline:</span>
          <select
            value={airlineFilter}
            onChange={(e) => {
              setAirlineFilter(e.target.value);
              setPage(0);
            }}
            className="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          >
            <option value="">Alle</option>
            <option value={FILTER_NONE}>— ohne Airline —</option>
            {availableAirlines.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icao} {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Rolle:</span>
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(0);
            }}
            className="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          >
            <option value="">Alle</option>
            <option value={FILTER_NONE}>— ohne Rolle —</option>
            {availableRoles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded transition"
          >
            Filter zurücksetzen
          </button>
        )}

        {/* Result-counter rechts. Zeigt die filter-wirkung sofort. */}
        <span className="ml-auto text-xs text-gray-500">
          {filteredAndSorted.length === users.length
            ? `${users.length} ${users.length === 1 ? 'User' : 'User'}`
            : `${filteredAndSorted.length} von ${users.length}`}
        </span>
      </div>

      {filteredAndSorted.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {hasActiveFilters
              ? 'Keine Treffer für die aktuellen Filter.'
              : 'Noch keine User registriert.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('name')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                    >
                      Pilot {sortIcon('name')}
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleSort('airline')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition flex items-center gap-1 uppercase tracking-wider"
                    >
                      Airline {sortIcon('airline')}
                    </button>
                  </th>
                  <th className="px-4 py-3">Rang</th>
                  <th className="px-4 py-3">Rolle</th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('hours')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 uppercase tracking-wider"
                    >
                      Stunden {sortIcon('hours')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('flights')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 uppercase tracking-wider"
                    >
                      Flüge {sortIcon('flights')}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('created')}
                      className="hover:text-gray-700 dark:hover:text-gray-300 transition inline-flex items-center gap-1 uppercase tracking-wider"
                    >
                      Registriert {sortIcon('created')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {pageRows.map((user) => {
                  const isMe = user.id === currentUserId;
                  return (
                    <tr
                      key={user.id}
                      className={`group transition cursor-pointer ${
                        isMe
                          ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }`}
                    >
                      <td className="px-4 py-3">
                        {/* Detail-link auf /pilots/[id] — selbe rationale
                            wie im RSC-comment der page.tsx. */}
                        <Link
                          href={`/pilots/${user.id}`}
                          className="flex items-center gap-3"
                        >
                          {user.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={user.image}
                              alt={user.name ?? 'Avatar'}
                              className="w-8 h-8 rounded-full border border-gray-300 dark:border-gray-700"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700" />
                          )}
                          <div>
                            <p className="font-semibold flex items-center gap-2">
                              {user.name ?? 'Unbenannt'}
                              {isMe && (
                                <span className="text-xs text-indigo-600 dark:text-indigo-400">
                                  (Du)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-500 truncate max-w-[14rem]">
                              {user.email}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {user.airline ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {user.airline.icao}
                            </span>
                            <span className="text-gray-700 dark:text-gray-300 truncate max-w-[12rem]">
                              {user.airline.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-gray-400 dark:text-gray-600">
                            keine
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {user.rank?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        {user.role?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {user.totalFlightHours.toFixed(1)} h
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {user.totalFlights}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                        {new Date(user.createdAt).toLocaleDateString('de-DE', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination-bar — nur sichtbar wenn mehr als 1 page nötig ist.
              Layout: links die page-info ("Seite 1 von 3 · Zeilen 1–25 von 67"),
              rechts die navigation-buttons. */}
          {totalPages > 1 && (
            <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between flex-wrap gap-3 text-sm">
              <span className="text-gray-500 dark:text-gray-400 text-xs">
                Seite {safePage + 1} von {totalPages} · Zeilen {pageStart + 1}–
                {pageEnd} von {filteredAndSorted.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(0)}
                  disabled={safePage === 0}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Erste Seite"
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  ← Zurück
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  Vor →
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages - 1)}
                  disabled={safePage >= totalPages - 1}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition"
                  aria-label="Letzte Seite"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
