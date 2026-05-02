'use client';

import { useTransition, useState } from 'react';
import { deleteRoute } from './actions';

interface Props {
  routeId: string;
  flightNumber: string;
}

/**
 * Delete-button mit confirm-dialog. Verwendet useTransition für pending-
 * state damit das parent-form nicht blockt während die action läuft.
 *
 * Confirm-strategie: window.confirm() ist primitive aber bewährt. Custom
 * modal wäre nicer aber 5x mehr code für 1 case — der admin-flow ist
 * keyboard-driven, da reicht der native dialog. Bei wiederkehrendem
 * pattern später → shared confirm-modal.
 *
 * Server-side ist deleteRoute idempotent + smart: wenn route PIREPs/
 * bookings hat → soft-delete (active=false), sonst hard-delete. Das
 * spiegeln wir hier nicht im UI weil der admin den unterschied nicht
 * sehen muss — er sieht nur "weg aus der liste".
 */
export function DeleteRouteButton({ routeId, flightNumber }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (
      !window.confirm(
        `Route ${flightNumber} wirklich löschen?\n\nFalls bereits PIREPs oder bookings existieren, wird die route nur deaktiviert (kein hard-delete).`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      setError(null);
      try {
        const result = await deleteRoute(routeId);
        if (!result.ok) {
          setError(result.message ?? 'Löschen fehlgeschlagen');
        }
        // Bei success: revalidatePath im server triggert re-render der page,
        // die row verschwindet automatisch. Kein client-state-update nötig.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter fehler');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:text-gray-400 disabled:cursor-not-allowed transition"
      >
        {isPending ? 'Löschen...' : 'Löschen'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
