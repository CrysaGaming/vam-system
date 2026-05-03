'use client';

import { useState, useTransition } from 'react';
import { assignRankToMember } from '../actions';

interface RankOption {
  id: string;
  name: string;
  order: number;
}

interface Props {
  userId: string;
  currentRankId: string | null;
  availableRanks: RankOption[];
}

/**
 * Dropdown für manuelle rank-zuweisung. Auf change wird `assignRankToMember`
 * aus /airline/actions.ts gerufen — das ist die zentrale action mit allen
 * safety-guards (multi-tenant, rank-belongs-to-airline). Nicht hier
 * dupliziert.
 *
 * Empty-option ('— Kein Rang —') sendet null, was admin erlaubt einen
 * pilot rank-frei zu machen (z.B. neuer pilot vor erstem PIREP).
 *
 * Optimistic-update: dropdown reflektiert die wahl sofort, server-action
 * läuft im hintergrund. Bei error: revert + show inline.
 *
 * Note: assignRankToMember überschreibt auto-promotion. Wenn admin manuell
 * einen niedrigeren rank zuweist, würde der nächste PIREP wieder hochpromoten
 * (siehe @/lib/ranks evaluatePromotion no-demote-policy). Das ist intentional
 * — manuelle zuweisung ist eine korrektur, kein hard-cap.
 */
export function RankDropdown({ userId, currentRankId, availableRanks }: Props) {
  const [optimisticRankId, setOptimisticRankId] = useState<string | null>(
    currentRankId,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRankId = e.target.value === '' ? null : e.target.value;
    if (newRankId === optimisticRankId || isPending) return;

    const previousRankId = optimisticRankId;
    setOptimisticRankId(newRankId);
    setError(null);

    startTransition(async () => {
      try {
        await assignRankToMember({ userId, rankId: newRankId });
      } catch (err) {
        setOptimisticRankId(previousRankId);
        setError(
          err instanceof Error ? err.message : 'Fehler bei der Zuweisung',
        );
      }
    });
  }

  return (
    <div className="space-y-1">
      <select
        value={optimisticRankId ?? ''}
        onChange={handleChange}
        disabled={isPending}
        className={`text-xs px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded focus:outline-none focus:border-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed ${
          isPending ? 'opacity-60' : ''
        }`}
        aria-label="Rang zuweisen"
      >
        <option value="">— Kein Rang —</option>
        {availableRanks.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
