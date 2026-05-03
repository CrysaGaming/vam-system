'use client';

import { useState, useTransition } from 'react';
import type { EmploymentStatus } from '@vam/db';
import { setEmploymentStatus } from './actions';

interface Props {
  userId: string;
  currentStatus: EmploymentStatus;
}

/**
 * Inline employment-status-control für eine pilot-row. Zeigt 3 buttons
 * (ACTIVE | LEAVE | INACTIVE) als segmented-control. Klick wechselt
 * sofort, optimistic-update mit useTransition.
 *
 * Visuelle treatment:
 * - ACTIVE: grün (positives signal)
 * - LEAVE: amber (neutral / informativ)
 * - INACTIVE: gray (zurückgenommen)
 *
 * Error-recovery: wenn server-action fehlschlägt, revertiere optimistic-
 * state zurück und zeige error inline.
 */
export function EmploymentStatusToggle({ userId, currentStatus }: Props) {
  const [optimisticStatus, setOptimisticStatus] =
    useState<EmploymentStatus>(currentStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(newStatus: EmploymentStatus) {
    if (newStatus === optimisticStatus || isPending) return;

    const previousStatus = optimisticStatus;
    setOptimisticStatus(newStatus);
    setError(null);

    startTransition(async () => {
      const result = await setEmploymentStatus({ userId, status: newStatus });
      if (!result.ok) {
        setOptimisticStatus(previousStatus);
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-1">
      <div
        className={`inline-flex rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden ${
          isPending ? 'opacity-60' : ''
        }`}
        role="radiogroup"
        aria-label="Employment-Status"
      >
        <StatusButton
          value="ACTIVE"
          label="Aktiv"
          current={optimisticStatus}
          onChange={handleChange}
          disabled={isPending}
        />
        <StatusButton
          value="LEAVE"
          label="Urlaub"
          current={optimisticStatus}
          onChange={handleChange}
          disabled={isPending}
        />
        <StatusButton
          value="INACTIVE"
          label="Inaktiv"
          current={optimisticStatus}
          onChange={handleChange}
          disabled={isPending}
        />
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function StatusButton({
  value,
  label,
  current,
  onChange,
  disabled,
}: {
  value: EmploymentStatus;
  label: string;
  current: EmploymentStatus;
  onChange: (s: EmploymentStatus) => void;
  disabled: boolean;
}) {
  const isActive = current === value;

  // Per-status-color: aktiv = farbig, sonst grau
  const activeClasses =
    value === 'ACTIVE'
      ? 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40'
      : value === 'LEAVE'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
        : 'bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-500/40';

  const inactiveClasses =
    'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800';

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`px-2.5 py-1 text-xs font-medium border-r last:border-r-0 border-gray-300 dark:border-gray-700 transition disabled:cursor-not-allowed ${
        isActive ? activeClasses : inactiveClasses
      }`}
    >
      {label}
    </button>
  );
}
