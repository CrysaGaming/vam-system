'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  reEvaluateAllRanks,
  type ReEvaluateRanksFormState,
} from './actions';

/**
 * Client-component für den manuellen "Ränge neu auswerten"-button.
 *
 * Workflow:
 * 1. User klickt button → form submit → reEvaluateAllRanks server-action
 * 2. Action iteriert über alle airline-members, ruft evaluatePromotion pro user
 * 3. Returns BulkPromotionResult mit promoted[] und failed[]
 * 4. UI zeigt summary + collapsible details
 *
 * useActionState weil wir nach success die per-pilot-änderungen zeigen wollen
 * (sonst wäre ein simple form mit redirect ausreichend). Der button bleibt
 * nach success aktiv damit admin nochmal klicken kann (z.B. nach weiteren
 * rank-edits).
 */
export function ReEvaluateRanksButton() {
  const [state, formAction] = useActionState<ReEvaluateRanksFormState | null, FormData>(
    reEvaluateAllRanks,
    null,
  );

  return (
    <div className="space-y-3">
      <form action={formAction}>
        <SubmitButton />
      </form>

      {state?.message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            state.ok
              ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
              : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
          }`}
        >
          {state.ok ? '✓' : '✗'} {state.message}
        </div>
      )}

      {/* Per-pilot promoted-list als collapsible details. Nur zeigen wenn
          mindestens ein pilot promoted wurde — sonst macht's keinen sinn,
          eine leere liste auszuklappen. */}
      {state?.result && state.result.promoted.length > 0 && (
        <details className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
            ⬆ {state.result.promoted.length}{' '}
            {state.result.promoted.length === 1 ? 'Beförderung' : 'Beförderungen'}{' '}
            anzeigen
          </summary>
          <ul className="divide-y divide-gray-200 dark:divide-gray-800 text-sm">
            {state.result.promoted.map((p) => (
              <li
                key={p.userId}
                className="px-4 py-2 flex items-center justify-between gap-4"
              >
                <span className="font-medium truncate">
                  {p.userName ?? 'Unbenannter Pilot'}
                </span>
                <span className="text-gray-600 dark:text-gray-400 text-xs flex items-center gap-2 shrink-0">
                  <span className="line-through opacity-60">
                    {p.oldRankName ?? '—'}
                  </span>
                  <span>→</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                    {p.newRankName}
                  </span>
                  <span className="text-gray-400 dark:text-gray-600 tabular-nums">
                    ({p.totalFlightHours.toFixed(1)} h)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Failed-list wenn vorhanden (selten — z.B. wenn rank gelöscht wurde
          während der bulk-evaluation läuft). */}
      {state?.result && state.result.failed.length > 0 && (
        <details className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-100/50 dark:hover:bg-red-950/40 transition">
            ✗ {state.result.failed.length} fehlgeschlagene{' '}
            {state.result.failed.length === 1 ? 'Auswertung' : 'Auswertungen'}{' '}
            anzeigen
          </summary>
          <ul className="divide-y divide-red-200 dark:divide-red-900/50 text-sm">
            {state.result.failed.map((f) => (
              <li key={f.userId} className="px-4 py-2 text-red-700 dark:text-red-400">
                <code className="text-xs">{f.userId}</code>: {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded text-sm transition flex items-center gap-2"
    >
      {pending ? (
        <>
          <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Werte aus…
        </>
      ) : (
        '🔄 Ränge neu auswerten'
      )}
    </button>
  );
}
