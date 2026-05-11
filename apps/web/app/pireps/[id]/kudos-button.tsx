'use client';

import { useState, useTransition } from 'react';
import { togglePirepKudos } from '../actions';

/**
 * Track 4 #60 (Section L): Kudos-Button für PIREP-detail page.
 *
 * Zwei modi:
 *   - Eigener PIREP: button disabled mit "Eigener Flug" hint (kein self-
 *     kudos möglich). Count wird trotzdem angezeigt damit der pilot
 *     seine empfangenen kudos sieht.
 *   - Fremder PIREP: button toggleable. Optimistic UI: state-update sofort
 *     beim klick, server-roundtrip gleichzeitig. Bei error revert auf
 *     vorherigen state + show error-message.
 *
 * Visuell:
 *   - given=false: outlined button, "👏 N" anzeige
 *   - given=true: gefüllter button mit indigo-bg, "👏 N (Du)" anzeige
 *   - pending=true: opacity-50 + cursor-wait während transition
 *
 * Self-kudo-block redundant — server enforced auch, aber wir disablen
 * im UI damit der pilot gar nicht erst klicken kann.
 */
export function KudosButton({
  pirepId,
  initialCount,
  initialGiven,
  isOwn,
}: {
  pirepId: string;
  initialCount: number;
  initialGiven: boolean;
  isOwn: boolean;
}) {
  const [count, setCount] = useState(initialCount);
  const [given, setGiven] = useState(initialGiven);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (isOwn || pending) return;

    // Optimistic update: immediately flip state + adjust count.
    // Bei error revert wir das in catch.
    const prevGiven = given;
    const prevCount = count;
    setGiven(!prevGiven);
    setCount(prevCount + (prevGiven ? -1 : 1));
    setError(null);

    startTransition(async () => {
      try {
        const result = await togglePirepKudos(pirepId);
        // Sync to authoritative server-state. Sollte mit unserem
        // optimistic-state matchen, aber sicherheits-halber überschreiben.
        setGiven(result.given);
        setCount(result.count);
      } catch (e) {
        // Revert auf vorherigen state. Error-message anzeigen.
        setGiven(prevGiven);
        setCount(prevCount);
        setError(e instanceof Error ? e.message : 'Konnte Kudos nicht setzen.');
      }
    });
  }

  if (isOwn) {
    return (
      <div className="inline-flex items-center gap-2">
        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 cursor-not-allowed"
          title="Eigener Flug — Du kannst dir nicht selbst einen Kudos geben."
        >
          <span className="text-lg">👏</span>
          <span className="font-mono tabular-nums text-sm">{count}</span>
          <span className="text-xs text-gray-500 dark:text-gray-500">erhalten</span>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col gap-1 items-start">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={given}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border transition disabled:cursor-wait ${
          given
            ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700 hover:border-indigo-700'
            : 'border-gray-300 dark:border-gray-700 hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-gray-700 dark:text-gray-300'
        } ${pending ? 'opacity-50' : ''}`}
      >
        <span className="text-lg">👏</span>
        <span className="font-mono tabular-nums text-sm">{count}</span>
        {given && <span className="text-xs">✓ Du</span>}
      </button>
      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
