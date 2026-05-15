'use server';

/**
 * Welle M / M5 — VAMSE pilot trading actions.
 *
 * Pilots können kaufen/verkaufen am aktuellen stock-preis. Counterparty
 * für die wallet-bewegung ist die system-wallet (kein order-book in V1).
 */

import {
  prisma,
  recordTransaction,
  getOrCreateWallet,
  getSystemWallet,
  InsufficientFundsError,
} from '@vam/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { VAMSE_TOTAL_SHARES } from '@/lib/pricing/vamse';

export type VamseTradeResult =
  | { ok: true; message?: string; totalVam?: number; pricePerShare?: number }
  | { ok: false; error: string };

async function requirePilot(): Promise<{ userId: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { userId: session.user.id };
}

/**
 * Pilot kauft N shares zu currentPrice.
 *
 * Atomic in einem $transaction:
 *   1. Lock stock-row (für sharesOutstanding-update)
 *   2. Check verfügbarkeit (sharesOutstanding + n ≤ totalShares)
 *   3. Recordtransaction: pilot-wallet → -cost (EXPENSE_FLIGHT_SCHOOL als
 *      placeholder-type weil enum kein "INVESTMENT" hat; category-string
 *      "vamse-buy" unterscheidet)
 *   4. Upsert VamseHolding mit weighted-average price
 *   5. VamseTrade audit row
 *   6. VamseStock.sharesOutstanding += n
 */
export async function buyVamseSharesAction(input: {
  stockId: string;
  shares: number;
}): Promise<VamseTradeResult> {
  const auth = await requirePilot();
  if (!auth) return { ok: false, error: 'Nicht authentifiziert.' };

  const shares = Math.floor(input.shares);
  if (!Number.isFinite(shares) || shares < 1 || shares > VAMSE_TOTAL_SHARES) {
    return { ok: false, error: `Shares müssen 1-${VAMSE_TOTAL_SHARES} sein.` };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const stock = await tx.vamseStock.findUnique({
        where: { id: input.stockId },
        select: {
          id: true,
          tickerSymbol: true,
          currentPrice: true,
          totalShares: true,
          sharesOutstanding: true,
        },
      });
      if (!stock) throw new Error('Stock nicht gefunden.');

      // Availability check
      if (stock.sharesOutstanding + shares > stock.totalShares) {
        throw new Error(
          `Nur ${stock.totalShares - stock.sharesOutstanding} shares verfügbar.`,
        );
      }

      const pricePerShare = parseFloat(stock.currentPrice.toString());
      const totalCost = Math.round(pricePerShare * shares * 100) / 100;

      // Wallet-bewegungen
      const pilotWallet = await getOrCreateWallet({
        ownerType: 'USER',
        ownerUserId: auth.userId,
        db: tx,
      });
      const systemWallet = await getSystemWallet('primary', tx);

      await recordTransaction({
        walletId: pilotWallet.id,
        amount: -totalCost,
        type: 'TRANSFER_OUT',
        category: 'vamse-buy',
        description: `VAMSE BUY ${shares}× ${stock.tickerSymbol} @ ${pricePerShare.toFixed(2)}`,
        counterpartyWalletId: systemWallet.id,
        metadata: {
          stockId: stock.id,
          ticker: stock.tickerSymbol,
          shares,
          pricePerShare,
        },
        db: tx,
      });

      // Upsert holding mit weighted-average price
      const existing = await tx.vamseHolding.findUnique({
        where: {
          userId_stockId: { userId: auth.userId, stockId: stock.id },
        },
      });
      if (existing) {
        const oldShares = existing.shares;
        const oldAvg = parseFloat(existing.avgPurchasePrice.toString());
        const newShares = oldShares + shares;
        // Weighted average
        const newAvg =
          (oldShares * oldAvg + shares * pricePerShare) / newShares;
        await tx.vamseHolding.update({
          where: { id: existing.id },
          data: {
            shares: newShares,
            avgPurchasePrice: Math.round(newAvg * 10000) / 10000,
          },
        });
      } else {
        await tx.vamseHolding.create({
          data: {
            userId: auth.userId,
            stockId: stock.id,
            shares,
            avgPurchasePrice: pricePerShare,
          },
        });
      }

      // Audit trade
      await tx.vamseTrade.create({
        data: {
          userId: auth.userId,
          stockId: stock.id,
          kind: 'BUY',
          shares,
          pricePerShare,
          totalVam: totalCost,
        },
      });

      // sharesOutstanding update
      await tx.vamseStock.update({
        where: { id: stock.id },
        data: { sharesOutstanding: stock.sharesOutstanding + shares },
      });

      return { totalCost, pricePerShare, ticker: stock.tickerSymbol };
    });

    revalidatePath('/vamse');
    revalidatePath('/airline/economy/vamse');
    return {
      ok: true,
      message: `${shares}× ${result.ticker} gekauft @ ${result.pricePerShare.toFixed(2)} VAM$. Total: ${result.totalCost.toFixed(2)} VAM$.`,
      totalVam: result.totalCost,
      pricePerShare: result.pricePerShare,
    };
  } catch (e) {
    if (e instanceof InsufficientFundsError) {
      return {
        ok: false,
        error: `Nicht genug VAM$ in deinem wallet. Verfügbar: ${e.available.toFixed(2)}.`,
      };
    }
    if (e instanceof Error) return { ok: false, error: e.message };
    return { ok: false, error: 'Unbekannter fehler.' };
  }
}

/**
 * Pilot verkauft N shares zu currentPrice. Pilot bekommt VAM$
 * proceeds; holding wird decremented oder deleted wenn shares=0.
 */
export async function sellVamseSharesAction(input: {
  stockId: string;
  shares: number;
}): Promise<VamseTradeResult> {
  const auth = await requirePilot();
  if (!auth) return { ok: false, error: 'Nicht authentifiziert.' };

  const shares = Math.floor(input.shares);
  if (!Number.isFinite(shares) || shares < 1) {
    return { ok: false, error: 'Shares müssen >= 1 sein.' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const stock = await tx.vamseStock.findUnique({
        where: { id: input.stockId },
        select: {
          id: true,
          tickerSymbol: true,
          currentPrice: true,
          sharesOutstanding: true,
        },
      });
      if (!stock) throw new Error('Stock nicht gefunden.');

      const holding = await tx.vamseHolding.findUnique({
        where: {
          userId_stockId: { userId: auth.userId, stockId: stock.id },
        },
      });
      if (!holding) throw new Error('Du hältst keine shares von diesem stock.');
      if (holding.shares < shares) {
        throw new Error(
          `Du hältst nur ${holding.shares} shares (verkaufen wollte: ${shares}).`,
        );
      }

      const pricePerShare = parseFloat(stock.currentPrice.toString());
      const totalProceeds = Math.round(pricePerShare * shares * 100) / 100;

      const pilotWallet = await getOrCreateWallet({
        ownerType: 'USER',
        ownerUserId: auth.userId,
        db: tx,
      });
      const systemWallet = await getSystemWallet('primary', tx);

      await recordTransaction({
        walletId: pilotWallet.id,
        amount: totalProceeds,
        type: 'TRANSFER_IN',
        category: 'vamse-sell',
        description: `VAMSE SELL ${shares}× ${stock.tickerSymbol} @ ${pricePerShare.toFixed(2)}`,
        counterpartyWalletId: systemWallet.id,
        metadata: {
          stockId: stock.id,
          ticker: stock.tickerSymbol,
          shares,
          pricePerShare,
        },
        db: tx,
      });

      // Decrement holding (delete if zero)
      const newShares = holding.shares - shares;
      if (newShares === 0) {
        await tx.vamseHolding.delete({ where: { id: holding.id } });
      } else {
        // avgPurchasePrice bleibt unverändert beim verkauf
        await tx.vamseHolding.update({
          where: { id: holding.id },
          data: { shares: newShares },
        });
      }

      await tx.vamseTrade.create({
        data: {
          userId: auth.userId,
          stockId: stock.id,
          kind: 'SELL',
          shares,
          pricePerShare,
          totalVam: totalProceeds,
        },
      });

      // sharesOutstanding update
      await tx.vamseStock.update({
        where: { id: stock.id },
        data: { sharesOutstanding: stock.sharesOutstanding - shares },
      });

      return { totalProceeds, pricePerShare, ticker: stock.tickerSymbol };
    });

    revalidatePath('/vamse');
    revalidatePath('/airline/economy/vamse');
    return {
      ok: true,
      message: `${shares}× ${result.ticker} verkauft @ ${result.pricePerShare.toFixed(2)} VAM$. Total: ${result.totalProceeds.toFixed(2)} VAM$.`,
      totalVam: result.totalProceeds,
      pricePerShare: result.pricePerShare,
    };
  } catch (e) {
    if (e instanceof Error) return { ok: false, error: e.message };
    return { ok: false, error: 'Unbekannter fehler.' };
  }
}
