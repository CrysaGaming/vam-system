/**
 * Decimal-utilities für VAM$-finanzarithmetik.
 *
 * Begründung warum Decimal überhaupt:
 *   JavaScript-Number ist IEEE 754 double-precision floating-point. Das
 *   reicht NICHT für finanzwerte: 0.1 + 0.2 === 0.30000000000000004, und
 *   accumulating-fehler über tausende transactions führen zu drift. Der
 *   industry-standard ist arbitrary-precision-decimal — Prisma liefert
 *   das via `Prisma.Decimal` (intern decimal.js).
 *
 * Helper-design:
 *   - `toDecimal(value)`: normalisiert string|number|Decimal zu Decimal.
 *     Akzeptiert nicht NaN/Infinity (throw) — finanzen müssen finit sein.
 *   - `formatVamCurrency(value, opts)`: rendert für UI, z.B. "1.234,56 VAM$".
 *     Locale-fest auf de-DE für jetzt (matchet user-context Kevin's UI-text).
 *     Wenn später multi-locale: extra arg.
 *   - `assertNonNegative(value)`: helper für validation an helper-grenzen.
 *
 * Was hier NICHT rein soll:
 *   - Keine business-logik (revenue-calc, expense-rates) — die wandern
 *     in eigene module (passenger-revenue.ts etc) in Phase 13C.
 *   - Keine I/O — alles pure utilities.
 */

import { Prisma } from "@prisma/client";

/**
 * Re-export der Prisma-Decimal-class als type + value.
 *
 * Nutzung:
 *   import { Decimal } from "@vam/db";
 *   const x = new Decimal("123.45");
 *   const y: Decimal = x.add(10);
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/**
 * Acceptable input für decimal-helpers — was die meisten APIs entgegen-
 * nehmen ohne dass der caller manuell konvertieren muss.
 */
export type DecimalInput = Prisma.Decimal | string | number;

/**
 * Normalize beliebigen numerischen input zu einem Decimal-objekt.
 * Wirft TypeError bei NaN, Infinity, oder unparsbaren strings.
 *
 * @example
 *   toDecimal(42)       // Decimal(42)
 *   toDecimal("3.14")   // Decimal(3.14)
 *   toDecimal(NaN)      // throws TypeError
 */
export function toDecimal(value: DecimalInput): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `toDecimal: value must be finite, got ${value}`,
      );
    }
    // Number → string roundtrip vermeidet IEEE-754-imprecision (z.B.
    // 0.1 wird zu "0.1" statt "0.1000000000000000055511...").
    return new Prisma.Decimal(value.toString());
  }

  // string-pfad: Prisma.Decimal-konstruktor wirft bei invalid input.
  return new Prisma.Decimal(value);
}

/**
 * Formatiert einen VAM$-betrag für UI-display. Default deutsche locale
 * (1.234,56 VAM$) weil Kevin's UI deutsch ist; opts.locale für override.
 *
 * Bewusst nicht Intl.NumberFormat mit currency:'EUR' — VAM$ ist keine
 * ISO-currency, der NumberFormat würde es als "VAM$ 1.234,56" rendern
 * was die zeichen-reihenfolge falsch macht. Manuelles formatting.
 */
export function formatVamCurrency(
  value: DecimalInput,
  opts: { locale?: string; sign?: "auto" | "always" | "never" } = {},
): string {
  const { locale = "de-DE", sign = "auto" } = opts;
  const decimal = toDecimal(value);

  // toFixed(2) gibt einen string mit punkt als decimal-separator zurück,
  // unabhängig von locale. Wir splitten dann selber + applizieren grouping
  // via Intl.NumberFormat (nur für die formatting-options, currency-symbol
  // hängen wir manuell an).
  const fixed = decimal.toFixed(2);
  const isNegative = fixed.startsWith("-");
  const absFixed = isNegative ? fixed.slice(1) : fixed;
  const [intPart, fracPart] = absFixed.split(".");

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(BigInt(intPart!));

  // Locale-bestimmtes decimal-separator. Trick: Intl-formatter mit
  // einer einzelnen kommazahl, dann separator extrahieren.
  const decimalSep =
    new Intl.NumberFormat(locale).formatToParts(1.1).find(
      (p) => p.type === "decimal",
    )?.value ?? ",";

  const numberPart = `${formatted}${decimalSep}${fracPart}`;

  let prefix = "";
  if (sign === "always" && !isNegative) prefix = "+";
  if (isNegative) prefix = "-";

  return `${prefix}${numberPart} VAM$`;
}

/**
 * Throwing assertion: value muss >= 0 sein. Nutzung an helper-grenzen
 * wo "amount" semantisch nicht-negativ sein muss (passenger-count ×
 * fare hat keinen sinn als negativ; transfer-amount ist immer positive
 * mit der direction in TRANSFER_IN/OUT-typ kodiert).
 */
export function assertNonNegative(
  value: DecimalInput,
  fieldName = "value",
): void {
  const decimal = toDecimal(value);
  if (decimal.isNegative()) {
    throw new RangeError(
      `${fieldName} must be non-negative, got ${decimal.toString()}`,
    );
  }
}
