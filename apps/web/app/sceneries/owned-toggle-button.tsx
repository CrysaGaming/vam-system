'use client';

/**
 * Track 4 #17 — Owned-toggle button für scenery-cards.
 *
 * Pilot klickt → optimistic-update flippt das badge sofort, dann hits
 * /api/sceneries/[id]/toggle-owned, dann router.refresh() für die
 * server-seitig gerenderte page (counts + filtered-list aktualisieren
 * sich falls "owned=mine"-filter aktiv ist).
 *
 * # Optimistic-update + correction
 *
 * Bei click: state lokal flippen sofort. Wenn server eine ANDERE owned-
 * value zurückgibt (sehr selten — concurrent-tab-toggle), korrigieren
 * wir auf den server-state. Failure (network-error etc.): revertieren
 * auf den ursprünglichen state und zeigen einen alert.
 *
 * # event.preventDefault + stopPropagation
 *
 * Der button liegt INSIDE einer <Link>-card. Ohne preventDefault würde
 * ein click sowohl den toggle ausführen als auch zur detail-page navigieren.
 * stopPropagation verhindert dass parent-handlers den click sehen.
 *
 * # useTransition statt useState für loading
 *
 * router.refresh() startet einen react-transition; useTransition isPending
 * gibt uns den loading-state ohne extra useState. Nice-to-have: wenn
 * mehrere toggles in flight sind, sieht der user dass refresh läuft.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function OwnedToggleButton({
  sceneryId,
  initialOwned,
}: {
  sceneryId: string;
  initialOwned: boolean;
}) {
  const [owned, setOwned] = useState(initialOwned);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    // Optimistic flip
    const previousOwned = owned;
    setOwned(!previousOwned);

    try {
      const res = await fetch(`/api/sceneries/${sceneryId}/toggle-owned`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { owned: boolean } = await res.json();
      // Correction wenn server uns einen abweichenden state liefert
      // (z.B. concurrent toggle in einem anderen tab).
      if (data.owned !== !previousOwned) {
        setOwned(data.owned);
      }
      // Server-rendered counts/filtered-list refreshen
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      // Revert + user-feedback
      console.error('Toggle owned failed:', err);
      setOwned(previousOwned);
      alert('Toggle fehlgeschlagen. Bitte erneut versuchen.');
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={[
        'shrink-0 text-xs px-2 py-0.5 rounded font-medium transition disabled:opacity-50',
        owned
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:text-amber-800 dark:hover:text-amber-200',
      ].join(' ')}
      aria-pressed={owned}
      aria-label={owned ? 'Markierung "Habe ich" entfernen' : 'Als "Habe ich" markieren'}
      title={owned ? 'Markiert als "Habe ich" — Klick zum Entfernen' : 'Klick um als "Habe ich" zu markieren'}
    >
      {owned ? '✓ Habe ich' : '+ Markieren'}
    </button>
  );
}
