'use server';

/**
 * Welle M / M5 — VAMSE admin actions.
 *
 * Airline-admin only. Recalculate eigenen stock-preis + ticker-setup.
 */

import { prisma } from '@vam/db';
import { revalidatePath } from 'next/cache';
import { requireAirlineManagerWithAirline } from '@/lib/roles';
import {
  computeVamsePrice,
  VAMSE_TOTAL_SHARES,
} from '@/lib/pricing/vamse';

export type VamseAdminActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * Erste-mal stock-initialization wenn airline noch keinen hat.
 * Idempotent: existiert schon → update ticker (wenn input given).
 */
export async function setVamseTickerAction(input: {
  tickerSymbol: string;
}): Promise<VamseAdminActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  const ticker = input.tickerSymbol.trim().toUpperCase();
  if (ticker.length < 2 || ticker.length > 6) {
    return { ok: false, error: 'Ticker muss 2-6 zeichen sein.' };
  }
  if (!/^[A-Z0-9]+$/.test(ticker)) {
    return { ok: false, error: 'Ticker nur A-Z und 0-9 erlaubt.' };
  }

  // Existing stock?
  const existing = await prisma.vamseStock.findUnique({
    where: { airlineId },
    select: { id: true },
  });
  if (existing) {
    await prisma.vamseStock.update({
      where: { airlineId },
      data: { tickerSymbol: ticker },
    });
  } else {
    await prisma.vamseStock.create({
      data: {
        airlineId,
        tickerSymbol: ticker,
        currentPrice: 1.0,
        totalShares: VAMSE_TOTAL_SHARES,
        sharesOutstanding: 0,
      },
    });
  }

  revalidatePath('/airline/economy/vamse');
  revalidatePath('/vamse');
  return { ok: true, message: `Ticker ${ticker} gesetzt.` };
}

/**
 * Recompute price aus aktuellen performance-signals + create snapshot.
 *
 * Performance-signals werden hier inline berechnet:
 *   - pireps7d: count of approved Pireps in last 7d
 *   - activePilots7d: distinct userId in pireps
 *   - totalRevenue7d: sum of positive transactions on airline-wallet
 *   - airlineAgeDays: now - airline.createdAt
 */
export async function recalculateVamsePriceAction(): Promise<VamseAdminActionResult> {
  const { airlineId } = await requireAirlineManagerWithAirline();

  const stock = await prisma.vamseStock.findUnique({
    where: { airlineId },
    select: { id: true },
  });
  if (!stock) {
    return {
      ok: false,
      error: 'Kein stock initialisiert — erst ticker setzen.',
    };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Parallel performance-queries
  const [pireps, distinctPilotsRaw, airline, revenueAgg] = await Promise.all([
    prisma.pirep.count({
      where: {
        airlineId,
        status: 'Approved',
        submittedAt: { gte: sevenDaysAgo },
      },
    }),
    prisma.pirep.findMany({
      where: {
        airlineId,
        status: 'Approved',
        submittedAt: { gte: sevenDaysAgo },
      },
      distinct: ['userId'],
      select: { userId: true },
    }),
    prisma.airline.findUnique({
      where: { id: airlineId },
      select: { createdAt: true },
    }),
    prisma.transaction.aggregate({
      where: {
        wallet: { ownerType: 'AIRLINE', ownerAirlineId: airlineId },
        amount: { gt: 0 },
        createdAt: { gte: sevenDaysAgo },
      },
      _sum: { amount: true },
    }),
  ]);

  const activePilots7d = distinctPilotsRaw.length;
  const totalRevenue7d = revenueAgg._sum.amount
    ? parseFloat(revenueAgg._sum.amount.toString())
    : 0;
  const airlineAgeDays = airline
    ? Math.floor(
        (Date.now() - airline.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      )
    : 0;

  const newPrice = computeVamsePrice({
    pireps7d: pireps,
    activePilots7d,
    totalRevenue7d,
    airlineAgeDays,
  });

  // Update + snapshot in single transaction
  await prisma.$transaction(async (tx) => {
    await tx.vamseStock.update({
      where: { airlineId },
      data: { currentPrice: newPrice, lastPricedAt: new Date() },
    });
    await tx.vamseStockSnapshot.create({
      data: {
        stockId: stock.id,
        price: newPrice,
        pireps7d: pireps,
        totalRevenue7d,
      },
    });
  });

  revalidatePath('/airline/economy/vamse');
  revalidatePath('/vamse');
  return {
    ok: true,
    message: `Preis neu berechnet: ${newPrice.toFixed(2)} VAM$/share.`,
  };
}
