'use client';

/**
 * Welle L / L2 — Create new crew-pairing form.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createCrewPairingAction } from '../actions';

export default function NewPairingForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createCrewPairingAction({ name, description });
      if (res.ok && res.pairingId) {
        router.push(`/airline/pairings/${res.pairingId}`);
      } else if (!res.ok) {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="z.B. P-FRA-NYC-Day1+2"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Beschreibung (optional)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Was ist das ziel der pairing? Layover-info, rest-perioden, sonstige notizen."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          disabled={isPending}
        />
        <div className="mt-1 text-xs text-muted-foreground">
          {description.length} / 2000
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
        disabled={isPending || name.length < 3}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'Erstelle…' : 'Pairing erstellen'}
      </button>
      <p className="text-xs text-muted-foreground">
        Wird als Draft erstellt. Im nächsten schritt fügst du legs hinzu.
      </p>
    </div>
  );
}
