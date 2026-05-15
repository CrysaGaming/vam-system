'use server';

/**
 * Welle M / M3 — Fuel-price server actions (admin-only).
 *
 * Upsert + delete: airline-admin pflegt fuel-prices pro ICAO.
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';

export type FuelPriceActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function upsertFuelPriceAction(input: {
  icao: string;
  pricePerGallon: number;
  note?: string | null;
}): Promise<FuelPriceActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  const icao = input.icao.trim().toUpperCase();
  if (icao.length < 3 || icao.length > 10) {
    return { ok: false, error: 'ICAO muss 3-10 chars sein.' };
  }
  if (
    !Number.isFinite(input.pricePerGallon) ||
    input.pricePerGallon <= 0 ||
    input.pricePerGallon > 99
  ) {
    return { ok: false, error: 'Preis muss zwischen 0.01 und 99.00 VAM$/gallon liegen.' };
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 500) {
    return { ok: false, error: 'Notiz max 500 chars.' };
  }

  await prisma.airportFuelPrice.upsert({
    where: { airlineId_icao: { airlineId, icao } },
    update: { pricePerGallon: input.pricePerGallon, note },
    create: {
      airlineId,
      icao,
      pricePerGallon: input.pricePerGallon,
      note,
    },
  });

  revalidatePath('/airline/economy/fuel');
  return { ok: true, message: `Preis für ${icao} gesetzt.` };
}

export async function deleteFuelPriceAction(input: {
  icao: string;
}): Promise<FuelPriceActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();
  const icao = input.icao.trim().toUpperCase();
  await prisma.airportFuelPrice.deleteMany({
    where: { airlineId, icao },
  });
  revalidatePath('/airline/economy/fuel');
  return { ok: true, message: `Preis für ${icao} entfernt.` };
}
