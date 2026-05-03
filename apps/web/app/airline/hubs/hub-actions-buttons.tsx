'use client';

import { useTransition, useState } from 'react';
import { setPrimaryHub, removeHub } from './actions';

interface Props {
  hubId: string;
  airportIcao: string;
  isPrimary: boolean;
  // Wenn true: dieser hub ist der einzige hub. Delete ist erlaubt aber
  // wir zeigen ein anderes confirm-text ("airline ohne hubs").
  isOnlyHub: boolean;
}

/**
 * Per-row action-buttons: "Als Primary setzen" (wenn nicht primary) + "Entfernen".
 * Beide buttons rufen ihre server-action und nutzen useTransition für
 * pending-state. Errors werden inline unter dem button gezeigt — gleicher
 * pattern wie DeleteRouteButton.
 *
 * Set-primary: visible nur wenn !isPrimary. Wenn primary, zeigen wir nichts
 * (badge in der haupt-row macht das primary-state schon klar).
 *
 * Delete:
 *  - Primary-hub mit anderen hubs daneben → server lehnt ab, wir zeigen
 *    error inline ("erst anderen hub als primary setzen")
 *  - Primary-hub als einziger hub → confirm-text fragt extra nach
 *  - Non-primary hub → normaler confirm
 */
export function HubActionsButtons({ hubId, airportIcao, isPrimary, isOnlyHub }: Props) {
  const [isPendingPrimary, startPrimary] = useTransition();
  const [isPendingDelete, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSetPrimary() {
    setError(null);
    const fd = new FormData();
    fd.set('hubId', hubId);
    startPrimary(async () => {
      try {
        const result = await setPrimaryHub(fd);
        if (!result.ok) setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter fehler');
      }
    });
  }

  function handleRemove() {
    const confirmText = isPrimary && isOnlyHub
      ? `${airportIcao} ist dein einziger Hub. Wenn du ihn entfernst, hat deine Airline keinen Hub mehr (du musst dann einen neuen anlegen). Wirklich entfernen?`
      : `Hub ${airportIcao} wirklich entfernen?\n\nHinweis: Piloten mit baseIcao=${airportIcao} bleiben aktiv, fallen aber app-seitig auf den Primary-Hub zurück.`;

    if (!window.confirm(confirmText)) return;

    setError(null);
    const fd = new FormData();
    fd.set('hubId', hubId);
    startDelete(async () => {
      try {
        const result = await removeHub(fd);
        if (!result.ok) setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter fehler');
      }
    });
  }

  const anyPending = isPendingPrimary || isPendingDelete;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {!isPrimary && (
          <button
            type="button"
            onClick={handleSetPrimary}
            disabled={anyPending}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:text-gray-400 disabled:cursor-not-allowed transition"
          >
            {isPendingPrimary ? 'Setze…' : 'Als Primary setzen'}
          </button>
        )}
        <button
          type="button"
          onClick={handleRemove}
          disabled={anyPending}
          className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:text-gray-400 disabled:cursor-not-allowed transition"
        >
          {isPendingDelete ? 'Entferne…' : 'Entfernen'}
        </button>
      </div>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400 max-w-xs text-right">
          {error}
        </span>
      )}
    </div>
  );
}
