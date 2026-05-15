'use server';

/**
 * Welle M / M4 — Cargo-load-spec server actions.
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import {
  MIN_CARGO_MULTIPLIER,
  MAX_CARGO_MULTIPLIER,
} from '@/lib/pricing/cargo';

export type CargoActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function upsertCargoLoadSpecAction(input: {
  routeId: string;
  cargoTonnageKg: number;
  payoutMultiplier: number;
  cargoCategory: string;
  notes?: string | null;
}): Promise<CargoActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  // Ownership-check via route
  const route = await prisma.route.findUnique({
    where: { id: input.routeId },
    select: { airlineId: true },
  });
  if (!route || route.airlineId !== airlineId) {
    return { ok: false, error: 'Route nicht gefunden.' };
  }

  if (
    !Number.isFinite(input.cargoTonnageKg) ||
    input.cargoTonnageKg < 0 ||
    input.cargoTonnageKg > 200_000
  ) {
    return { ok: false, error: 'Tonnage muss zwischen 0 und 200000 kg liegen.' };
  }
  if (
    !Number.isFinite(input.payoutMultiplier) ||
    input.payoutMultiplier < MIN_CARGO_MULTIPLIER ||
    input.payoutMultiplier > MAX_CARGO_MULTIPLIER
  ) {
    return {
      ok: false,
      error: `Multiplier muss zwischen ${MIN_CARGO_MULTIPLIER} und ${MAX_CARGO_MULTIPLIER} liegen.`,
    };
  }
  const category = input.cargoCategory.trim() || 'general-freight';
  if (category.length > 50) {
    return { ok: false, error: 'Kategorie max 50 chars.' };
  }
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 1000) {
    return { ok: false, error: 'Notiz max 1000 chars.' };
  }

  await prisma.cargoLoadSpec.upsert({
    where: { routeId: input.routeId },
    update: {
      cargoTonnageKg: input.cargoTonnageKg,
      payoutMultiplier: input.payoutMultiplier,
      cargoCategory: category,
      notes,
    },
    create: {
      routeId: input.routeId,
      cargoTonnageKg: input.cargoTonnageKg,
      payoutMultiplier: input.payoutMultiplier,
      cargoCategory: category,
      notes,
    },
  });

  revalidatePath('/airline/economy/cargo');
  return { ok: true, message: 'Cargo-spec gespeichert.' };
}

export async function deleteCargoLoadSpecAction(input: {
  routeId: string;
}): Promise<CargoActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();
  const route = await prisma.route.findUnique({
    where: { id: input.routeId },
    select: { airlineId: true },
  });
  if (!route || route.airlineId !== airlineId) {
    return { ok: false, error: 'Route nicht gefunden.' };
  }
  await prisma.cargoLoadSpec.deleteMany({ where: { routeId: input.routeId } });
  revalidatePath('/airline/economy/cargo');
  return { ok: true, message: 'Cargo-spec entfernt.' };
}
