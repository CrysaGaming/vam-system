'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * Track 4 #38 (Section G): Search-input für die /airline/pilots-page.
 *
 * Free-text-suche auf name + email mit URL-state (?q=...) damit suchen
 * shareable + bookmarkbar sind. Pattern spiegelt RankFilterSelect:
 * - Initial-value aus URL-search-params
 * - On-change: URL update via router.push, debounced 300ms damit nicht
 *   jeder keystroke einen server-roundtrip triggert
 * - Andere filter-params (status, rank) bleiben erhalten via spread
 *
 * Server-rendering: die Page liest searchParams.q, gibt es an
 * listPersonnel({ query }) und filtert über Prisma OR contains-search.
 *
 * Why nicht client-side filter wie #35 (airlines)?
 * - PersonnelTable hat schon URL-state für status/rank, konsistent bleiben
 * - Pilots-rows enthalten Server-Components (RankDropdown, EmploymentStatus
 *   Toggle) — diese würden bei client-filter nicht ausreichend sauber
 *   re-rendern
 * - Server-side ist bei <1000 piloten genauso schnell wie client und
 *   spart bandwidth
 */
export function PersonnelSearchInput() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(() => searchParams.get('q') ?? '');
  const [, startTransition] = useTransition();

  // Sync local-state wenn user via back-button oder anderem flow zur
  // page kommt mit neuer ?q= URL — sonst stale.
  useEffect(() => {
    setValue(searchParams.get('q') ?? '');
  }, [searchParams]);

  // Debounce: 300ms ohne tipp-pause → URL update + server-fetch.
  // setTimeout-handle in useEffect cleanup damit jeder keystroke den
  // pending timer abräumt.
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (value === current) return; // Kein update nötig

    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set('q', value.trim());
      } else {
        params.delete('q');
      }
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `/airline/pilots?${qs}` : '/airline/pilots', {
          scroll: false,
        });
      });
    }, 300);

    return () => clearTimeout(handle);
    // searchParams bewusst NICHT in deps — sonst würde der debounce
    // bei jedem URL-change resetten was zu unendlich-loop führen kann
    // beim eigenen replace-call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Pilot suchen (Name oder Email)…"
        className="w-64 sm:w-80 pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 transition"
        aria-label="Pilot suchen"
      />
      <span
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-600 text-sm pointer-events-none"
      >
        🔍
      </span>
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-xs text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition"
          aria-label="Suche zurücksetzen"
          title="Suche zurücksetzen"
        >
          ✕
        </button>
      )}
    </div>
  );
}
