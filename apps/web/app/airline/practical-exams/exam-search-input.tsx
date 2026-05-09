'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * Track 4 #42 (Section G): Search-input für die /airline/practical-exams
 * review-queue. Free-text-suche auf pilot-name (case-insensitive).
 *
 * Pattern spiegelt PersonnelSearchInput (#38):
 * - URL-state via ?q=...  (shareable, bookmarkbar)
 * - Debounce 300ms damit nicht jeder keystroke einen server-fetch macht
 * - Andere filter-params (license) bleiben erhalten via URLSearchParams-spread
 *
 * Filtering: server-side post-fetch (queue ist klein, max ~20 entries)
 * statt prisma-where weil der existing helper
 * `listEnrollmentsAwaitingPracticalReview` keine query-param nimmt.
 */
export function ExamSearchInput() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(() => searchParams.get('q') ?? '');
  const [, startTransition] = useTransition();

  useEffect(() => {
    setValue(searchParams.get('q') ?? '');
  }, [searchParams]);

  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (value === current) return;

    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set('q', value.trim());
      } else {
        params.delete('q');
      }
      const qs = params.toString();
      startTransition(() => {
        router.replace(
          qs ? `/airline/practical-exams?${qs}` : '/airline/practical-exams',
          { scroll: false },
        );
      });
    }, 300);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Pilot suchen…"
        className="w-56 sm:w-64 pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 transition"
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
