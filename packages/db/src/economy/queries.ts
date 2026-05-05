/**
 * Read-only economy queries für UI-display + reporting.
 *
 * Was hier rein gehört:
 *   - Wallet-stats für dashboards/cards (balance + delta + activity-flags)
 *   - Aggregate-queries für reports (monthly revenue, top earners, etc.)
 *
 * Was NICHT hier rein gehört:
 *   - Mutations (recordTransaction/transfer → ./wallet.ts)
 *   - Pure-calc-functions (./calc.ts)
 *   - Per-PIREP-orchestration (./process-flight.ts)
 *
 * Convention: alle queries akzeptieren optional einen `db: DbClient`
 * für composition mit outer-transactions. Default ist der globale
 * prisma-client.
 *
 * Timezone-konvention: "yesterday"/"today" bezieht sich auf UTC, nicht
 * auf user-locale. Für die meisten flight-sim-VA-use-cases ist das
 * ausreichend (pilots fliegen über alle zeitzonen verstreut, UTC ist
 * das natural-anchor in der aviation-domain). Sollte ein use-case
 * lokale-zeit verlangen, kann der caller einen explicit `since`-
 * timestamp übergeben — siehe getUserWalletStats-signature.
 */

import { prisma } from "../index.js";
import { Decimal } from "./decimal.js";
import type { DbClient } from "./wallet.js";

// ─────────────────────────────────────────────────────────────────────────
// getUserWalletStats
// ─────────────────────────────────────────────────────────────────────────

export interface UserWalletStats {
  /** Aktueller balance. 0 wenn kein wallet existiert. */
  balance: Decimal;
  /**
   * Net-change seit `since`-timestamp (oder seit UTC-mitternacht heute,
   * wenn `since` weggelassen). Sign-konvention: + inflow, - outflow.
   * 0 wenn kein wallet oder keine transactions im zeitraum.
   */
  deltaSinceYesterday: Decimal;
  /**
   * True nur wenn ein wallet bereits angelegt wurde. Frisch-aktivierte
   * users haben hasWallet=false bis zum ersten approved-PIREP. UI
   * sollte das als "noch keine flüge gebucht" hint anzeigen, nicht als
   * fehler.
   */
  hasWallet: boolean;
  /**
   * Total-transactions-count über die gesamte wallet-lifetime. Nützlich
   * für "first-time-user"-onboarding-hints (txCount=0 → zeige tutorial,
   * txCount>0 → zeige normale stats).
   */
  txCount: number;
}

/**
 * Wallet-stats für einen user — primary-wallet (USER-typ).
 *
 * Falls noch kein wallet existiert, returned zeros mit hasWallet=false.
 * Nicht ein "wallet existiert immer und hat 0 balance"-mock — die UI
 * soll explicit zwischen "frisch-aktiviert, noch keine flüge" und
 * "wallet existiert mit 0 balance" unterscheiden können.
 *
 * Aufruf-pattern für dashboard-card:
 *   if (!user.economyEnabled || !user.airline?.economyEnabled) return null;
 *   const stats = await getUserWalletStats(user.id);
 *   <WalletCard balance={stats.balance} delta={stats.deltaSinceYesterday} />
 */
export async function getUserWalletStats(
  userId: string,
  options: {
    /**
     * Reference-zeitpunkt für delta-berechnung. Default: UTC-mitternacht
     * heute (= "delta seit gestern" in UTC).
     */
    since?: Date;
    db?: DbClient;
  } = {},
): Promise<UserWalletStats> {
  const { db = prisma } = options;
  const since = options.since ?? (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();

  // findFirst statt findUnique — composite-unique-index hat NULL!=NULL
  // semantik in postgres, findUnique würde unzuverlässig matchen.
  const wallet = await db.wallet.findFirst({
    where: {
      ownerType: "USER",
      ownerUserId: userId,
      walletType: "primary",
    },
    select: { id: true, balance: true },
  });

  if (!wallet) {
    return {
      balance: new Decimal(0),
      deltaSinceYesterday: new Decimal(0),
      hasWallet: false,
      txCount: 0,
    };
  }

  // Parallele queries: aggregate-sum für delta, count für txCount.
  // count ist getrennt weil aggregate._count die _alle_ tx zählt egal
  // welcher zeitraum — wir wollen aber nur tx im since-zeitraum für
  // delta, gesamt-tx für txCount.
  const [txAgg, txCount] = await Promise.all([
    db.transaction.aggregate({
      where: { walletId: wallet.id, createdAt: { gte: since } },
      _sum: { amount: true },
    }),
    db.transaction.count({ where: { walletId: wallet.id } }),
  ]);

  return {
    balance: wallet.balance,
    deltaSinceYesterday: txAgg._sum.amount ?? new Decimal(0),
    hasWallet: true,
    txCount,
  };
}
