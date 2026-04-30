import { z } from 'zod';

/**
 * SimBriefOverlay — the typed shape of per-entity SimBrief parameter
 * overrides used by the inheritance pipeline.
 *
 * Each of Airline / Fleet / Aircraft / Route stores an optional Json
 * column matching this schema. At dispatch time we resolve the four
 * layers into a single overlay (lower-precedence first → higher
 * spreads on top) and merge it into the SimBrief form/URL parameters.
 *
 * Why JSON-column instead of flat columns? Three reasons:
 * - SimBrief's parameter set evolves; new fields shouldn't require
 *   migrations.
 * - Most overrides are sparse (an Aircraft might only override one or
 *   two fields), and JSON natively handles "set this, leave the rest".
 * - We never query "all aircraft with contpct > 5" — we always
 *   read an entity's full overlay together, so we don't lose any
 *   useful indexability.
 *
 * Trade-off: no FK validation on values. Mitigated by Zod-validating
 * on every read via `parseSimBriefOverlay()` so corrupt rows fail
 * loud rather than silently propagating bad params to SimBrief.
 *
 * Field naming: matches SimBrief's canonical API parameter names 1:1
 * (verified against the `<api_params>` block of a real OFP XML during
 * Day-4 implementation — the doc's prose used different names like
 * `pax_count` and `cont_fuel_pct` which SimBrief silently ignores).
 * The resolved overlay is mapped directly into URLSearchParams without
 * per-field translation.
 *
 * Field grouping (for the human eye, not enforced):
 * - performance:  ofp_layout
 * - pax/cargo:    pax, cargo, manualpayload, manualzfw
 * - fuel:         contpct, resvrule, melfuel(+units), atcfuel(+units),
 *                 addedfuel(+units), tankering, taxifuel, fuelfactor
 * - routing:      altn, fl, route, origrwy, destrwy
 * - taxi:         taxiout, taxiin
 *
 * Future fields can be appended without migrations. If a value comes
 * through that this schema doesn't recognise, Zod's default behaviour
 * would strip it — which is fine, the future addition just needs a
 * schema bump to start being honoured.
 */
export const SimBriefOverlaySchema = z
  .object({
    // — Performance / OFP —
    /** SimBrief OFP layout name (e.g. 'LIDO', 'ATPL', 'CFP'). */
    ofp_layout: z.string().min(1).max(40).optional(),

    // — Pax / Cargo —
    /**
     * Passenger count. SimBrief default is 'auto' which uses the
     * aircraft type's typical pax (A320: ~123, A359: ~325, etc).
     */
    pax: z.number().int().min(0).max(999).optional(),
    /** Cargo weight in kg. */
    cargo: z.number().int().min(0).max(999999).optional(),
    /** Manual payload override (kg) — bypasses SimBrief's pax-derived calc. */
    manualpayload: z.number().int().min(0).max(999999).optional(),
    /** Manual zero-fuel-weight override (kg). */
    manualzfw: z.number().int().min(0).max(999999).optional(),

    // — Fuel policies —
    /**
     * Contingency fuel as a percentage (0-99). SimBrief default is
     * 'auto' which derives from the aircraft's perf code. ICAO
     * recommends min 5%.
     */
    contpct: z.number().min(0).max(99).optional(),
    /**
     * Final reserve fuel rule. Values: 'auto' (use perf-default),
     * '@FAR' (FAR91), 'I50' (international 50min), 'D45' (domestic
     * 45min), 'F30' (final 30min), or a numeric string in minutes.
     */
    resvrule: z.string().min(1).max(20).optional(),
    /** MEL/CDL fuel uplift. */
    melfuel: z.number().int().min(0).max(99999).optional(),
    /** Units for melfuel: 'kgs' or 'lbs'. */
    melfuel_units: z.enum(['kgs', 'lbs']).optional(),
    /** ATC fuel allowance (always in minutes — no _units variant). */
    atcfuel: z.number().int().min(0).max(999).optional(),
    /** Extra fuel uplift (operational discretion). */
    addedfuel: z.number().int().min(0).max(99999).optional(),
    /** Units for addedfuel. */
    addedfuel_units: z.enum(['kgs', 'lbs']).optional(),
    /** Tankering — 1 to enable, 0 to disable. */
    tankering: z.union([z.literal(0), z.literal(1)]).optional(),
    /** Taxi-out fuel time (minutes). Default 20 min. */
    taxiout: z.number().int().min(0).max(999).optional(),
    /** Taxi-in fuel time (minutes). Default 8 min. */
    taxiin: z.number().int().min(0).max(999).optional(),
    /** Total taxi fuel override (kg). 0 = use taxiout+taxiin defaults. */
    taxifuel: z.number().int().min(0).max(99999).optional(),
    /**
     * Fuel multiplier (e.g. 1.0 = nominal, 1.05 = +5% across the board).
     * Used for conservative dispatch profiles or specific ops.
     */
    fuelfactor: z.number().min(0.5).max(2.0).optional(),

    // — Routing —
    /** Preferred alternate ICAO. */
    altn: z.string().regex(/^[A-Z]{4}$/).optional(),
    /** Cruise flight level (e.g. 350 for FL350). 0 / unset = auto. */
    fl: z.number().int().min(0).max(50000).optional(),
    /** Custom route string. Empty string = auto-route. */
    route: z.string().min(1).max(2000).optional(),
    /** Departure runway. */
    origrwy: z.string().min(1).max(10).optional(),
    /** Arrival runway. */
    destrwy: z.string().min(1).max(10).optional(),
  })
  // .strict() would reject unknown fields; we use the default ('strip')
  // so future SimBrief params written by a newer schema version don't
  // crash an older deployment that hasn't been updated yet. Forward
  // compatibility wins over fail-loud here.
  ;

export type SimBriefOverlay = z.infer<typeof SimBriefOverlaySchema>;

/**
 * Parse an unknown JSON value (typed as `Prisma.JsonValue` from the DB)
 * into a validated SimBriefOverlay. Returns an empty object on:
 * - null/undefined input (entity has no overlay set)
 * - parse failure (corrupt or schema-mismatched data — logs warning
 *   but does not throw, because a single corrupt overlay row should
 *   not prevent dispatch)
 *
 * The empty-object fallback is safe for the inheritance spread: a
 * level with no overlay simply contributes nothing to the merge.
 */
export function parseSimBriefOverlay(json: unknown): SimBriefOverlay {
  if (json === null || json === undefined) return {};
  const parsed = SimBriefOverlaySchema.safeParse(json);
  if (!parsed.success) {
    // Surface the parse failure so corrupt overlays in production are
    // visible in logs, but don't propagate — return empty so dispatch
    // can fall back to whichever level still has a valid value (or
    // SimBrief's own defaults if no level has it).
    console.warn(
      '[SimBriefOverlay] parse failure, ignoring overlay:',
      parsed.error.issues,
    );
    return {};
  }
  return parsed.data;
}

/**
 * Inheritance resolver — merges the four layers into a single overlay
 * with later (more-specific) layers winning on key conflicts.
 *
 * Precedence order (lowest first → highest last):
 *   Airline-default → Fleet-default → Aircraft-override → Route-override
 *
 * This matches how virtual airline back-offices typically conceptualise
 * defaults: an airline-wide policy (e.g. 'all our flights compute
 * cont_fuel at 5%') sets the floor; fleet-level ('all our A320s use
 * the LIDO layout') refines per type; per-airframe ('this specific
 * D-AIBL has reduced MTOW because of MEL') refines further; per-route
 * ('the cargo run to LFPG carries 0 pax') is the most specific.
 *
 * Spread semantics: object-spread overwrites on key collision. Keys
 * with `undefined` values from upstream do NOT erase downstream values
 * because `undefined` properties are NOT enumerated by spread — only
 * KEYS that exist in the layer's overlay actually get applied. This
 * is the correct behaviour: an upstream layer "doesn't care" about a
 * field by simply not setting it.
 *
 * @example
 *   resolveSimBriefOverlay(
 *     { contpct: 5 },                  // airline: 5% floor
 *     { ofp_layout: 'LIDO' },          // fleet: LIDO layout for this type
 *     { melfuel: 200,                  // aircraft: this airframe MEL
 *       melfuel_units: 'kgs' },
 *     { contpct: 8, pax: 0 },          // route: cargo, 0 pax
 *   )
 *   // → { contpct: 8, ofp_layout: 'LIDO', melfuel: 200,
 *   //     melfuel_units: 'kgs', pax: 0 }
 */
export function resolveSimBriefOverlay(
  airline: SimBriefOverlay | null | undefined,
  fleet: SimBriefOverlay | null | undefined,
  aircraft: SimBriefOverlay | null | undefined,
  route: SimBriefOverlay | null | undefined,
): SimBriefOverlay {
  return {
    ...(airline ?? {}),
    ...(fleet ?? {}),
    ...(aircraft ?? {}),
    ...(route ?? {}),
  };
}

/**
 * Map a resolved SimBriefOverlay onto a `URLSearchParams` (for Pattern α
 * dispatch URLs) or an array of form-fields (for Pattern Z hidden inputs).
 *
 * The translation is identity — overlay keys ARE SimBrief param names —
 * with one type-coercion: numbers stringified via `String()`. Tankering
 * is already 0|1 in the schema (matching SimBrief's wire format), so
 * no boolean conversion needed.
 *
 * Skips `undefined` values silently (they came from layers that didn't
 * set the field).
 *
 * Returns a flat list of [name, value] tuples that callers append to
 * either a URLSearchParams or a form-fields array.
 */
export function overlayToParams(
  overlay: SimBriefOverlay,
): readonly (readonly [string, string])[] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    out.push([key, String(value)]);
  }
  return out;
}
