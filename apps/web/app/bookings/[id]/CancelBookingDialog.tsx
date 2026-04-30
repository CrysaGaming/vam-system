'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelBooking } from '../actions';

type Props = {
  bookingId: string;
  /**
   * Flight identifier shown in the dialog so the user can verify they're
   * cancelling the booking they meant to. We pass `flightNumber` rather
   * than the booking-id because cuids are not human-recognisable.
   */
  flightNumber: string;
};

/**
 * Cancel-Booking dialog.
 *
 * Renders a "Buchung stornieren" trigger button. On click, opens a
 * confirmation dialog with an optional `reason` textarea (server-side
 * cap is 500 chars; we surface a remaining-characters counter so the
 * user knows the limit before they hit it).
 *
 * The cancellation is destructive (state transitions to Cancelled) but
 * NOT actually irreversible at the database level — `cancelledAt` and
 * `cancellationReason` are just additional fields, the booking row stays.
 * Still, the convention in the rest of the app treats Cancelled as a
 * terminal state (no Refresh, no Plan-again, the booking detail page
 * shows the OFP muted), so we treat the action as one-way for the user.
 *
 * On success, we router.refresh() to re-fetch the now-cancelled booking
 * and let the server-component re-render with the new state. We don't
 * navigate away — the user might want to see the cancelled booking's
 * preserved OFP (which the muted OfpSummary will show).
 */
export function CancelBookingDialog({ bookingId, flightNumber }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const trimmedReason = reason.trim();
  const remaining = 500 - trimmedReason.length;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await cancelBooking({
          bookingId,
          reason: trimmedReason.length > 0 ? trimmedReason : undefined,
        });
        // router.refresh() re-fetches the server component without a full
        // navigation — the booking row reloads with state=Cancelled and
        // the page re-renders the muted/read-only variant.
        setOpen(false);
        router.refresh();
      } catch (err) {
        // The server-action throws plain Error for state-guard failures
        // and ownership-mismatches. Surface the message verbatim — they're
        // already short and human-readable (e.g. "Cannot cancel booking
        // in state Completed").
        setError(err instanceof Error ? err.message : 'Stornierung fehlgeschlagen');
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded text-sm transition"
      >
        Buchung stornieren
      </button>
    );
  }

  return (
    // Modal overlay. Click outside the dialog body closes the dialog
    // (without submitting). The actual dialog uses stopPropagation to
    // not bubble the click up to the overlay.
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={() => !isPending && setOpen(false)}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-lg p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-2">Buchung stornieren?</h3>
        <p className="text-sm text-gray-400 mb-4">
          Buchung{' '}
          <span className="font-mono text-gray-200">{flightNumber}</span> wird
          auf den Status <span className="text-red-400">Storniert</span>{' '}
          gesetzt. Die Buchung bleibt in der Liste sichtbar, du kannst aber
          keinen Flight Plan mehr generieren oder einen PIREP filen.
        </p>

        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-2">
          Stornierungsgrund (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="z.B. Zeitplan-Konflikt, falsches Routing, ..."
          disabled={isPending}
          maxLength={500}
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50 mb-1"
        />
        <p className="text-xs text-gray-500 text-right mb-4">
          {remaining} Zeichen übrig
        </p>

        {error && (
          <p className="text-sm text-red-400 mb-4 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm transition disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-sm font-medium transition"
          >
            {isPending ? 'Stornieren...' : 'Stornieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
