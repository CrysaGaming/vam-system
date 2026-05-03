'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { createRank, updateRank, type RankFormState } from './actions';

type Mode =
  | { kind: 'create' }
  | {
      kind: 'edit';
      rankId: string;
      initialName: string;
      initialMinFlightHours: number;
      initialOrder: number;
    };

interface Props {
  mode: Mode;
  /** Optional callback nach erfolgreichem submit. Server-actions revalidaten
   *  schon die paths, aber im inline-add-mode wollen wir das form resetten —
   *  das macht der parent durch `key`-prop bump statt uns. */
  compact?: boolean;
}

/**
 * Shared form für create + edit von ranks. useActionState (React 19) für
 * server-action-integration mit per-field-errors.
 *
 * Felder: name (text) + minFlightHours (decimal) + order (int). Bewusst
 * keine zusätzlichen felder wie "color" oder "icon" — kann später kommen
 * wenn user-feedback es will.
 *
 * compact=true → kleinere padding/spacings für inline-use auf der listing-
 * page. compact=false (default) → volle padding für standalone-edit-page.
 */
export function RankForm({ mode, compact = false }: Props) {
  // Bind der action mit dem rankId für edit-mode. createRank ignoriert den
  // ersten arg, updateRank nutzt rankId.
  const action =
    mode.kind === 'create'
      ? createRank
      : updateRank.bind(null, mode.rankId);

  const [state, formAction] = useActionState<RankFormState | null, FormData>(
    action,
    null,
  );

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className={compact ? 'space-y-3' : 'space-y-5'}>
      {/* Top-level message (success or error) */}
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

      <div className={`grid grid-cols-1 ${compact ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-4`}>
        {/* Name */}
        <div className={compact ? '' : 'sm:col-span-2'}>
          <label
            htmlFor="rank-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Name<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text"
            id="rank-name"
            name="name"
            required
            maxLength={50}
            placeholder="z.B. First Officer"
            defaultValue={mode.kind === 'edit' ? mode.initialName : ''}
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              errors.name
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-indigo-500`}
          />
          {errors.name && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.name}
            </p>
          )}
        </div>

        {/* minFlightHours */}
        <div>
          <label
            htmlFor="rank-min-hours"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Min. Stunden
          </label>
          <input
            type="number"
            id="rank-min-hours"
            name="minFlightHours"
            min="0"
            max="50000"
            step="0.5"
            required
            placeholder="0"
            defaultValue={
              mode.kind === 'edit' ? mode.initialMinFlightHours : '0'
            }
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              errors.minFlightHours
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 tabular-nums`}
          />
          {errors.minFlightHours && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.minFlightHours}
            </p>
          )}
          {!errors.minFlightHours && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Threshold für auto-promotion
            </p>
          )}
        </div>

        {/* Order */}
        <div>
          <label
            htmlFor="rank-order"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Reihenfolge
          </label>
          <input
            type="number"
            id="rank-order"
            name="order"
            min="0"
            max="999"
            step="1"
            required
            placeholder="0"
            defaultValue={mode.kind === 'edit' ? mode.initialOrder : '0'}
            className={`w-full px-3 py-2 bg-white dark:bg-gray-800 border ${
              errors.order
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            } rounded text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 tabular-nums`}
          />
          {errors.order && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
              {errors.order}
            </p>
          )}
          {!errors.order && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Niedrig = unten, hoch = oben
            </p>
          )}
        </div>
      </div>

      {/* Action-buttons */}
      <div className={`flex flex-wrap gap-3 ${compact ? '' : 'pt-2'}`}>
        <SubmitButton kind={mode.kind} />
        {mode.kind === 'edit' && (
          <Link
            href="/airline/ranks"
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded transition"
          >
            Abbrechen
          </Link>
        )}
      </div>
    </form>
  );
}

function SubmitButton({ kind }: { kind: 'create' | 'edit' }) {
  const { pending } = useFormStatus();
  const label = kind === 'create' ? 'Rang anlegen' : 'Änderungen speichern';
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded transition"
    >
      {pending ? 'Speichere…' : label}
    </button>
  );
}
