const BASE_URL = 'https://dispatch.simbrief.com/options/custom';

export interface BuildDispatchUrlInput {
  bookingId: string;
  airline: { icao: string };
  route: { flightNumber: string };
  aircraft: { type: string; registration: string };
  departure: { icao: string };
  arrival: { icao: string };
  user: { name: string | null };
}

/**
 * SimBrief Dispatch-URL builder for Pattern α.
 *
 * Generates the user-facing dispatch URL for simbrief.com. The user clicks
 * the link on the Booking-Detail-Page, lands on SimBrief with prefilled form
 * fields, generates the OFP, then returns to VAM. Pattern α uses no API key —
 * the dispatch-redirect URL is auth-free.
 *
 * static_id follows the pattern `vam-<bookingId>` and matches the validation
 * in captureSimBriefOfp (apps/web/app/bookings/actions.ts) — defense-in-depth
 * against mixed-up ofpIds.
 *
 * Deferred to Phase 2 (Override-Hierarchie):
 * - deph/depm/dxp: Booking has no scheduledDeparture field yet.
 * - pax/cargo, fuel policies, ICAO equipment, PBN: per Aircraft/Fleet/Airline.
 * - route (routing string): Route model has no routing field yet.
 *
 * @example
 * buildSimBriefDispatchUrl({
 *   bookingId: 'cl9abc',
 *   airline: { icao: 'DLH' },
 *   route: { flightNumber: '400' },
 *   aircraft: { type: 'A320', registration: 'D-AIQA' },
 *   departure: { icao: 'EDDF' },
 *   arrival: { icao: 'EGLL' },
 *   user: { name: 'Kevin Drack' },
 * })
 * // → ".../options/custom?airline=DLH&fltnum=400&type=A320&orig=EDDF&dest=EGLL&reg=D-AIQA&cpt=Kevin+Drack&static_id=vam-cl9abc"
 */
export function buildSimBriefDispatchUrl(input: BuildDispatchUrlInput): string {
  const params = new URLSearchParams();
  params.set('airline', input.airline.icao);
  params.set('fltnum', input.route.flightNumber);
  params.set('type', input.aircraft.type);
  params.set('orig', input.departure.icao);
  params.set('dest', input.arrival.icao);
  params.set('reg', input.aircraft.registration);
  if (input.user.name) {
    params.set('cpt', input.user.name);
  }
  params.set('static_id', `vam-${input.bookingId}`);

  return `${BASE_URL}?${params.toString()}`;
}
