/**
 * SYSTEM-wallet helpers — VAM treasury / sinks.
 *
 * Was ist das system-wallet?
 *   Ein singleton-wallet das vom system selbst gehalten wird (kein
 *   user, keine airline). Endpunkt für money-flows die nicht an reale
 *   wallets gehen sollen:
 *     - Catering-fees (kommen aus airline.balance, gehen ins system —
 *       würde sonst airline-eigenes catering-recycling = free money)
 *     - Landing-fees an non-airline-airports (FRA/MUC sind nicht
 *       als virtuelle airline geführt; ihre fees gehen ins system)
 *     - Fuel-fees (jet-A1 wird von "irgendwoher" gekauft; SYSTEM ist
 *       der counterparty)
 *     - Ground-handling-fees (analog)
 *     - Slot-fees (Welle 15+)
 *     - Tax-receipts (Welle 15+)
 *
 *   Plus: source für inflows die "from nowhere" kommen sollten, z.B.
 *     - Government-mail-contracts (Welle 15+)
 *     - Charity-flight-rewards (Welle 14+)
 *     - Admin-adjustments (corrections, gifts)
 *
 * Singleton-policy:
 *   Es gibt im MVP genau EIN system-wallet pro walletType. "primary"
 *   ist das default. Andere walletTypes (z.B. "tax-receipts" für
 *   später) werden lazy auto-bootstrap'd beim ersten zugriff.
 *
 *   DB-constraint enforcement ist nicht möglich (composite-unique-index
 *   greift mit NULL-fields nicht — postgres NULL != NULL semantik).
 *   Race-condition: zwei concurrent first-calls könnten beide CREATE
 *   versuchen. Mitigation:
 *     - Lazy-creation passiert nur beim allerersten economy-event ever
 *       (one-time-cost). Zweites call findet das wallet immer.
 *     - Wenn duplikate je entstehen: harmlos, beide werden für
 *       transactions benutzt; admin kann später mergen via raw SQL.
 *     - Production-level fix wäre ein partial unique-index per raw
 *       migration: `WHERE ownerType = 'SYSTEM'`. Optional follow-up.
 */

import { type Wallet } from "@prisma/client";
import { prisma } from "../index.js";
import { type DbClient } from "./wallet.js";

/**
 * Get-or-create für system-wallet. Default walletType="primary".
 *
 * Idempotent: zweiter call liefert dasselbe wallet wie der erste.
 * Race-conditions siehe model-docstring oben.
 *
 * Note: dieser helper geht NICHT durch getOrCreateWallet, weil dort
 * USER/AIRLINE-spezifische assertions sind (ownerUserId/ownerAirlineId
 * required). System-wallets haben beide null.
 */
export async function getSystemWallet(
  walletType = "primary",
  db: DbClient = prisma,
): Promise<Wallet> {
  const existing = await db.wallet.findFirst({
    where: { ownerType: "SYSTEM", walletType },
  });
  if (existing) return existing;

  return db.wallet.create({
    data: {
      ownerType: "SYSTEM",
      walletType,
      // ownerUserId + ownerAirlineId sind beide null per default
    },
  });
}
