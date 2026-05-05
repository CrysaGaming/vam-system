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

// 13C: economy constants (rates + multipliers) für UI-display + custom-
// calc-overrides außerhalb des orchestrators.
export {
  BASE_FARE_VAM,
  PER_MILE_RATE_VAM,
  ECONOMY_CLASS_MULTIPLIER,
  CARGO_RATE_PER_KG_VAM,
  JET_A1_PRICE_PER_KG_VAM,
  LANDING_FEE_DEFAULT_VAM,
  GROUND_HANDLING_DEFAULT_VAM,
  CATERING_PER_PAX_VAM,
  PILOT_BASE_SALARY_PER_HOUR_VAM,
  RANK_PROGRESSION_PER_ORDER,
  RANK_PROGRESSION_MAX_ORDER,
} from "./constants.js";

// 13C: pure calc-functions. Nutzbar für UI-vorschau ohne DB-write.
export {
  calculatePassengerRevenue,
  calculateCargoRevenue,
  calculateFuelCost,
  calculateLandingFee,
  calculateGroundHandlingFee,
  calculateCateringCost,
  calculatePilotSalary,
  calculateFlightEconomy,
  snapToCents,
} from "./calc.js";

// 13C: orchestrator. Wird vom PIREP-approval-flow aufgerufen.
export {
  processFlightEconomy,
  type ProcessFlightOptions,
  type ProcessFlightResult,
} from "./process-flight.js";

// 13D: read-only queries für UI-display.
export {
  getUserWalletStats,
  getUserWalletExtended,
  getUserTransactions,
  getAirlineWalletExtended,
  getAirlineTransactions,
  type UserWalletStats,
  type UserWalletExtended,
  type AirlineWalletExtended,
  type GetUserTransactionsOptions,
  type GetUserTransactionsResult,
} from "./queries.js";
