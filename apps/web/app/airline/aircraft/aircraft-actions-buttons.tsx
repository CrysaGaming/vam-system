'use client';

import { useTransition, useState } from 'react';
import Link from 'next/link';
import { setAircraftStatus, deleteAircraft } from './actions';
import type { AircraftStatus } from '@vam/db';

interface Props {
  aircraftId: string;
  registration: string;
  currentStatus: AircraftStatus;
  // Total references — wenn > 0, hard-delete blocked (server-action lehnt ab,
  // wir zeigen "Außer Dienst setzen" als alternative-action statt delete-button).
  pirepCount: number;
  routeCount: number;
}

/**
 * Per-row aircraft-action-buttons: status-dropdown + edit-link + delete-button.
 *
 * Status-dropdown:
 * - 4 options (ACTIVE/MAINTENANCE/STORED/RETIRED). Auto-submit beim change.
 * - Server-action ist no-op wenn current === neu (idempotent).
 * - Pending-state via useTransition.
 *
 * Edit-link:
 * - Plain Link auf /airline/aircraft/[id]/edit. Kein client-handler nötig.
 *
 * Delete-button:
 * - Visible nur wenn pirepCount === 0 && routeCount === 0 (sonst zeigen
 *   wir tooltip "kann nicht gelöscht werden" statt button).
 * - Confirm-prompt vor delete.
 */
export function AircraftActionsButtons({
  aircraftId,
  registration,
  currentStatus,
  pirepCount,
  routeCount,
}: Props) {
  const [isPendingStatus, startStatus] = useTransition();
  const [isPendingDelete, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canDelete = pirepCount === 0 && routeCount === 0;

  function handleStatusChange(newStatus: string) {
    if (newStatus === currentStatus) return;
    setError(null);
    const fd = new FormData();
    fd.set('aircraftId', aircraftId);
    fd.set('status', newStatus);
    startStatus(async () => {
      try {
        const result = await setAircraftStatus(fd);
        if (!result.ok) setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleDelete() {
    const confirmText = `Aircraft ${registration} wirklich permanent löschen?\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`;
    if (!window.confirm(confirmText)) return;

    setError(null);
    const fd = new FormData();
    fd.set('aircraftId', aircraftId);
    startDelete(async () => {
      try {
        const result = await deleteAircraft(fd);
        if (!result.ok) setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler');
      }
    });
  }

  const anyPending = isPendingStatus || isPendingDelete;

  return (
    <div className="flex flex-col items-end gap-2 min-w-[180px]">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {/* Status-dropdown — auto-submit on change. Native select für a11y +
            keyboard-nav. Disabled während pending. */}
        <select
          value={currentStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={anyPending}
          aria-label="Status ändern"
          className="text-xs px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="ACTIVE">Aktiv</option>
          <option value="MAINTENANCE">Wartung</option>
          <option value="STORED">Eingelagert</option>
          <option value="RETIRED">Außer Dienst</option>
        </select>

        <Link
          href={`/airline/aircraft/${aircraftId}/edit`}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
        >
          Edit
        </Link>

        {canDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={anyPending}
            className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:text-gray-400 disabled:cursor-not-allowed transition"
          >
            {isPendingDelete ? 'Lösche…' : 'Löschen'}
          </button>
        ) : (
          <span
            className="text-xs text-gray-400 dark:text-gray-600 cursor-help"
            title={`Hat ${pirepCount} PIREPs / ${routeCount} Routes — nicht löschbar. Setze Status auf "Außer Dienst" stattdessen.`}
          >
            Löschen ✗
          </span>
        )}
      </div>

      {isPendingStatus && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Status wird geändert…
        </span>
      )}

      {error && (
        <span className="text-xs text-red-600 dark:text-red-400 max-w-xs text-right">
          {error}
        </span>
      )}
    </div>
  );
}
