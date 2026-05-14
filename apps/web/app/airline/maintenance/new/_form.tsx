'use client';

/**
 * Welle L / L3 — New maintenance-event form (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMaintenanceEventAction } from '../actions';

type Aircraft = {
  id: string;
  registration: string;
  type: string;
};

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'PreFlightCheck', label: 'Pre-Flight Check' },
  { value: 'ACheck', label: 'A-Check' },
  { value: 'BCheck', label: 'B-Check' },
  { value: 'CCheck', label: 'C-Check' },
  { value: 'DCheck', label: 'D-Check' },
  { value: 'Repair', label: 'Reparatur' },
  { value: 'OilChange', label: 'Ölwechsel' },
  { value: 'TireReplacement', label: 'Reifenwechsel' },
  { value: 'EngineWork', label: 'Triebwerksarbeit' },
  { value: 'AvionicsUpdate', label: 'Avionik-Update' },
  { value: 'Other', label: 'Sonstiges' },
];

export default function NewMaintenanceForm({
  aircrafts,
}: {
  aircrafts: Aircraft[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [aircraftId, setAircraftId] = useState(aircrafts[0]?.id ?? '');
  const [type, setType] = useState<string>('ACheck');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [costVam, setCostVam] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!aircraftId) {
      setError('Bitte aircraft wählen.');
      return;
    }
    if (!scheduledStart || !scheduledEnd) {
      setError('Geplant-start und -ende sind pflichtfelder.');
      return;
    }
    const costNum = costVam.trim() === '' ? null : parseFloat(costVam);
    if (costNum !== null && (isNaN(costNum) || costNum < 0)) {
      setError('Kosten muss eine positive zahl sein.');
      return;
    }

    startTransition(async () => {
      const res = await createMaintenanceEventAction({
        aircraftId,
        type,
        title,
        description,
        scheduledStartIso: new Date(scheduledStart).toISOString(),
        scheduledEndIso: new Date(scheduledEnd).toISOString(),
        costVam: costNum,
        nextDueAtIso: nextDue.trim() ? new Date(nextDue).toISOString() : null,
      });
      if (res.ok && res.eventId) {
        router.push(`/airline/maintenance/${res.eventId}`);
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Aircraft
          </label>
          <select
            value={aircraftId}
            onChange={(e) => setAircraftId(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          >
            <option value="">— Wählen —</option>
            {aircrafts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.registration} · {a.type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Typ
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Titel
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="z.B. Routine A-Check 2026/Q2"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Geplant: Start
          </label>
          <input
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Geplant: Ende
          </label>
          <input
            type="datetime-local"
            value={scheduledEnd}
            onChange={(e) => setScheduledEnd(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Kosten (VAM$, optional)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={costVam}
            onChange={(e) => setCostVam(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            disabled={isPending}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Nächste Fälligkeit (optional)
          </label>
          <input
            type="datetime-local"
            value={nextDue}
            onChange={(e) => setNextDue(e.target.value)}
            disabled={isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Beschreibung (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder="Technische details, geplante arbeiten, ersatzteile, mechanic-team etc."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">
          {description.length} / 5000
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending || title.length < 3 || !scheduledStart || !scheduledEnd}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Erstelle…' : 'Event anlegen'}
      </button>
    </div>
  );
}
