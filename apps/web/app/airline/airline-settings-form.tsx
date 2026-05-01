'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateAirlineSettings, type AirlineSettings } from './actions';

interface Props {
  initial: AirlineSettings;
}

/**
 * Airline settings form — edits name, callsign, IATA, logoUrl. ICAO is
 * displayed read-only because changing it would cascade across all
 * aircraft/routes/bookings (it's the natural foreign key).
 */
export function AirlineSettingsForm({ initial }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);

    const name = (formData.get('name') as string).trim();
    const callsign = (formData.get('callsign') as string).trim() || null;
    const iata = (formData.get('iata') as string).trim() || null;
    const logoUrl = (formData.get('logoUrl') as string).trim() || null;

    startTransition(async () => {
      try {
        await updateAirlineSettings({ name, callsign, iata, logoUrl });
        setSaved(true);
        router.refresh();
        // Auto-clear the saved indicator after a moment so the user
        // doesn't see "Gespeichert" hours later if they leave the page open.
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Airline-Einstellungen</h2>
        <span className="text-xs text-gray-500 font-mono">
          ICAO: {initial.icao}
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded border bg-red-500/10 border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 px-4 py-3 rounded border bg-green-500/10 border-green-500/30 text-green-300 text-sm">
          ✓ Gespeichert
        </div>
      )}

      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Name
          </label>
          <input
            type="text"
            name="name"
            required
            minLength={2}
            maxLength={80}
            defaultValue={initial.name}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              Callsign
            </label>
            <input
              type="text"
              name="callsign"
              maxLength={20}
              defaultValue={initial.callsign ?? ''}
              placeholder="z. B. LUFTHANSA"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Wird in ATC-Communication verwendet
            </p>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
              IATA Code
            </label>
            <input
              type="text"
              name="iata"
              maxLength={2}
              pattern="[A-Z0-9]{2}"
              defaultValue={initial.iata ?? ''}
              placeholder="z. B. LH"
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono uppercase focus:border-indigo-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              2-stelliger IATA-Code (optional)
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
            Logo URL
          </label>
          <input
            type="url"
            name="logoUrl"
            maxLength={500}
            defaultValue={initial.logoUrl ?? ''}
            placeholder="https://example.com/logo.png"
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm focus:border-indigo-500 outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional. URL zu einem öffentlich erreichbaren Bild.
          </p>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-semibold transition disabled:opacity-50"
          >
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </form>
    </div>
  );
}
