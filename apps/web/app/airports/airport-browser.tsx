'use client';

import { useState, useTransition, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';

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
  type: string | null;
  continent: string | null;
  scheduledService: boolean;
}

interface AirportBrowserProps {
  airports: Airport[];
  totalMatching: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  filters: {
    types: readonly string[];
    continent: string | null;
    country: string | null;
    scheduledOnly: boolean;
    query: string;
  };
  isDefaultState: boolean;
}

const TYPE_OPTIONS = [
  { value: 'large_airport', label: 'Large', emoji: '🛬' },
  { value: 'medium_airport', label: 'Medium', emoji: '✈️' },
  { value: 'small_airport', label: 'Small', emoji: '🛩' },
  { value: 'heliport', label: 'Heliport', emoji: '🚁' },
  { value: 'seaplane_base', label: 'Seaplane', emoji: '🛟' },
  { value: 'balloonport', label: 'Balloon', emoji: '🎈' },
  { value: 'closed', label: 'Closed', emoji: '🚫' },
] as const;

const CONTINENT_OPTIONS = [
  { value: '', label: 'Alle Kontinente' },
  { value: 'EU', label: '🇪🇺 Europa' },
  { value: 'NA', label: '🌎 Nordamerika' },
  { value: 'SA', label: '🌎 Südamerika' },
  { value: 'AS', label: '🌏 Asien' },
  { value: 'AF', label: '🌍 Afrika' },
  { value: 'OC', label: '🌏 Ozeanien' },
  { value: 'AN', label: '🇦🇶 Antarktis' },
] as const;

/**
 * AirportBrowser — client-component für filter-UI + table-render.
 *
 * State-management: Alle filter werden via URL-searchParams gesteuert.
 * Lokaler state nur für den search-input (live-debounced auf 300ms damit
 * nicht jeder keystroke einen server-roundtrip feuert) und country-input
 * (commit on blur/Enter).
 *
 * Live-search-pattern: queryInput ist local truth während getippt wird,
 * filters.query ist URL truth. Wenn die zwei divergieren startet ein
 * 300ms-timer der updateFilter() callt; jeder weitere keystroke clearet
 * den alten timer. Enter-key überspringt den debounce für instant-feuer.
 *
 * UX: useTransition() macht filter-changes nicht-blockierend — der ui
 * markiert sich als "pending" während der server die neue page liefert,
 * statt den ganzen browser-tab einzufrieren.
 */
export function AirportBrowser({
  airports,
  totalMatching,
  currentPage,
  totalPages,
  pageSize,
  filters,
  isDefaultState,
}: AirportBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state für inputs die debounced werden — beim direkten URL-update
  // würde der user bei jedem keystroke ein query feuern.
  const [queryInput, setQueryInput] = useState(filters.query);
  const [countryInput, setCountryInput] = useState(filters.country ?? '');

  // Debounce-timer ref: behalten zwischen renders damit Enter-key den
  // pending timer cancelen kann bevor er sein eigenes update feuert.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ───── Filter update helpers ─────
  // Update einer einzelnen filter-dimension: cloned aktuelle searchParams,
  // setzt den neuen wert (oder löscht ihn falls null/leer), resettet page=1
  // damit nicht plötzlich auf einer leeren page landet.
  const updateFilter = useCallback(
    (key: string, value: string | null) => {
      const newParams = new URLSearchParams(searchParams.toString());
      if (value === null || value === '') {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
      // Reset page bei filter-change (außer explicit page-update)
      if (key !== 'page') {
        newParams.delete('page');
      }
      const queryString = newParams.toString();
      startTransition(() => {
        router.push(queryString ? `${pathname}?${queryString}` : pathname);
      });
    },
    [pathname, router, searchParams],
  );

  const toggleType = (type: string) => {
    const current = new Set(filters.types);
    if (current.has(type)) {
      current.delete(type);
    } else {
      current.add(type);
    }
    const newValue = Array.from(current).join(',');
    updateFilter('type', newValue || null);
  };

  // ───── Live-search-debounce ─────
  // Wenn queryInput von filters.query divergiert, startet ein 300ms-timer
  // der updateFilter('q', ...) feuert. Jeder weitere keystroke clearet den
  // timer und startet neu. Cleanup-funktion clearet bei unmount + bei jedem
  // re-render der zur dependency-änderung führte. Comparison verhindert eine
  // endlosschleife wenn der server filter.query gleich queryInput ist.
  useEffect(() => {
    const trimmed = queryInput.trim();
    if (trimmed === filters.query) return;

    debounceTimerRef.current = setTimeout(() => {
      updateFilter('q', trimmed || null);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [queryInput, filters.query, updateFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter-key: pending debounce abbrechen, sofort feuern.
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    updateFilter('q', queryInput.trim() || null);
  };

  const handleCountryBlur = () => {
    const cleaned = countryInput.trim().toUpperCase().slice(0, 2);
    if (cleaned !== filters.country) {
      updateFilter('country', cleaned || null);
    }
  };

  const resetAll = () => {
    startTransition(() => {
      router.push(pathname);
    });
    setQueryInput('');
    setCountryInput('');
  };

  return (
    <div className={isPending ? 'opacity-60 transition-opacity' : ''}>
      {/* ───── Filter Controls ───── */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 mb-4 space-y-4">
        {/* Row 1: Search + reset.
            Live-search via debounce-effect oben — kein expliziter Suchen-
            button mehr. Form bleibt nur damit Enter-key den debounce
            überspringen und sofort feuern kann. */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="ICAO, IATA, Name oder Stadt — automatisch beim Tippen…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {!isDefaultState && (
            <button
              type="button"
              onClick={resetAll}
              className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              Zurücksetzen
            </button>
          )}
        </form>

        {/* Row 2: Type chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-2">
            Typ
          </span>
          {TYPE_OPTIONS.map((opt) => {
            const isSelected = filters.types.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleType(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  isSelected
                    ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-200'
                    : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span className="mr-1">{opt.emoji}</span>
                {opt.label}
              </button>
            );
          })}
          {isDefaultState && (
            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 italic">
              Default: Large + Medium · Klick zum Anpassen
            </span>
          )}
        </div>

        {/* Row 3: Continent + Country + scheduled-toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Region
            </span>
            <select
              value={filters.continent ?? ''}
              onChange={(e) => updateFilter('continent', e.target.value || null)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {CONTINENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Land
            </span>
            <input
              type="text"
              placeholder="DE, US, FR…"
              maxLength={2}
              value={countryInput}
              onChange={(e) => setCountryInput(e.target.value.toUpperCase())}
              onBlur={handleCountryBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCountryBlur();
              }}
              className="w-20 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={filters.scheduledOnly}
              onChange={(e) =>
                updateFilter('scheduled', e.target.checked ? 'true' : 'false')
              }
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Nur Linienflug-Airports
            </span>
          </label>
        </div>
      </div>

      {/* ───── Result Table ───── */}
      {airports.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
          <p className="text-gray-500 dark:text-gray-400">
            Keine Airports gefunden. Filter anpassen oder{' '}
            <a
              href="/airports/request"
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              einen vorschlagen
            </a>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold">ICAO/IATA</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Land/Stadt</th>
                  <th className="px-4 py-3 font-semibold">Typ</th>
                  <th className="px-4 py-3 font-semibold">Position</th>
                  <th className="px-4 py-3 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {airports.map((a) => {
                  // Whole-row-as-link pattern: jede `<td>` enthält einen `<Link>`
                  // mit `display: block` der die ganze cell ausfüllt. Padding
                  // wandert vom td zum Link damit kein toter rand bleibt. Right-
                  // click + middle-click + cmd-click funktionieren wie erwartet
                  // (im gegensatz zu `<tr onClick>` mit useRouter.push). Pro row
                  // gibt's 6 Link-instanzen aber alle mit identischer href —
                  // Next.js prefetched die url nur einmal.
                  const detailHref = `/airports/${a.icao}`;
                  const cellLinkBase =
                    'block px-4 py-3 transition-colors';

                  return (
                    <tr
                      key={a.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/30"
                    >
                      <td className="font-mono">
                        <Link
                          href={detailHref}
                          className={`${cellLinkBase} group-hover:text-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400`}
                        >
                          <div className="font-semibold">{a.icao}</div>
                          {a.iata && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {a.iata}
                            </div>
                          )}
                        </Link>
                      </td>
                      <td className="font-medium">
                        <Link
                          href={detailHref}
                          className={`${cellLinkBase} hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline`}
                        >
                          {a.name}
                        </Link>
                      </td>
                      <td className="text-gray-600 dark:text-gray-300">
                        <Link href={detailHref} className={cellLinkBase}>
                          <div className="font-mono text-xs">{a.country}</div>
                          {a.city && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {a.city}
                            </div>
                          )}
                        </Link>
                      </td>
                      <td>
                        <Link href={detailHref} className={cellLinkBase}>
                          {a.type && (
                            <span
                              className="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                              title={`OurAirports type: ${a.type}`}
                            >
                              {TYPE_OPTIONS.find((t) => t.value === a.type)
                                ?.emoji ?? ''}{' '}
                              {a.type
                                .replace(/_airport$/, '')
                                .replace(/_/g, ' ')}
                            </span>
                          )}
                          {a.scheduledService && (
                            <span
                              className="ml-1 text-xs text-emerald-600 dark:text-emerald-400"
                              title="Bietet regulären Linienflug-Verkehr"
                            >
                              ✈
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        <Link href={detailHref} className={cellLinkBase}>
                          {a.latitude.toFixed(3)}, {a.longitude.toFixed(3)}
                          {a.elevation != null && <div>{a.elevation} ft</div>}
                        </Link>
                      </td>
                      <td className="text-center">
                        <Link
                          href={detailHref}
                          className={`${cellLinkBase} flex justify-center items-center`}
                        >
                          {a.verified ? (
                            <span
                              className="inline-block px-2 py-1 text-xs font-semibold rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                              title="Verified — Daten von System-Admin geprüft"
                            >
                              ✓
                            </span>
                          ) : (
                            <span
                              className="inline-block px-2 py-1 text-xs font-semibold rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300"
                              title="Unverified — provisional, Daten noch nicht geprüft"
                            >
                              ⚠
                            </span>
                          )}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ───── Pagination ───── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-2 text-sm text-gray-600 dark:text-gray-300">
              <div>
                Seite {currentPage} von {totalPages.toLocaleString('de')} · Zeige{' '}
                {(currentPage - 1) * pageSize + 1}–
                {Math.min(currentPage * pageSize, totalMatching)} von{' '}
                {totalMatching.toLocaleString('de')}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1 || isPending}
                  onClick={() => updateFilter('page', '1')}
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  ⏮ Erste
                </button>
                <button
                  type="button"
                  disabled={currentPage <= 1 || isPending}
                  onClick={() =>
                    updateFilter('page', String(Math.max(1, currentPage - 1)))
                  }
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  ← Zurück
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages || isPending}
                  onClick={() =>
                    updateFilter(
                      'page',
                      String(Math.min(totalPages, currentPage + 1)),
                    )
                  }
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Weiter →
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages || isPending}
                  onClick={() => updateFilter('page', String(totalPages))}
                  className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Letzte ⏭
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
