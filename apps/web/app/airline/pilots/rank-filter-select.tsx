'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface RankOption {
  id: string;
  name: string;
}

interface Props {
  currentRank: string | undefined;
  currentStatus: string | undefined;
  availableRanks: RankOption[];
}

/**
 * Client-side rank-filter for /airline/pilots (Welle 6 hotfix).
 *
 * Previously this lived inline in page.tsx as a `<form>` with
 * `<select onChange={(e) => e.currentTarget.form?.submit()}>`. That breaks
 * in Next.js 16 / React 19 RSC: server components cannot pass function
 * props to children, even to native HTML elements — the onChange handler
 * causes a render error. Extracted to a client component so the
 * onChange-handler can live on the client where it belongs.
 *
 * Behavior preserved 1:1: change the rank → router pushes a new URL with
 * `?rank=<id>` (or `?rank=NONE` for "no rank"), preserving the existing
 * `?status=` filter. Reset link clears just the rank param.
 *
 * Why useRouter().push instead of plain form-submit: a form-submit
 * triggers a full document navigation (no client-side cache), while
 * router.push keeps the SPA-like transition. Both work, but push is
 * snappier and consistent with the FilterTab Links above.
 */
export function RankFilterSelect({
  currentRank,
  currentStatus,
  availableRanks,
}: Props) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams();
    if (currentStatus) params.set('status', currentStatus);
    if (value) params.set('rank', value);
    const qs = params.toString();
    router.push(qs ? `/airline/pilots?${qs}` : '/airline/pilots');
  }

  // Reset URL: keeps status, drops rank.
  const resetParams = new URLSearchParams();
  if (currentStatus) resetParams.set('status', currentStatus);
  const resetQs = resetParams.toString();
  const resetHref = resetQs
    ? `/airline/pilots?${resetQs}`
    : '/airline/pilots';

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="rank-filter"
        className="text-xs text-gray-500 dark:text-gray-400"
      >
        Rang:
      </label>
      <select
        id="rank-filter"
        name="rank"
        value={currentRank ?? ''}
        onChange={handleChange}
        className="text-xs px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded focus:outline-none focus:border-indigo-500"
      >
        <option value="">Alle Ränge</option>
        <option value="NONE">— Kein Rang —</option>
        {availableRanks.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {currentRank && (
        <Link
          href={resetHref}
          className="text-xs text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition"
        >
          ✕ Zurücksetzen
        </Link>
      )}
    </div>
  );
}
