'use client';

/**
 * Welle M / M5 — Pilot VAMSE trade form (buy/sell).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buyVamseSharesAction, sellVamseSharesAction } from './actions';

export default function TradeForm({
  stockId,
  ticker,
  currentPrice,
  availableShares,
  myShares,
}: {
  stockId: string;
  ticker: string;
  currentPrice: number;
  availableShares: number;
  myShares: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [sharesText, setSharesText] = useState('1');
  const [msg, setMsg] = useState<string | null>(null);

  const shares = parseInt(sharesText, 10) || 0;
  const total = (shares * currentPrice).toFixed(2);

  function submit() {
    setMsg(null);
    if (shares < 1) {
      setMsg('Mindestens 1 share.');
      return;
    }
    startTransition(async () => {
      const res =
        mode === 'buy'
          ? await buyVamseSharesAction({ stockId, shares })
          : await sellVamseSharesAction({ stockId, shares });
      if (res.ok) {
        setMsg(res.message ?? 'OK');
        setSharesText('1');
        router.refresh();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('buy')}
          disabled={isPending}
          className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-semibold ${
            mode === 'buy'
              ? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-300'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          BUY
        </button>
        <button
          type="button"
          onClick={() => setMode('sell')}
          disabled={isPending || myShares === 0}
          className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-semibold ${
            mode === 'sell'
              ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300'
              : 'border-border text-muted-foreground hover:text-foreground'
          } disabled:opacity-50`}
        >
          SELL
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Shares
        </label>
        <input
          type="number"
          min="1"
          max={mode === 'buy' ? availableShares : myShares}
          value={sharesText}
          onChange={(e) => setSharesText(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono tabular-nums focus:border-indigo-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === 'buy'
            ? `Max ${availableShares} verfügbar`
            : `Max ${myShares} (deine holdings)`}
        </p>
      </div>

      <div className="rounded-md bg-muted/30 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{ticker} preis</span>
          <span className="font-mono tabular-nums">
            {currentPrice.toFixed(2)} VAM$
          </span>
        </div>
        <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
          <span>Total ({mode === 'buy' ? 'kosten' : 'erlös'})</span>
          <span className="font-mono tabular-nums">
            {parseFloat(total).toLocaleString('de-DE')} VAM$
          </span>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-md border p-2 text-xs ${
            msg.startsWith('Error')
              ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
              : 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
          }`}
        >
          {msg}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending || shares < 1}
        className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
          mode === 'buy'
            ? 'bg-green-600 hover:bg-green-700'
            : 'bg-red-600 hover:bg-red-700'
        }`}
      >
        {isPending
          ? '…'
          : mode === 'buy'
            ? `BUY ${shares}× ${ticker}`
            : `SELL ${shares}× ${ticker}`}
      </button>
    </div>
  );
}
