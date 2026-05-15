/**
 * Welle M / M5 — VAMSE stock pricing.
 *
 * # Konzept
 *
 * Aktien-preis einer airline schwankt mit ihrer "performance" in den
 * letzten 7 tagen. Performance-signals:
 *
 *   - pireps7d (anzahl approved PIREPs)
 *   - totalRevenue7d (VAM$-inflow auf airline-wallet)
 *   - activePilots7d (distinct pilots mit pireps)
 *
 * # Formel
 *
 *   activityScore  = pireps7d × 1.0 + activePilots7d × 5.0
 *   revenueScore   = log10(max(1, totalRevenue7d / 1000))
 *                    -- 0 bei 0$, 1 bei 10k$, 2 bei 100k$, 3 bei 1M$
 *   rawPrice       = activityScore × 0.5 + revenueScore × 20
 *                    + airline-age-bonus
 *   price = clamp(rawPrice + 1.00, 0.10, 10000.00)
 *
 * Floor 0.10: keine ganz-billig-aktien (sieht doof aus).
 * Ceiling 10000: sehr aktive große airlines können hoch klettern.
 *
 * Bewusst keine random-noise — preis ist deterministisch reproduzierbar
 * aus den input-signals. Spekulation entsteht durch echte airline-
 * performance, nicht durch market-noise (V2-feature wenn überhaupt).
 */

export type VamsePriceInput = {
  pireps7d: number;
  activePilots7d: number;
  totalRevenue7d: number; // VAM$
  airlineAgeDays: number;
};

export const VAMSE_MIN_PRICE = 0.1;
export const VAMSE_MAX_PRICE = 10000;
export const VAMSE_TOTAL_SHARES = 1000;

/**
 * Compute the current price-per-share for an airline based on its
 * 7-day performance signals.
 */
export function computeVamsePrice(input: VamsePriceInput): number {
  const { pireps7d, activePilots7d, totalRevenue7d, airlineAgeDays } = input;

  const activityScore = pireps7d * 1.0 + activePilots7d * 5.0;
  const revenueScore = Math.log10(Math.max(1, totalRevenue7d / 1000));

  // Age-bonus: junge airlines starten niedrig, gewachsene haben einen
  // base-floor. Begrenzt auf 5.0 nach 1 jahr.
  const ageBonus = Math.min(5, airlineAgeDays / 73); // 73d = ~5 nach 1y

  const rawPrice = activityScore * 0.5 + revenueScore * 20 + ageBonus + 1.0;

  return Math.max(
    VAMSE_MIN_PRICE,
    Math.min(VAMSE_MAX_PRICE, Math.round(rawPrice * 10000) / 10000),
  );
}

/**
 * Format price-input für transparency-display.
 */
export function formatPriceInputs(input: VamsePriceInput): string {
  return `${input.pireps7d} pireps × ${input.activePilots7d} pilots · ${Math.round(input.totalRevenue7d).toLocaleString('de-DE')} VAM$ revenue · airline ${input.airlineAgeDays}d alt`;
}
