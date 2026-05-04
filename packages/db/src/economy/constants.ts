/**
 * Economy MVP — rates, multipliers, defaults.
 *
 * Quelle für die werte: docs/vision/Economy-Karriere.md sections 7+8
 * (Revenue-Streams + Expense-Streams). Wir nehmen die "industry-research"-
 * defaults aus der spec, vereinfacht für MVP (single-class economy,
 * keine route-popularity/season/marketing-modifier in 13C — die kommen
 * mit dependent features in späteren wellen).
 *
 * Alle werte sind Decimal-objekte, NICHT number — finanz-arithmetic.
 *
 * Tuning-strategy für später:
 *   Diese constants sind hardcoded für MVP. Wenn airlines unterschied-
 *   liche economics brauchen (z.B. premium-airlines mit höherer fare-
 *   structure, low-cost-airlines mit niedrigerer), wird das in Welle 14+
 *   per-airline-overrides via Airline.economyConfig: Json field. Die
 *   constants hier bleiben dann als "system-default-fallback".
 */

import { Decimal } from "./decimal.js";

// ─────────────────────────────────────────────────────────────────────────
// Passenger revenue (Section 7.1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Base ticket-fare per passenger, vor distance-modifier.
 * VAM$ 50 default aus phpVMS-research (siehe spec).
 */
export const BASE_FARE_VAM = new Decimal("50.00");

/**
 * Per-mile-rate. Distance × rate wird zur base-fare addiert.
 * VAM$ 0.11 / nm aus spec.
 */
export const PER_MILE_RATE_VAM = new Decimal("0.11");

/**
 * MVP-simplification: alle passenger sind "economy-class" mit multiplier
 * 1.0. Spec sieht premium=1.5, business=3.0, first=5.0 vor — dafür
 * brauchen wir per-class-booking-data was MVP nicht hat. Der konstante
 * macht die formel forward-compat: wenn später per-class-PIREP-fields
 * dazukommen, multiplizieren wir mit dem class-spezifischen wert.
 */
export const ECONOMY_CLASS_MULTIPLIER = new Decimal("1.00");

// ─────────────────────────────────────────────────────────────────────────
// Cargo revenue (Section 7.2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Default-rate für general-cargo. Spec listet:
 *   general:    0.50 VAM$/kg
 *   perishable: 1.20  (refrigerated)
 *   hazardous:  2.00  (DGR-cert required)
 *   live:       3.00
 *   mail:       0.80  (government-contract)
 *   heavy:      0.40  (volume-based)
 * MVP nutzt nur general — cargo-typ ist nicht in Pirep.cargoKg encoded
 * (wir wissen kg, nicht typ). Wenn später CargoType-enum auf Booking
 * dazukommt, mappen wir den auf die spezifische rate.
 */
export const CARGO_RATE_PER_KG_VAM = new Decimal("0.50");

// ─────────────────────────────────────────────────────────────────────────
// Per-flight expenses (Section 8.1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Jet-A1-fuel-preis pro kg. Real-world ~0.85 EUR/kg ist ca. das mittel
 * der letzten 5 jahre. Im MVP konstant — Welle 15+ aircraft-economy
 * macht das per-airport-dynamic (preis-spread zwischen hubs vs. remote).
 */
export const JET_A1_PRICE_PER_KG_VAM = new Decimal("0.85");

/**
 * Landing-fee per landing. Spec hat per-class:
 *   small=50, medium=200, large=800, hub=1500 VAM$
 * MVP: medium-default für alle. Klassifizierung kommt mit airport-size-
 * tier in Welle 15+ (Airport.feeClass enum).
 *
 * Wir buchen 1× landing-fee pro PIREP — ein flug = eine landung. Die
 * spec spricht von "departure" + "arrival" landing-fees, was real-world
 * sense macht (parking + departure-slot), aber MVP-mäßig vereinfachen
 * wir auf "fee per arrival airport" und sparen den "departure landing
 * fee" für später. Wenn der pilot rückflieg, kommt die nächste fee.
 */
export const LANDING_FEE_DEFAULT_VAM = new Decimal("200");

/**
 * Ground-handling-fee per landing. Per-aircraft-class-default:
 *   GA=20, narrow-body=300, wide-body=800
 * MVP: narrow-body-default für alle. Aircraft.aircraftType.category gibt
 * uns das später (already in schema seit Welle 6, just not used here).
 * 13C-followup könnte das via aircraftType-lookup machen.
 */
export const GROUND_HANDLING_DEFAULT_VAM = new Decimal("300");

/**
 * Catering-cost per passenger. Per-meal-class-default:
 *   snack=2, cold-meal=8, hot-meal=15, full-service=35
 * MVP: cold-meal für alle. Catering-class pro flight kommt mit booking-
 * configuration in Welle 14+ (luxury-service-tier).
 */
export const CATERING_PER_PAX_VAM = new Decimal("8");

// ─────────────────────────────────────────────────────────────────────────
// Pilot salary (Section 8.1 crew_cost)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Base salary per block-hour, für rank.order=0 (junior pilot). Höhere
 * ränge multiplizieren via RANK_PROGRESSION_PER_ORDER — siehe calc-
 * funktion in calc.ts.
 *
 * VAM$ 100/h ist eine reasonable startgehalt. Real-world airline-piloten
 * verdienen ~50-300 EUR/h je nach airline + rank + airframe — wir liegen
 * konservativ in der mitte.
 */
export const PILOT_BASE_SALARY_PER_HOUR_VAM = new Decimal("100");

/**
 * Multiplier-step pro rank.order. order=0 → 1.0×, order=1 → 1.15×,
 * order=2 → 1.30×, ..., order=10 → 2.50×. Linear-progression macht
 * MVP-mäßig sense; spätere rank-systems (Welle 6 hat rank-system bereits)
 * können das per-rank custom override.
 */
export const RANK_PROGRESSION_PER_ORDER = new Decimal("0.15");

/**
 * Hard ceiling für rank-multiplier — verhindert dass airline mit 50
 * rang-stufen plötzlich 8.5× salary zahlt. order > 10 wird auf 10
 * gecapped für die berechnung. Über 10 ranks gibt es ohnehin nicht
 * realistisch.
 */
export const RANK_PROGRESSION_MAX_ORDER = 10;
