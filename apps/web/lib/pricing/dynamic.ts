/**
 * Welle M / M1 — Dynamic pricing for routes.
 *
 * # Konzept
 *
 * Pilot-payouts für completed routes waren bisher static (route-template
 * setzt einen fixed-payout im booking-flow). V2 berechnet das dynamisch
 * basierend auf:
 *
 *   1. Base-preis aus distance (linear-formel mit floor + ceiling)
 *   2. Demand-multiplier: routes mit hoher buchung-frequenz in letzten 7d
 *      bekommen höhere payouts (incentive für underutilized routes wäre
 *      umgekehrt — V2 macht das einfach so, V3 könnte invertieren)
 *   3. Airline-modifier: admin-controlled per-route override (z.B. 1.5x
 *      für "premium business route")
 *
 * # Design rationale
 *
 * Pure-function, kein DB-access — caller (im server-action context)
 * holt die demand-signals selbst und ruft computeRoutePrice() auf.
 * Das macht das ding trivial unit-testbar.
 *
 * Persistenz via RoutePriceSnapshot ist OPT-IN — caller entscheidet
 * ob snapshot gespeichert wird (z.B. nach jeder pricing-änderung,
 * oder via cron-job alle paar stunden).
 */

export type PriceInput = {
  distanceNm: number;
  bookings7d: number;
  airlineModifier?: number; // default 1.0
  /** Global average bookings/7d across airline für demand-normalisation. */
  averageBookings7d?: number;
};

export type PriceResult = {
  basePrice: number;
  demandMultiplier: number;
  airlineModifier: number;
  finalPrice: number;
  bookings7d: number;
};

/**
 * Computes the dynamic payout-price for a route.
 *
 * Formel:
 *   basePrice = 500 + (distanceNm × 8)  -- floor 500, slope 8 VAM$/NM
 *   basePrice = clamp(basePrice, 500, 25000)  -- ceiling für super-long-haul
 *   demandMultiplier = clamp(bookings7d / averageBookings7d, 0.5, 2.0)
 *     -- "rare route" = 0.5x, "popular route" = 2.0x
 *   airlineModifier = caller-provided (default 1.0)
 *   finalPrice = round(basePrice × demandMultiplier × airlineModifier)
 */
export function computeRoutePrice(input: PriceInput): PriceResult {
  const {
    distanceNm,
    bookings7d,
    airlineModifier = 1.0,
    averageBookings7d,
  } = input;

  // Base price linear in distance, with floor + ceiling
  let basePrice = 500 + distanceNm * 8;
  basePrice = Math.max(500, Math.min(25000, basePrice));

  // Demand multiplier: ratio of this route's bookings to airline average.
  // Wenn keine average angegeben oder 0, default neutral.
  let demandMultiplier = 1.0;
  if (averageBookings7d && averageBookings7d > 0) {
    demandMultiplier = bookings7d / averageBookings7d;
    demandMultiplier = Math.max(0.5, Math.min(2.0, demandMultiplier));
  }

  // Round to nearest 1 VAM$
  const finalPrice = Math.round(
    basePrice * demandMultiplier * airlineModifier,
  );

  return {
    basePrice: Math.round(basePrice),
    demandMultiplier: Number(demandMultiplier.toFixed(3)),
    airlineModifier: Number(airlineModifier.toFixed(3)),
    finalPrice,
    bookings7d,
  };
}

/**
 * Formatiert preis-resultat für UI-display.
 *
 * Returnt ein human-readable breakdown wie:
 *   "Base 4500 VAM$ × 1.250 demand × 1.000 modifier = 5625 VAM$"
 */
export function formatPriceBreakdown(p: PriceResult): string {
  return `Base ${p.basePrice.toLocaleString('de-DE')} VAM$ × ${p.demandMultiplier} demand × ${p.airlineModifier} modifier = ${p.finalPrice.toLocaleString('de-DE')} VAM$`;
}
