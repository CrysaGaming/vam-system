'use client';

/**
 * Welle M / M5 — Admin VAMSE controls (ticker + recalculate).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setVamseTickerAction,
  recalculateVamsePriceAction,
} from './actions';

export function TickerSetForm({
  currentTicker,
}: {
  currentTicker: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [ticker, setTicker] = useState(currentTicker ?? '');
  const [msg, setMsg] = useState<string | null>(null);

  function submit() {
    setMsg(null);
    startTransition(async () => {
      const res = await setVamseTickerAction({ tickerSymbol: ticker });
      if (res.ok) {
        setMsg(res.message ?? 'OK');
        router.refresh();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {currentTicker ? 'Ticker ändern' : 'Stock initialisieren'}
      </h3>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="z.B. LH"
          className="w-32 rounded-md border border-border bg-background px-3 py-2 font-mono text-lg font-bold tabular-nums focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <button
          type="button"
          onClick={submit}
          disabled={isPending || ticker.length < 2}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? '…' : currentTicker ? 'Aktualisieren' : 'Initialisieren'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

export function RecalculatePriceButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function recalc() {
    setMsg(null);
    startTransition(async () => {
      const res = await recalculateVamsePriceAction();
      if (res.ok) {
        setMsg(res.message ?? 'OK');
        router.refresh();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={recalc}
        disabled={isPending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending ? 'Berechne…' : '🔄 Preis neu berechnen'}
      </button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
