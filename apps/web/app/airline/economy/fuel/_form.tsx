'use client';

/**
 * Welle M / M3 — Fuel price upsert/delete row controls (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { upsertFuelPriceAction, deleteFuelPriceAction } from './actions';

export function FuelPriceUpsertForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [icao, setIcao] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function submit() {
    setMsg(null);
    const p = parseFloat(price);
    if (!Number.isFinite(p)) {
      setMsg('Ungültiger preis.');
      return;
    }
    startTransition(async () => {
      const res = await upsertFuelPriceAction({
        icao,
        pricePerGallon: p,
        note: note || null,
      });
      if (res.ok) {
        setIcao('');
        setPrice('');
        setNote('');
        setMsg(res.message ?? 'OK');
        router.refresh();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Preis hinzufügen / aktualisieren
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_140px_1fr_auto]">
        <input
          type="text"
          placeholder="ICAO"
          value={icao}
          onChange={(e) => setIcao(e.target.value.toUpperCase())}
          maxLength={10}
          className="rounded-md border border-border bg-background px-3 py-2 font-mono text-base focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <input
          type="number"
          step="0.001"
          min="0.01"
          max="99"
          placeholder="VAM$/gal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-base tabular-nums focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <input
          type="text"
          placeholder="Notiz (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !icao || !price}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? '…' : 'Setzen'}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

export function DeletePriceButton({ icao }: { icao: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function remove() {
    if (!confirm(`Preis für ${icao} entfernen?`)) return;
    startTransition(async () => {
      const res = await deleteFuelPriceAction({ icao });
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={isPending}
      className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
    >
      {isPending ? '…' : 'Entfernen'}
    </button>
  );
}
