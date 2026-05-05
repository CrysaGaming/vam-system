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

import { Prisma, type Transaction, type TransactionType } from "@prisma/client";
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

// ─────────────────────────────────────────────────────────────────────────
// getUserWalletExtended
// ─────────────────────────────────────────────────────────────────────────

export interface UserWalletExtended {
  /** Wallet-id für nachfolgende queries (z.B. tx-list). null wenn !hasWallet. */
  walletId: string | null;
  /** Aktueller balance. 0 wenn kein wallet. */
  balance: Decimal;
  /** Credit-limit auf dem wallet. null wenn keiner gesetzt oder !hasWallet. */
  creditLimit: Decimal | null;
  /** Sum of inflows (amount > 0) in the current calendar month (UTC). */
  monthRevenue: Decimal;
  /** Sum of outflows (amount < 0) in the current calendar month (UTC). Returned as positive value (|amount|) for display. */
  monthExpenses: Decimal;
  /** monthRevenue - monthExpenses. Identisch zu sum(amount) im monat. */
  monthNet: Decimal;
  /** True wenn ein wallet existiert. */
  hasWallet: boolean;
  /** Total-tx-count über die wallet-lifetime. */
  txCount: number;
}

/**
 * Erweiterte wallet-stats für die /wallet-page top-bar.
 *
 * Im gegensatz zu getUserWalletStats (delta-since-yesterday) liefert
 * diese funktion einen vollen monats-aggregat-block: revenue +
 * expenses + net. Das ist was pilots als "wie geht's mir diesen
 * monat?"-overview brauchen, während delta-since-yesterday eher
 * dashboard-glance-info ist.
 *
 * Aggregat-strategie: drei separate aggregates statt ein groupBy auf
 * sign(amount) — postgres hat kein eingebautes sign() im prisma-aggregate-
 * spec, also einfacher zwei separate where-clauses (gt 0 / lt 0). Net
 * wird im JS berechnet aus dem Decimal-objekt.
 *
 * Performance: vier parallel-queries (wallet + 2 aggregates + count).
 * Auf einem realistischen wallet mit ~5000 tx pro jahr ist das <50ms
 * mit dem composite-index auf (walletId, createdAt). Wenn das später
 * bottleneck wird, denormalize wir monthRevenue/Expenses als counter-
 * cache auf Wallet selbst und updaten in recordTransaction.
 */
export async function getUserWalletExtended(
  userId: string,
  options: { db?: DbClient } = {},
): Promise<UserWalletExtended> {
  const { db = prisma } = options;

  const wallet = await db.wallet.findFirst({
    where: { ownerType: "USER", ownerUserId: userId, walletType: "primary" },
    select: { id: true, balance: true, creditLimit: true },
  });

  if (!wallet) {
    const zero = new Decimal(0);
    return {
      walletId: null,
      balance: zero,
      creditLimit: null,
      monthRevenue: zero,
      monthExpenses: zero,
      monthNet: zero,
      hasWallet: false,
      txCount: 0,
    };
  }

  // Monats-anfang in UTC. Für users in DE/EU bedeutet das: monatsende
  // wird ein bisschen früher (1-2h) im UTC-monat als im lokalen monat.
  // Akzeptabel für MVP, kann später ein lokal-zeit-toggle bekommen.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [revenueAgg, expensesAgg, txCount] = await Promise.all([
    db.transaction.aggregate({
      where: {
        walletId: wallet.id,
        createdAt: { gte: monthStart },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
    db.transaction.aggregate({
      where: {
        walletId: wallet.id,
        createdAt: { gte: monthStart },
        amount: { lt: 0 },
      },
      _sum: { amount: true },
    }),
    db.transaction.count({ where: { walletId: wallet.id } }),
  ]);

  const monthRevenue = revenueAgg._sum.amount ?? new Decimal(0);
  // Expenses kommen aus DB als negativer Decimal (z.B. -250.00). Wir
  // wandeln zu absolute-value um, damit UI sie als positive zahl
  // rendern kann (vorzeichen kommt durch label/farbe, nicht durch
  // doppelte negation in "expenses: -250").
  const monthExpensesNegative = expensesAgg._sum.amount ?? new Decimal(0);
  const monthExpenses = monthExpensesNegative.abs() as Decimal;
  const monthNet = monthRevenue.minus(monthExpenses);

  return {
    walletId: wallet.id,
    balance: wallet.balance,
    creditLimit: wallet.creditLimit,
    monthRevenue,
    monthExpenses,
    monthNet,
    hasWallet: true,
    txCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// getUserTransactions
// ─────────────────────────────────────────────────────────────────────────

export interface GetUserTransactionsOptions {
  /** Pagination offset. Default 0. */
  skip?: number;
  /** Pagination limit. Default 25, max 100 (server-side cap). */
  take?: number;
  /**
   * Optional filter auf transaction-type. Akzeptiert ein einzelnes
   * type oder ein array (postgres IN clause via prisma).
   */
  type?: TransactionType | TransactionType[];
  /** Optional date-from-filter (inclusive). */
  fromDate?: Date;
  /** Optional date-to-filter (exclusive — typical "before midnight" semantics). */
  toDate?: Date;
  db?: DbClient;
}

export interface GetUserTransactionsResult {
  /** Tx-rows für die aktuelle page. */
  rows: Transaction[];
  /** Total-count über alle filter (ohne pagination), für page-counter. */
  totalCount: number;
}

/**
 * Paginated tx-list für /wallet. Returned tx-objekte direkt aus der
 * DB ohne extra-include (PIREP-link wird via tx.pirepId selbst rendered
 * wenn UI das braucht — würde sonst N+1-query-storm bei 100 rows).
 *
 * Default-take ist 25 (passt auf typischen viewport ohne scroll).
 * server-side cap auf 100 verhindert dass jemand &take=99999 macht
 * und einen riesen-roundtrip auslöst. UI muss bei mehr als 100 echte
 * pagination machen.
 */
export async function getUserTransactions(
  userId: string,
  options: GetUserTransactionsOptions = {},
): Promise<GetUserTransactionsResult> {
  const {
    skip = 0,
    take: rawTake = 25,
    type,
    fromDate,
    toDate,
    db = prisma,
  } = options;
  const take = Math.min(Math.max(1, rawTake), 100);

  // Wallet-lookup ohne select, weil wir ID brauchen (für tx-where-clause)
  // und auch das !wallet-result mit early-return abfangen wollen.
  const wallet = await db.wallet.findFirst({
    where: { ownerType: "USER", ownerUserId: userId, walletType: "primary" },
    select: { id: true },
  });

  if (!wallet) {
    return { rows: [], totalCount: 0 };
  }

  // Where-clause-builder: walletId immer, dann optional type/date.
  // Type kann single oder array sein → prisma's `in` operator akzeptiert
  // nur arrays, also normalisieren wir auf array wenn nötig.
  const where: Prisma.TransactionWhereInput = { walletId: wallet.id };
  if (type !== undefined) {
    where.type = Array.isArray(type) ? { in: type } : type;
  }
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lt = toDate;
  }

  const [rows, totalCount] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.transaction.count({ where }),
  ]);

  return { rows, totalCount };
}
