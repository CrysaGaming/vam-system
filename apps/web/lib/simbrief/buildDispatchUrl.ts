import { type SimBriefOverlay, overlayToParams } from './overlay';

const BASE_URL = 'https://dispatch.simbrief.com/options/custom';

export interface BuildDispatchUrlInput {
  bookingId: string;
  airline: { icao: string };
  route: { flightNumber: string };
  aircraft: { type: string; registration: string };
  departure: { icao: string };
  arrival: { icao: string };
  user: { name: string | null };
  // Optional. Wenn gesetzt, propagieren wir Datum + UTC-Zeit als
  // SimBrief-Form-Defaults (date, deph, depm). User kann auf der
  // SimBrief-Page noch override; das ist Form-prefill, kein lock.
  scheduledDeparture?: Date | null;
  // Optional resolved overlay from the Override-Hierarchie. When present,
  // its key/value pairs are appended to the URL params after the
  // identifying fields above — so any conflict between hierarchy-resolved
  // fields and the identifying ones (which shouldn't happen because the
  // overlay schema uses different keys) would let the overlay win. In
  // practice the schemas are disjoint: overlay covers performance/fuel/
  // weights/alternates, identifying covers airline+route+date+id.
  overlay?: SimBriefOverlay;
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
 * Departure scheduling: when `scheduledDeparture` is set, we forward
 * `date` (YYYY-MM-DD), `deph` (UTC hour 0-23) and `depm` (UTC minute 0-59)
 * as SimBrief form-prefill. The User can still adjust on the SimBrief
 * options page before generating — this is a default, not a lock.
 * SimBrief's own time-handling expects UTC ("Zulu") values for deph/depm,
 * which is convenient because our DB stores DateTime in UTC anyway.
 *
 * Deferred to Phase 2:
 * - dxp (dispatch extra fuel buffer): different concept (fuel-time, not
 *   schedule-time), per-Aircraft/Airline rather than per-Booking.
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
 *   scheduledDeparture: new Date('2026-05-01T14:30:00Z'),
 * })
 * // → ".../options/custom?airline=DLH&fltnum=400&type=A320&orig=EDDF&dest=EGLL&reg=D-AIQA&cpt=Kevin+Drack&date=2026-05-01&deph=14&depm=30&static_id=vam-cl9abc"
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

  if (input.scheduledDeparture) {
    const dep = input.scheduledDeparture;
    // Date components in UTC — SimBrief expects Zulu time
    const yyyy = dep.getUTCFullYear();
    const mm = String(dep.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dep.getUTCDate()).padStart(2, '0');
    const hh = String(dep.getUTCHours()).padStart(2, '0');
    const min = String(dep.getUTCMinutes()).padStart(2, '0');
    params.set('date', `${yyyy}-${mm}-${dd}`);
    params.set('deph', hh);
    params.set('depm', min);
  }

  params.set('static_id', `vam-${input.bookingId}`);

  // Override-Hierarchie params last → they win on key collision via
  // URLSearchParams.set semantics. Identifier keys above (airline,
  // fltnum, etc) are disjoint from overlay keys (cont_fuel_pct, units,
  // etc), so collision is theoretical, but keeping override-precedence
  // explicit makes future schema additions (e.g. an overlay-controlled
  // 'fltnum' suffix) safe by default.
  if (input.overlay) {
    for (const [key, value] of overlayToParams(input.overlay)) {
      params.set(key, value);
    }
  }

  return `${BASE_URL}?${params.toString()}`;
}
