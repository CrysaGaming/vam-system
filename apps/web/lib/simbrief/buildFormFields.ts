/**
 * SimBrief Pattern Z form-fields builder.
 *
 * Where Pattern α encodes the dispatch parameters into a URL for a full-tab
 * redirect (see buildDispatchUrl.ts), Pattern Z submits them via a hidden
 * `<form id="sbapiform">` whose inputs are read by the vendored
 * `simbrief.apiv1.js` and posted to SimBrief's popup worker. Both patterns
 * carry the same flight semantics — only the wire format differs.
 *
 * The shape of the input mirrors buildSimBriefDispatchUrl exactly so the
 * Booking-Detail-Page can construct one object and feed it to either
 * builder depending on which pattern is active.
 *
 * `static_id` is set to `vam-<bookingId>` — same convention as Pattern α —
 * so processSimBriefCallback can validate the OFP returned via the popup
 * really belongs to this booking and not a recycled ofpId from elsewhere.
 */
export interface BuildFormFieldsInput {
  bookingId: string;
  airline: { icao: string };
  route: { flightNumber: string };
  aircraft: { type: string; registration: string };
  departure: { icao: string };
  arrival: { icao: string };
  user: { name: string | null };
  // Optional. Wenn gesetzt, propagieren wir Datum + UTC-Zeit als
  // SimBrief-Form-Defaults (date, deph, depm) — siehe buildDispatchUrl
  // für die Pattern-α-Variante.
  scheduledDeparture?: Date | null;
}

export interface SimBriefFormField {
  name: string;
  value: string;
}

/**
 * Builds the array of hidden `<input>` configs needed by the
 * `<form id="sbapiform">` on a dispatch page.
 *
 * The required minimum per the Partner-API README is `orig`, `dest`, `type`.
 * Everything else is optional and falls back to SimBrief defaults; we
 * include the same set of identifying fields as Pattern α (airline, fltnum,
 * reg, captain, static_id) so VA-side post-processing can match on them.
 *
 * @example
 * const fields = buildSimBriefFormFields({
 *   bookingId: 'cl9abc',
 *   airline: { icao: 'DLH' },
 *   route: { flightNumber: '400' },
 *   aircraft: { type: 'A320', registration: 'D-AIQA' },
 *   departure: { icao: 'EDDF' },
 *   arrival: { icao: 'EGLL' },
 *   user: { name: 'Kevin Drack' },
 * });
 * // → [{ name: 'orig', value: 'EDDF' }, { name: 'dest', value: 'EGLL' }, …]
 */
export function buildSimBriefFormFields(
  input: BuildFormFieldsInput,
): readonly SimBriefFormField[] {
  const fields: SimBriefFormField[] = [
    { name: 'orig', value: input.departure.icao },
    { name: 'dest', value: input.arrival.icao },
    { name: 'type', value: input.aircraft.type },
    { name: 'airline', value: input.airline.icao },
    { name: 'fltnum', value: input.route.flightNumber },
    { name: 'reg', value: input.aircraft.registration },
    { name: 'static_id', value: `vam-${input.bookingId}` },
  ];

  if (input.user.name) {
    fields.push({ name: 'cpt', value: input.user.name });
  }

  if (input.scheduledDeparture) {
    const dep = input.scheduledDeparture;
    // UTC components — SimBrief expects Zulu time
    const yyyy = dep.getUTCFullYear();
    const mm = String(dep.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dep.getUTCDate()).padStart(2, '0');
    const hh = String(dep.getUTCHours()).padStart(2, '0');
    const min = String(dep.getUTCMinutes()).padStart(2, '0');
    fields.push({ name: 'date', value: `${yyyy}-${mm}-${dd}` });
    fields.push({ name: 'deph', value: hh });
    fields.push({ name: 'depm', value: min });
  }

  return fields;
}
