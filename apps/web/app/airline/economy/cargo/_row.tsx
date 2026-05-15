'use client';

/**
 * Welle M / M4 — Cargo-spec row controls (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  upsertCargoLoadSpecAction,
  deleteCargoLoadSpecAction,
} from './actions';

export function CargoSpecRow({
  routeId,
  flightNumber,
  routeLabel,
  existing,
}: {
  routeId: string;
  flightNumber: string;
  routeLabel: string;
  existing: {
    cargoTonnageKg: number;
    payoutMultiplier: number;
    cargoCategory: string;
    notes: string | null;
  } | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tonnage, setTonnage] = useState(
    existing ? String(existing.cargoTonnageKg) : '',
  );
  const [multiplier, setMultiplier] = useState(
    existing ? String(existing.payoutMultiplier) : '1.3',
  );
  const [category, setCategory] = useState(
    existing?.cargoCategory ?? 'general-freight',
  );
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    setMsg(null);
    const t = parseInt(tonnage, 10);
    const m = parseFloat(multiplier);
    if (!Number.isFinite(t) || !Number.isFinite(m)) {
      setMsg('Ungültige zahlenwerte.');
      return;
    }
    startTransition(async () => {
      const res = await upsertCargoLoadSpecAction({
        routeId,
        cargoTonnageKg: t,
        payoutMultiplier: m,
        cargoCategory: category,
      });
      if (res.ok) {
        setMsg(res.message ?? 'OK');
        router.refresh();
      } else {
        setMsg(`Error: ${res.error}`);
      }
    });
  }

  function remove() {
    if (!existing) return;
    if (!confirm(`Cargo-spec für ${flightNumber} entfernen?`)) return;
    startTransition(async () => {
      const res = await deleteCargoLoadSpecAction({ routeId });
      if (res.ok) router.refresh();
      else alert(res.error);
    });
  }

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-3 py-2 font-mono font-semibold">{flightNumber}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {routeLabel}
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          max="200000"
          value={tonnage}
          onChange={(e) => setTonnage(e.target.value)}
          placeholder="kg"
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          step="0.05"
          min="1"
          max="3"
          value={multiplier}
          onChange={(e) => setMultiplier(e.target.value)}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          maxLength={50}
          className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </td>
      <td className="px-3 py-2 text-right text-xs">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={save}
            disabled={isPending || !tonnage}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {existing ? 'Update' : 'Anlegen'}
          </button>
          {existing && (
            <button
              type="button"
              onClick={remove}
              disabled={isPending}
              className="text-red-600 hover:underline dark:text-red-400"
            >
              ×
            </button>
          )}
        </div>
        {msg && <p className="mt-1 text-[10px] text-muted-foreground">{msg}</p>}
      </td>
    </tr>
  );
}
