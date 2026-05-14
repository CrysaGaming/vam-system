'use client';

/**
 * Welle K / K5 — New-trip form (client).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createInterAirlineTripAction } from '../actions';

export default function NewTripForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [departureIcao, setDepartureIcao] = useState('');
  const [arrivalIcao, setArrivalIcao] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (!scheduledLocal) {
      setError('Bitte ein datum/uhrzeit auswählen.');
      return;
    }
    // datetime-local liefert "YYYY-MM-DDTHH:mm" ohne timezone.
    // Wir interpretieren als lokal-zeit und konvertieren zu ISO.
    const scheduledAtIso = new Date(scheduledLocal).toISOString();

    startTransition(async () => {
      const res = await createInterAirlineTripAction({
        title,
        description,
        departureIcao,
        arrivalIcao,
        scheduledAtIso,
        maxParticipants,
      });
      if (res.ok && res.tripId) {
        router.push(`/trips/${res.tripId}`);
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Titel
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="z.B. Friday Hop EDDK → LFPG"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Departure ICAO
          </label>
          <input
            type="text"
            value={departureIcao}
            onChange={(e) => setDepartureIcao(e.target.value.toUpperCase())}
            maxLength={10}
            placeholder="EDDK"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-base uppercase focus:border-indigo-500 focus:outline-none"
            disabled={isPending}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Arrival ICAO
          </label>
          <input
            type="text"
            value={arrivalIcao}
            onChange={(e) => setArrivalIcao(e.target.value.toUpperCase())}
            maxLength={10}
            placeholder="LFPG"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-base uppercase focus:border-indigo-500 focus:outline-none"
            disabled={isPending}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Geplant für
          </label>
          <input
            type="datetime-local"
            value={scheduledLocal}
            onChange={(e) => setScheduledLocal(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            disabled={isPending}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Max teilnehmer (0 = unbegrenzt)
          </label>
          <input
            type="number"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(parseInt(e.target.value, 10) || 0)}
            min={0}
            max={99}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
            disabled={isPending}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Beschreibung
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={6}
          placeholder="Was ist geplant? Welcher network? Welche aircraft? Voice oder text-only? Diskord-channel für coord?"
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
        disabled={isPending || title.length < 5 || description.length < 10 || !scheduledLocal}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Erstelle…' : 'Trip erstellen'}
      </button>
    </div>
  );
}
