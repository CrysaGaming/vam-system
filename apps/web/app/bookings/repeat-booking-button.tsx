'use client';

import { useTransition, useState } from 'react';
import { cloneBooking } from './actions';
import { useRouter } from 'next/navigation';

/**
 * Track 4 #66 (Section M): "Fly This Again" Quick-Repeat Button.
 *
 * Inline quick-action button für die bookings-list (Completed-section).
 * Klont das booking via cloneBooking() server-action und redirected zu
 * /bookings/[newId] sodass der pilot direkt im neuen booking weiter-
 * arbeiten kann (SimBrief-dispatch etc.).
 *
 * Edge-cases die der server-action throws:
 *   - "active-booking-guard": user hat schon ein offenes booking →
 *     wir zeigen einen toast-style error-pill inline
 *   - generic error: error-message als pill
 *
 * useTransition für loading-state ("Klont…"), event.stopPropagation()
 * verhindert dass der outer-Link-wrapper (zur detail-page) parallel
 * getriggert wird wenn user den button klickt.
 */
export function RepeatBookingButton({ bookingId }: { bookingId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    startTransition(async () => {
      try {
        const result = await cloneBooking({ bookingId });
        router.push(`/bookings/${result.id}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Konnte nicht klonen',
        );
      }
    });
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setError(null);
        }}
        className="text-xs px-2 py-1 rounded bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-950/80 transition whitespace-nowrap"
        title={error}
      >
        ✕ {error.length > 28 ? error.slice(0, 25) + '…' : error}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-xs px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-950/70 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap font-medium"
      title="Diesen Flug noch einmal als neues Booking erstellen"
    >
      {pending ? 'Klont…' : '🔁 Wiederholen'}
    </button>
  );
}
