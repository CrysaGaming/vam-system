/**
 * Welle 13 Economy MVP — barrel-export für economy module.
 *
 * Convention: imports kommen via `import { ... } from "@vam/db"`.
 * Die module-exports werden in packages/db/src/index.ts re-exported,
 * sodass apps/web und apps/bot keinen "@vam/db/economy"-subpath
 * brauchen — alles unter einem flat namespace.
 */

export {
  Decimal,
  toDecimal,
  formatVamCurrency,
  assertNonNegative,
  type DecimalInput,
} from "./decimal.js";

export {
  getOrCreateWallet,
  recordTransaction,
  transfer,
  getBalance,
  InsufficientFundsError,
  type RecordTransactionInput,
  type TransferInput,
  type PrismaTx,
  type DbClient,
} from "./wallet.js";

export { getSystemWallet } from "./system.js";
