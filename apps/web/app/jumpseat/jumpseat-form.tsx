'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { executeJumpseat } from './actions';

interface HubOption {
  airportIcao: string;
  airportName: string;
  airportCity: string | null;
  isPrimary: boolean;
  isCurrent: boolean;
}

interface Props {
  hubs: HubOption[];
  baseIcao: string | null;
}

/**
 * Client-form für jumpseat-transfer. Listet alle hubs der user-airline als
 * radio-cards (statt dropdown) damit man auf einen blick sieht wo die
 * optionen sind und welche schon current/base sind. Reason als radio-row,
 * notes optional.
 *
 * Defaults:
 * - reason = RETURN_TO_HUB (häufigster fall — pilot ist gestrandet, will
 *   zurück zur base)
 * - target = base wenn base ≠ current und base ist ein hub; sonst keine
 *   pre-selection (user muss aktiv wählen)
 *
 * Disabled-state für aktuellen standort: man kann sich nicht zu sich
 * selbst jumpseaten. Server lehnt es eh ab, aber UI macht's klarer wenn
 * der eigene icao schon als "Aktuell hier" gemarkt + radio disabled ist.
 */
type State = { ok: true } | { ok: false; error: string } | null;

export function JumpseatForm({ hubs, baseIcao }: Props) {
  const [state, formAction] = useActionState<State, FormData>(
    async (_prev, formData) => executeJumpseat(_prev, formData),
    null,
  );

  // Pre-select: wenn base ein hub ist UND nicht current → default auf base.
  // Sonst kein default (user muss aktiv klicken).
  const defaultTargetIcao = (() => {
    if (!baseIcao) return null;
    const baseHub = hubs.find((h) => h.airportIcao === baseIcao);
    if (!baseHub || baseHub.isCurrent) return null;
    return baseHub.airportIcao;
  })();

  return (
    <form action={formAction} className="space-y-6">
      {/* Hub-selection als radio-cards */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Ziel-Hub
        </legend>
        <div className="space-y-2">
          {hubs.map((hub) => {
            const id = `hub-${hub.airportIcao}`;
            return (
              <label
                key={hub.airportIcao}
                htmlFor={id}
                className={`flex items-center gap-3 p-4 rounded-lg border transition cursor-pointer ${
                  hub.isCurrent
                    ? 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed opacity-60'
                    : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-500/50 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:has-[:checked]:bg-indigo-500/10'
                }`}
              >
                <input
                  type="radio"
                  id={id}
                  name="toIcao"
                  value={hub.airportIcao}
                  required
                  disabled={hub.isCurrent}
                  defaultChecked={
                    !hub.isCurrent && hub.airportIcao === defaultTargetIcao
                  }
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-mono font-bold">
                    {hub.airportIcao}
                    {hub.isPrimary && (
                      <span className="inline-flex items-center px-2 py-0.5 ml-2 text-xs font-medium rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                        ★ Primary
                      </span>
                    )}
                    {hub.isCurrent && (
                      <span className="inline-flex items-center px-2 py-0.5 ml-2 text-xs font-medium rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                        Aktuell hier
                      </span>
                    )}
                    {hub.airportIcao === baseIcao && !hub.isPrimary && (
                      <span className="inline-flex items-center px-2 py-0.5 ml-2 text-xs font-medium rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                        Deine Base
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    {hub.airportName}
                    {hub.airportCity && ` · ${hub.airportCity}`}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Reason-row */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          Grund
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              { value: 'RETURN_TO_HUB', label: 'Return to Hub', desc: 'Zurück zur Base' },
              { value: 'HUB_TO_HUB', label: 'Hub to Hub', desc: 'Zwischen Hubs' },
              { value: 'POSITIONING', label: 'Positioning', desc: 'Ferry-Flug' },
              { value: 'ADMIN_TRANSFER', label: 'Admin', desc: 'Sonstiges' },
            ] as const
          ).map((r) => {
            const id = `reason-${r.value}`;
            return (
              <label
                key={r.value}
                htmlFor={id}
                className="flex flex-col gap-1 p-3 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-500/50 transition cursor-pointer has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50/30 dark:has-[:checked]:bg-indigo-500/5"
              >
                <input
                  type="radio"
                  id={id}
                  name="reason"
                  value={r.value}
                  required
                  defaultChecked={r.value === 'RETURN_TO_HUB'}
                  className="sr-only"
                />
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {r.label}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {r.desc}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Notes (optional) */}
      <div>
        <label
          htmlFor="notes"
          className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
        >
          Notizen <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={500}
          placeholder="z.B. Gestrandet wegen MEL"
          className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-indigo-500 resize-none"
        />
      </div>

      {state && !state.ok && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {state.error}
        </div>
      )}
      {state && state.ok && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2">
          Jumpseat erfolgreich. Deine neue Position ist gespeichert.
        </div>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? 'Wird ausgeführt…' : 'Jumpseat starten'}
    </button>
  );
}
