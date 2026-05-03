'use client';

import { useState, useTransition } from 'react';
import { deleteRank } from './actions';

interface Props {
  rankId: string;
  rankName: string;
  /** Wenn true (= userCount > 0), button ist disabled mit hinweis. */
  hasUsers: boolean;
  userCount: number;
}

/**
 * Delete-button für ranks. Zwei-step-flow: erst klick auf "Löschen" → button
 * verwandelt sich in inline-confirm mit "Wirklich?" + "Ja, löschen" + "Nein".
 * Kein modal-overlay weil das mehr UI-state macht und für so eine simple
 * confirmation overkill ist.
 *
 * Wenn der rank piloten hat (hasUsers=true), button ist disabled mit
 * tooltip — die action würde eh fehlschlagen, besser frühzeitig signalisieren.
 *
 * Errors werden inline unter dem button gezeigt (nicht via toast oder
 * modal — wieder simpler).
 */
export function DeleteRankButton({ rankId, rankName, hasUsers, userCount }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (hasUsers) {
    return (
      <button
        type="button"
        disabled
        title={`${userCount} ${userCount === 1 ? 'Pilot hat' : 'Piloten haben'} diesen Rang — erst zuweisen entfernen`}
        className="text-xs text-gray-400 dark:text-gray-600 cursor-not-allowed"
      >
        🔒 Löschen
      </button>
    );
  }

  function handleDelete() {
    const fd = new FormData();
    fd.set('rankId', rankId);
    startTransition(async () => {
      const result = await deleteRank(fd);
      if (!result.ok) {
        setError(result.message ?? 'Fehler beim löschen');
        setConfirming(false);
      } else {
        setError(null);
        // server-action revalidatet path → liste rerendered ohne den rank.
        // Kein redirect nötig.
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600 dark:text-gray-400">
          &ldquo;{rankName}&rdquo; wirklich löschen?
        </span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded transition"
        >
          {isPending ? '…' : 'Ja, löschen'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 rounded transition"
        >
          Nein
        </button>
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 ml-2">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition"
      >
        Löschen
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
