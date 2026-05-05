import type { TransactionType } from "@vam/db";

/**
 * Welle 13D-3 — UI-display-helpers für transaction-types.
 *
 * Mapped jeden TransactionType auf:
 *   - label (German) — für badges + filter-dropdown
 *   - category — "revenue" | "expense" | "transfer" | "system" — steuert
 *     farbe und gruppierung in der UI
 *   - description-default — fallback-string wenn tx.description leer ist
 *
 * Die canonical-quelle für die enum-werte ist Prisma's TransactionType
 * im schema.prisma. Wenn dort ein neuer typ dazu kommt (z.B. CARGO_LOST),
 * MUSS er hier auch dokumentiert werden — TS warnt mit Record<TransactionType, ...>
 * weil der mapping dann incomplete wäre.
 */

export type TransactionCategory =
  | "revenue"
  | "expense"
  | "transfer"
  | "system";

interface TransactionTypeDisplay {
  label: string;
  category: TransactionCategory;
}

export const TRANSACTION_TYPE_DISPLAY: Record<
  TransactionType,
  TransactionTypeDisplay
> = {
  REVENUE_PASSENGER: { label: "Passagier-Umsatz", category: "revenue" },
  REVENUE_CARGO: { label: "Fracht-Umsatz", category: "revenue" },
  REVENUE_TICKET_TWITCH: { label: "Twitch-Ticket", category: "revenue" },
  EXPENSE_FUEL: { label: "Treibstoff", category: "expense" },
  EXPENSE_LANDING_FEE: { label: "Landegebühr", category: "expense" },
  EXPENSE_GROUND_HANDLING: { label: "Ground-Handling", category: "expense" },
  EXPENSE_CATERING: { label: "Catering", category: "expense" },
  EXPENSE_MAINTENANCE: { label: "Wartung", category: "expense" },
  SALARY_PAID: { label: "Gehalt gezahlt", category: "expense" },
  SALARY_RECEIVED: { label: "Gehalt empfangen", category: "revenue" },
  TRANSFER_OUT: { label: "Überweisung raus", category: "transfer" },
  TRANSFER_IN: { label: "Überweisung rein", category: "transfer" },
  ADJUSTMENT_ADMIN: { label: "Admin-Korrektur", category: "system" },
  ECONOMY_RESET: { label: "Economy-Reset", category: "system" },
};

/**
 * Tailwind-classes pro category. Gibt sowohl text- als auch background-
 * variant für badges. Pattern: bg-X-50 dark:bg-X-500/10 + text-X-700
 * dark:text-X-400 — matched die akzent-style anderer badges in der app.
 */
export const CATEGORY_BADGE_CLASSES: Record<TransactionCategory, string> = {
  revenue:
    "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400",
  expense: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400",
  transfer:
    "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400",
  system:
    "bg-gray-100 dark:bg-gray-500/10 text-gray-700 dark:text-gray-400",
};

/**
 * Liste aller transaction-types in display-order für filter-dropdowns.
 * Gruppiert nach category (revenue → expense → transfer → system) damit
 * die dropdown logisch lesbar ist.
 */
export const TRANSACTION_TYPES_GROUPED: TransactionType[] = [
  // Revenue
  "REVENUE_PASSENGER",
  "REVENUE_CARGO",
  "REVENUE_TICKET_TWITCH",
  "SALARY_RECEIVED",
  // Expense
  "EXPENSE_FUEL",
  "EXPENSE_LANDING_FEE",
  "EXPENSE_GROUND_HANDLING",
  "EXPENSE_CATERING",
  "EXPENSE_MAINTENANCE",
  "SALARY_PAID",
  // Transfer
  "TRANSFER_OUT",
  "TRANSFER_IN",
  // System
  "ADJUSTMENT_ADMIN",
  "ECONOMY_RESET",
];
