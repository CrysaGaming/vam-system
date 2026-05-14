'use client';

/**
 * Welle L / L2 — Pairing detail action buttons (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  publishPairingAction,
  assignPairingAction,
  unassignPairingAction,
  completePairingAction,
  cancelPairingAction,
  deletePairingAction,
  addLegToPairingAction,
  removeLegFromPairingAction,
} from '../actions';

type Status = 'Draft' | 'Published' | 'Assigned' | 'InProgress' | 'Completed' | 'Cancelled';

type Pilot = { id: string; name: string | null };

type Props = {
  pairingId: string;
  status: Status;
  assignedPilotId: string | null;
  availablePilots: Pilot[];
};

export default function PairingActions({
  pairingId,
  status,
  assignedPilotId,
  availablePilots,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pilotSelect, setPilotSelect] = useState(assignedPilotId ?? '');

  function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleAssign() {
    if (!pilotSelect) {
      setError('Bitte pilot wählen.');
      return;
    }
    run(() => assignPairingAction({ pairingId, pilotId: pilotSelect }));
  }

  function handleDelete() {
    if (!confirm('Pairing wirklich löschen?')) return;
    setError(null);
    startTransition(async () => {
      const res = await deletePairingAction(pairingId);
      if (res.ok) {
        router.push('/airline/pairings');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {status === 'Draft' && (
          <>
            <button
              type="button"
              onClick={() => run(() => publishPairingAction(pairingId))}
              disabled={isPending}
              className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-300"
            >
              📤 Publishen
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
            >
              Löschen
            </button>
          </>
        )}

        {(status === 'Published' || status === 'Assigned') && (
          <div className="flex items-center gap-2">
            <select
              value={pilotSelect}
              onChange={(e) => setPilotSelect(e.target.value)}
              disabled={isPending}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">— Pilot wählen —</option>
              {availablePilots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? 'Pilot'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAssign}
              disabled={isPending || !pilotSelect}
              className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-500/20 disabled:opacity-50 dark:text-indigo-300"
            >
              {status === 'Assigned' ? 'Re-assign' : 'Zuweisen'}
            </button>
            {status === 'Assigned' && (
              <button
                type="button"
                onClick={() => run(() => unassignPairingAction(pairingId))}
                disabled={isPending}
                className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-500/20 disabled:opacity-50 dark:text-orange-300"
              >
                Zuweisung entfernen
              </button>
            )}
          </div>
        )}

        {(status === 'Assigned' || status === 'InProgress') && (
          <button
            type="button"
            onClick={() => run(() => completePairingAction(pairingId))}
            disabled={isPending}
            className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm font-semibold text-green-700 hover:bg-green-500/20 disabled:opacity-50 dark:text-green-300"
          >
            ✓ Abschließen
          </button>
        )}

        {status !== 'Completed' && status !== 'Cancelled' && status !== 'Draft' && (
          <button
            type="button"
            onClick={() => run(() => cancelPairingAction(pairingId))}
            disabled={isPending}
            className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-500/20 disabled:opacity-50 dark:text-red-300"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Removable leg-button (Draft-only). Inline-rendered im legs-table.
 */
export function RemoveLegButton({ legId, canRemove }: { legId: string; canRemove: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (!canRemove) return null;

  function remove() {
    if (!confirm('Leg entfernen?')) return;
    startTransition(async () => {
      const res = await removeLegFromPairingAction(legId);
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

/**
 * Add-leg form (Draft-only).
 */
type AvailableFlight = {
  id: string;
  flightNumber: string;
  departureIcao: string;
  arrivalIcao: string;
  departureTime: Date;
};

export function AddLegForm({
  pairingId,
  availableFlights,
}: {
  pairingId: string;
  availableFlights: AvailableFlight[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [flightId, setFlightId] = useState('');
  const [layover, setLayover] = useState('');
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    if (!flightId) {
      setError('Bitte flight wählen.');
      return;
    }
    const layoverNum = layover.trim() === '' ? null : parseFloat(layover);
    if (layoverNum !== null && (isNaN(layoverNum) || layoverNum < 0)) {
      setError('Layover muss eine positive zahl sein.');
      return;
    }
    startTransition(async () => {
      const res = await addLegToPairingAction({
        pairingId,
        scheduledFlightId: flightId,
        layoverHoursAfter: layoverNum,
      });
      if (res.ok) {
        setFlightId('');
        setLayover('');
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Leg hinzufügen</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={flightId}
          onChange={(e) => setFlightId(e.target.value)}
          disabled={isPending}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none sm:col-span-2"
        >
          <option value="">— Scheduled Flight wählen —</option>
          {availableFlights.map((f) => (
            <option key={f.id} value={f.id}>
              {f.flightNumber} · {f.departureIcao}→{f.arrivalIcao} ·{' '}
              {f.departureTime.toLocaleString('de-DE', {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: 'UTC',
              })}
              Z
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.5"
          min="0"
          value={layover}
          onChange={(e) => setLayover(e.target.value)}
          disabled={isPending}
          placeholder="Layover (h)"
          className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={add}
        disabled={isPending || !flightId}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending ? 'Hinzufüge…' : '+ Leg hinzufügen'}
      </button>
    </div>
  );
}
