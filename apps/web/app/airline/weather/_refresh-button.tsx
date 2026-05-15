'use client';

/**
 * Welle P / P1 — Per-row force-refresh button. Calls the server
 * action and refreshes the page-level data so the manager sees the
 * updated METAR without a full reload.
 *
 * Lives in a tiny client-island next to the row so the rest of the
 * page can stay a server component (most rows don't need interactivity).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refreshAirportWeather } from './actions';

export function RefreshButton({ icao }: { icao: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await refreshAirportWeather(icao);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded border border-border bg-background px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
        title={`Force-refresh METAR für ${icao}`}
      >
        {isPending ? '⏳ …' : '↻ Refresh'}
      </button>
      {error && (
        <span
          className="text-[10px] text-rose-600 dark:text-rose-400"
          title={error}
        >
          ⚠ {error.length > 30 ? `${error.slice(0, 27)}…` : error}
        </span>
      )}
    </div>
  );
}
