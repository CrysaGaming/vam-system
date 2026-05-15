/**
 * Welle M / M4 — Cargo flight helpers.
 *
 * Compute payout-multiplier für eine CARGO-PIREP. Default 1.3x wenn
 * keine CargoLoadSpec gesetzt; mit spec der konfigurierte multiplier.
 *
 * # Future integration
 *
 * V2: PIREP-approval-flow checkt flightType=CARGO und applyt das
 * multiplier auf den basispayout. V1 hat den helper standalone für
 * route-list-UI.
 */

import { prisma } from '@vam/db';

export const DEFAULT_CARGO_MULTIPLIER = 1.3;
export const MAX_CARGO_MULTIPLIER = 3.0;
export const MIN_CARGO_MULTIPLIER = 1.0;

export type CargoLoadInfo = {
  routeId: string;
  cargoTonnageKg: number;
  payoutMultiplier: number;
  cargoCategory: string;
  notes: string | null;
};

/**
 * Holt die cargo-load-spec einer Route oder null wenn keine konfiguriert.
 */
export async function getCargoLoadSpec(
  routeId: string,
): Promise<CargoLoadInfo | null> {
  const row = await prisma.cargoLoadSpec.findUnique({
    where: { routeId },
    select: {
      routeId: true,
      cargoTonnageKg: true,
      payoutMultiplier: true,
      cargoCategory: true,
      notes: true,
    },
  });
  if (!row) return null;
  return {
    routeId: row.routeId,
    cargoTonnageKg: row.cargoTonnageKg,
    payoutMultiplier: parseFloat(row.payoutMultiplier.toString()),
    cargoCategory: row.cargoCategory,
    notes: row.notes,
  };
}

/**
 * Effektiver multiplier für eine CARGO-flight.
 *
 * Wenn route eine CargoLoadSpec hat → ihr multiplier.
 * Sonst → DEFAULT_CARGO_MULTIPLIER (1.3x).
 */
export async function getCargoPayoutMultiplier(routeId: string): Promise<number> {
  const spec = await getCargoLoadSpec(routeId);
  if (!spec) return DEFAULT_CARGO_MULTIPLIER;
  return spec.payoutMultiplier;
}
