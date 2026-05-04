/**
 * Wallet- + Transaction-helpers für Welle 13 Economy MVP.
 *
 * Was hier rein gehört:
 *   - getOrCreateWallet — lazy creation für USER + AIRLINE wallets
 *   - recordTransaction — atomic insert + balance-update
 *   - transfer — atomic two-leg (TRANSFER_OUT + TRANSFER_IN) zwischen wallets
 *   - InsufficientFundsError — typed error für UI-handling
 *
 * Was NICHT hier rein gehört:
 *   - System-wallet-singleton — siehe ./system.ts (separate file weil
 *     der singleton-pattern eine eigene konzeption hat)
 *   - Revenue/expense-calculation — Phase 13C, nutzt diese helpers aber
 *     fügt domain-logik drüber
 *   - Per-PIREP-orchestration (processFlightEconomy) — auch 13C
 *
 * Atomicity-prinzip:
 *   Jede balance-veränderung muss in einem prisma.$transaction-block
 *   passieren. Sonst kann ein crash zwischen Transaction-insert und
 *   Wallet.balance-update zu drift führen (audit-log sagt "balance ist
 *   500", wallet sagt "balance ist 600"). Deshalb akzeptieren alle
 *   helpers optional einen prisma-tx-client als parameter — wenn caller
 *   schon in einer outer-transaction ist (z.B. PIREP-approval-flow
 *   bündelt 5 transactions), reichen wir den tx weiter durch.
 *
 * Sign-convention recap (siehe TransactionType-enum-docstring im schema):
 *   amount > 0 = inflow, amount < 0 = outflow.
 *   recordTransaction({ amount: -100 }) auf einem wallet decrements
 *   die balance um 100. amount: +100 increments.
 */

import {
  Prisma,
  type Wallet,
  type Transaction,
  type TransactionType,
  type WalletOwnerType,
} from "@prisma/client";
import { prisma } from "../index.js";
import {
  Decimal,
  type DecimalInput,
  toDecimal,
} from "./decimal.js";

/**
 * Prisma-tx-client-typ. Was prisma.$transaction(async (tx) => ...) als
 * `tx` übergibt — strukturell ein PrismaClient ohne $transaction- /
 * $connect- / $disconnect-methoden.
 */
export type PrismaTx = Prisma.TransactionClient;

/**
 * Acceptable für DB-operations: entweder der globale prisma-client oder
 * ein tx-client aus einer outer-transaction. Helpers default'en auf
 * `prisma` wenn nichts übergeben.
 */
export type DbClient = typeof prisma | PrismaTx;

/**
 * Spezifische error-class für unzureichende mittel. UI kann darauf
 * matchen via `error instanceof InsufficientFundsError` ohne string-
 * matching auf message.
 */
export class InsufficientFundsError extends Error {
  readonly walletId: string;
  readonly required: Decimal;
  readonly available: Decimal;

  constructor(walletId: string, required: Decimal, available: Decimal) {
    super(
      `Wallet ${walletId} has insufficient funds: required ${required.toString()}, available ${available.toString()}`,
    );
    this.name = "InsufficientFundsError";
    this.walletId = walletId;
    this.required = required;
    this.available = available;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// getOrCreateWallet
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find-or-create für USER- und AIRLINE-typ wallets.
 *
 * Race-condition-caveat: zwei concurrent first-calls für denselben
 * (ownerType, ownerId, walletType) könnten beide "no existing" finden
 * und beide CREATE versuchen. Im normalen flow ist das praktisch
 * unmöglich (wallets werden lazy beim ersten economy-event erstellt,
 * was per-user nicht parallel passiert), aber theoretisch möglich.
 * Mitigation für später: explizit pre-create wallet beim airline-onboarding
 * + user-onboarding (out-of-scope für MVP).
 *
 * SYSTEM-wallets gehen NICHT durch diesen helper — siehe ./system.ts.
 *
 * `starterCreditLimit` wird nur beim CREATE applied (wenn das wallet
 * neu angelegt wird). Existing wallets behalten ihre creditLimit
 * unverändert — dieser helper updated nicht. Use-case: airlines kriegen
 * beim allerersten zugriff einen credit-puffer (z.B. 100k VAM$) damit
 * ihre erste expense-transaktion nicht auf insufficient-funds läuft
 * bevor revenues gebucht sind. Der credit-puffer wird in der ordering
 * der per-PIREP transactions praktisch nie ausgeschöpft (revenues
 * werden vor expenses gebucht), ist aber als safety-net da.
 *
 * @throws Error wenn weder ownerUserId noch ownerAirlineId gesetzt ist
 *   (dann wäre es ein system-wallet und gehört in den anderen helper)
 */
export async function getOrCreateWallet(params: {
  ownerType: Extract<
    WalletOwnerType,
    "USER" | "AIRLINE" | "AIRLINE_PAYROLL" | "AIRLINE_MAINTENANCE"
  >;
  ownerUserId?: string | null;
  ownerAirlineId?: string | null;
  walletType?: string;
  /** Credit-limit auf neu erstellte wallets. Existing wallets unverändert. */
  starterCreditLimit?: DecimalInput | null;
  db?: DbClient;
}): Promise<Wallet> {
  const {
    ownerType,
    ownerUserId = null,
    ownerAirlineId = null,
    walletType = "primary",
    starterCreditLimit = null,
    db = prisma,
  } = params;

  // Sanity: USER → ownerUserId required, AIRLINE* → ownerAirlineId required.
  if (ownerType === "USER" && !ownerUserId) {
    throw new Error(
      `getOrCreateWallet: ownerType=USER requires ownerUserId`,
    );
  }
  if (ownerType !== "USER" && !ownerAirlineId) {
    throw new Error(
      `getOrCreateWallet: ownerType=${ownerType} requires ownerAirlineId`,
    );
  }

  // findFirst (nicht findUnique) weil das composite-unique-index mit
  // nullable fields in postgres NULL != NULL semantik hat — findUnique
  // würde den existing wallet nicht zuverlässig finden.
  const existing = await db.wallet.findFirst({
    where: { ownerType, ownerUserId, ownerAirlineId, walletType },
  });
  if (existing) return existing;

  return db.wallet.create({
    data: {
      ownerType,
      ownerUserId,
      ownerAirlineId,
      walletType,
      creditLimit: starterCreditLimit !== null
        ? toDecimal(starterCreditLimit)
        : undefined,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// recordTransaction
// ─────────────────────────────────────────────────────────────────────────

export interface RecordTransactionInput {
  /** Wallet das credited/debited wird. */
  walletId: string;
  /** Signed amount: + inflow, - outflow. */
  amount: DecimalInput;
  /** Canonical type aus dem TransactionType-enum. */
  type: TransactionType;
  /** Free-text sub-typ für drilldown (z.B. "fuel-jet-a"). */
  category: string;
  /** Human-readable description, gerendert in tx-history-UI. */
  description: string;
  /** Optional: source-PIREP für audit-link. */
  pirepId?: string | null;
  /** Optional: source-Booking für audit-link. */
  bookingId?: string | null;
  /** Optional: counterparty-wallet bei transfers (string, kein FK). */
  counterpartyWalletId?: string | null;
  /** Optional: flexibles json-context. */
  metadata?: Prisma.InputJsonValue | null;
  /** Optional: tx-client für outer-transaction. Default = prisma. */
  db?: DbClient;
}

/**
 * Insert eine Transaction-row und update die Wallet.balance atomic.
 *
 * Wenn `db` nicht übergeben wird, wickelt der helper die zwei DB-calls
 * selbst in einen $transaction-block. Wenn `db` ein outer-tx-client ist,
 * läuft alles in der äußeren transaction (caller verantwortlich für
 * commit/rollback).
 *
 * Wirft InsufficientFundsError wenn outflow (negative amount) das wallet
 * unter -creditLimit (oder unter 0 wenn kein creditLimit) bringen würde.
 * Inflow wird nie geblockt.
 *
 * Wirft Error("Wallet not found") wenn walletId nicht existiert.
 */
export async function recordTransaction(
  input: RecordTransactionInput,
): Promise<Transaction> {
  const {
    walletId,
    amount: amountInput,
    type,
    category,
    description,
    pirepId = null,
    bookingId = null,
    counterpartyWalletId = null,
    metadata = null,
    db,
  } = input;

  const amount = toDecimal(amountInput);

  if (amount.isZero()) {
    // Zero-amount-transactions sind audit-log-noise ohne semantik.
    // Caller hat einen logik-fehler wenn das passiert — explicit fail.
    throw new RangeError(
      `recordTransaction: amount must be non-zero (walletId=${walletId})`,
    );
  }

  // Inner-fn die in einer transaction (own oder borrowed) läuft.
  const run = async (tx: PrismaTx): Promise<Transaction> => {
    const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      throw new Error(`Wallet not found: ${walletId}`);
    }

    const newBalance = new Decimal(wallet.balance.toString()).add(amount);

    // Outflow-validation: balance darf nicht unter -creditLimit fallen
    // (oder unter 0 wenn creditLimit null). Inflow ist nie geblockt.
    if (amount.isNegative()) {
      const minBalance = wallet.creditLimit
        ? new Decimal(wallet.creditLimit.toString()).neg()
        : new Decimal(0);
      if (newBalance.lessThan(minBalance)) {
        throw new InsufficientFundsError(
          walletId,
          amount.abs(),
          new Decimal(wallet.balance.toString()).sub(minBalance),
        );
      }
    }

    const txRow = await tx.transaction.create({
      data: {
        walletId,
        amount,
        balanceAfter: newBalance,
        type,
        category,
        description,
        pirepId,
        bookingId,
        counterpartyWalletId,
        metadata: metadata ?? Prisma.JsonNull,
      },
    });

    await tx.wallet.update({
      where: { id: walletId },
      data: { balance: newBalance },
    });

    return txRow;
  };

  if (db && "wallet" in db && !("$transaction" in db)) {
    // Borrowed tx-client: just run inline, caller manages commit.
    return run(db as PrismaTx);
  }

  // Eigene transaction.
  return (db ?? prisma).$transaction(run);
}

// ─────────────────────────────────────────────────────────────────────────
// transfer (two-leg atomic)
// ─────────────────────────────────────────────────────────────────────────

export interface TransferInput {
  fromWalletId: string;
  toWalletId: string;
  /** Positive amount — direction ist im typ + den counterparty-fields kodiert. */
  amount: DecimalInput;
  /** Sub-typ-string, gleicher wert für beide legs. */
  category: string;
  /** Beide legs bekommen diese description. */
  description: string;
  /** Optional source-context — propagated auf beide legs. */
  pirepId?: string | null;
  bookingId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  /**
   * Optional override für den TransactionType-pair. Default ist
   * TRANSFER_OUT/TRANSFER_IN. Bei salary-runs wird das überschrieben
   * mit SALARY_PAID/SALARY_RECEIVED.
   */
  outType?: TransactionType;
  inType?: TransactionType;
  db?: DbClient;
}

/**
 * Atomic two-leg transfer zwischen zwei wallets. Ein TRANSFER_OUT auf
 * source (-amount) + ein TRANSFER_IN auf dest (+amount), beide mit
 * counterpartyWalletId aufeinander zeigend. Beide legs in einer einzigen
 * prisma.$transaction.
 *
 * Bei InsufficientFundsError vom source-wallet wird die ganze transaction
 * gerollt — kein partial state.
 *
 * @throws InsufficientFundsError | Error
 */
export async function transfer(input: TransferInput): Promise<{
  outTx: Transaction;
  inTx: Transaction;
}> {
  const {
    fromWalletId,
    toWalletId,
    amount: amountInput,
    category,
    description,
    pirepId = null,
    bookingId = null,
    metadata = null,
    outType = "TRANSFER_OUT",
    inType = "TRANSFER_IN",
    db = prisma,
  } = input;

  if (fromWalletId === toWalletId) {
    throw new Error(
      `transfer: fromWalletId and toWalletId must differ (got ${fromWalletId})`,
    );
  }

  const amount = toDecimal(amountInput);
  if (amount.isZero() || amount.isNegative()) {
    throw new RangeError(
      `transfer: amount must be positive, got ${amount.toString()}`,
    );
  }

  const run = async (tx: PrismaTx) => {
    const outTx = await recordTransaction({
      walletId: fromWalletId,
      amount: amount.neg(),
      type: outType,
      category,
      description,
      pirepId,
      bookingId,
      counterpartyWalletId: toWalletId,
      metadata,
      db: tx,
    });
    const inTx = await recordTransaction({
      walletId: toWalletId,
      amount,
      type: inType,
      category,
      description,
      pirepId,
      bookingId,
      counterpartyWalletId: fromWalletId,
      metadata,
      db: tx,
    });
    return { outTx, inTx };
  };

  if (db && "wallet" in db && !("$transaction" in db)) {
    return run(db as PrismaTx);
  }
  return (db ?? prisma).$transaction(run);
}

// ─────────────────────────────────────────────────────────────────────────
// Convenience read-only queries
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get current balance für ein wallet als Decimal. Wirft wenn wallet
 * nicht existiert.
 */
export async function getBalance(
  walletId: string,
  db: DbClient = prisma,
): Promise<Decimal> {
  const wallet = await db.wallet.findUnique({
    where: { id: walletId },
    select: { balance: true },
  });
  if (!wallet) throw new Error(`Wallet not found: ${walletId}`);
  return new Decimal(wallet.balance.toString());
}
