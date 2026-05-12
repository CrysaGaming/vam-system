'use server';

/**
 * Track 5 #17 (Section D) — Quick-Book server-action.
 *
 * Wrapper über die existierende createBooking()-action für den
 * "Buchen"-button in der Route-Suggester-section. Statt mit der inline
 * submitBooking()-server-action der page (die FormData braucht) ziehen
 * wir hier die clean-typed createBooking() direkt — kein FormData-roundtrip,
 * nur eine simple bind()-aufruf vom UI.
 *
 * Bei error: createBooking wirft (kein active-booking, nicht in eigener
 * airline, career-gate-fail). Der throw landet im Next.js error-boundary
 * der page — UX hier ist "redirect on success, error-page on failure".
 * Bei V2 könnte ein toast-notification-system das schöner machen.
 */

import { redirect } from 'next/navigation';
import { createBooking } from '../actions';

export async function quickBookFromSuggestion(routeId: string) {
  const booking = await createBooking({ routeId });
  redirect(`/bookings/${booking.id}`);
}
