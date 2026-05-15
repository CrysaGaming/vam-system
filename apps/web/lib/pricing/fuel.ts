/**
 * Welle M / M3 — Fuel price helpers.
 *
 * Read-side: gegeben eine ICAO (departure-airport) und airline, returne
 * den price-per-gallon. Wenn kein eintrag → null (caller default-logik).
 *
 * Compute-side: fuelCostVam = fuelGallons × pricePerGallon.
 *
 * # Future integration points
 *
 * V1: Diese helper sind standalone. V2 könnte:
 *   - PIREP-approval: nach final-block-fuel-reading einen
 *     EXPENSE_FUEL transaction automatisch buchen
 *   - Booking-flow: estimated-fuel-cost display in der confirmation
 *   - Route-pricing (M1): fuel-cost als negativer adjustment in
 *     finalPrice einbauen
 */

import { prisma } from '@vam/db';

export type FuelPriceLookup = {
  icao: string;
  pricePerGallon: number;
  note: string | null;
};

/**
 * Holt den fuel-price für eine ICAO + airline-kombi.
 *
 * Returns null wenn nicht gesetzt — caller muss damit umgehen
 * (fallback to default oder error).
 */
export async function getFuelPriceForIcao(
  airlineId: string,
  icao: string,
): Promise<FuelPriceLookup | null> {
  const normalized = icao.trim().toUpperCase();
  const row = await prisma.airportFuelPrice.findUnique({
    where: { airlineId_icao: { airlineId, icao: normalized } },
    select: { icao: true, pricePerGallon: true, note: true },
  });
  if (!row) return null;
  return {
    icao: row.icao,
    pricePerGallon: parseFloat(row.pricePerGallon.toString()),
    note: row.note,
  };
}

/**
 * Compute fuel cost in VAM$ for a given gallon-amount + airport.
 *
 * Returns null wenn kein price für die ICAO gesetzt ist.
 */
export async function computeFuelCost(
  airlineId: string,
  icao: string,
  fuelGallons: number,
): Promise<{ cost: number; price: number } | null> {
  if (fuelGallons <= 0) return { cost: 0, price: 0 };
  const lookup = await getFuelPriceForIcao(airlineId, icao);
  if (!lookup) return null;
  const cost = Math.round(fuelGallons * lookup.pricePerGallon * 100) / 100;
  return { cost, price: lookup.pricePerGallon };
}
