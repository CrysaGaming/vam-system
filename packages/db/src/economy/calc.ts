/**
 * Pure calculation functions für economy MVP.
 *
 * Alle funktionen hier sind side-effect-free: input → Decimal output.
 * Kein DB-zugriff, kein async. Macht testen einfach (wenn wir je tests
 * dafür hinzufügen) und macht den orchestrator (process-flight.ts)
 * leicht zu reasonen.
 *
 * Die formeln folgen docs/vision/Economy-Karriere.md sections 7+8 mit
 * MVP-vereinfachungen — siehe ./constants.ts für die rationale pro
 * default-wert.
 */

import { Decimal, type DecimalInput, toDecimal } from "./decimal.js";
import {
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

// ─────────────────────────────────────────────────────────────────────────
// Revenue
// ─────────────────────────────────────────────────────────────────────────

/**
 * Passenger revenue für einen flight.
 *
 * Formel (MVP-vereinfacht aus spec section 7.1):
 *   revenue = passenger_count × (base_fare + per_mile_rate × distance_nm)
 *           × economy_class_multiplier
 *
 * Was die formel NICHT enthält (kommt später):
 *   - load-factor (assumed 100% — passenger_count ist ja "echte zahl der
 *     piloten-mitnahmen", nicht "potential-cap mit ausnutzung")
 *   - route_popularity, day_of_week, season, marketing, pilot_reputation
 *     modifier — alles dependent features die noch nicht existieren
 *   - per-class-breakdown — single-class-economy in MVP
 *
 * @returns Decimal revenue, ≥ 0
 */
export function calculatePassengerRevenue(input: {
  passengerCount: number;
  distanceNm: number;
}): Decimal {
  const { passengerCount, distanceNm } = input;

  if (passengerCount <= 0 || distanceNm <= 0) {
    return new Decimal(0);
  }

  // base_fare + per_mile_rate × distance
  const farePerPax = BASE_FARE_VAM.add(
    PER_MILE_RATE_VAM.mul(distanceNm),
  );

  return farePerPax
    .mul(passengerCount)
    .mul(ECONOMY_CLASS_MULTIPLIER);
}

/**
 * Cargo revenue für einen flight.
 *
 * Formel (MVP-vereinfacht aus spec section 7.2):
 *   revenue = cargo_kg × cargo_rate_per_kg
 *
 * Was die formel NICHT enthält (kommt später):
 *   - urgency_multiplier (perishable, hazardous, etc — MVP nutzt nur "general")
 *   - distance_modifier (long-haul-cargo zahlt mehr in echten airlines)
 *
 * @returns Decimal revenue, ≥ 0
 */
export function calculateCargoRevenue(input: {
  cargoKg: number;
}): Decimal {
  const { cargoKg } = input;

  if (cargoKg <= 0) {
    return new Decimal(0);
  }

  return CARGO_RATE_PER_KG_VAM.mul(cargoKg);
}

// ─────────────────────────────────────────────────────────────────────────
// Expenses
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fuel-cost = fuel_used_kg × jet_a1_price_per_kg.
 *
 * @returns Decimal cost, ≥ 0
 */
export function calculateFuelCost(input: {
  fuelUsedKg: number;
}): Decimal {
  const { fuelUsedKg } = input;

  if (fuelUsedKg <= 0) {
    return new Decimal(0);
  }

  return JET_A1_PRICE_PER_KG_VAM.mul(fuelUsedKg);
}

/**
 * Landing-fee. Im MVP konstant — kein airport-class-lookup.
 * Wenn später airports.feeClass eingeführt wird, dieser helper kriegt
 * eine "feeClass: AirportFeeClass"-param und mappt darauf.
 */
export function calculateLandingFee(): Decimal {
  return LANDING_FEE_DEFAULT_VAM;
}

/**
 * Ground-handling-fee. Im MVP konstant — kein aircraft-class-lookup.
 * Spätere version: param `aircraftCategory: 'narrow_body'|'wide_body'|'ga'`
 * mit table-mapping.
 */
export function calculateGroundHandlingFee(): Decimal {
  return GROUND_HANDLING_DEFAULT_VAM;
}

/**
 * Catering-cost = passenger_count × catering_per_pax.
 *
 * @returns Decimal cost, ≥ 0. Wenn keine passenger, kein catering.
 */
export function calculateCateringCost(input: {
  passengerCount: number;
}): Decimal {
  const { passengerCount } = input;

  if (passengerCount <= 0) {
    return new Decimal(0);
  }

  return CATERING_PER_PAX_VAM.mul(passengerCount);
}

// ─────────────────────────────────────────────────────────────────────────
// Pilot salary
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pilot-salary für einen einzelnen flight.
 *
 * Formel:
 *   block_hours = flight_time_min / 60
 *   rank_multiplier = 1 + min(rank_order, MAX_ORDER) × PROGRESSION_PER_ORDER
 *   salary = block_hours × base_rate × rank_multiplier
 *
 * @param flightTimeMin   block-time des fluges in minuten (aus Pirep.flightTimeMin)
 * @param rankOrder       Rank.order des piloten zur zeit des fluges. 0 für
 *                        junior, höher für senior. Wenn pilot kein rank
 *                        hat (User.rankId=null), undefined → multiplier=1.0.
 * @returns Decimal salary, ≥ 0
 */
export function calculatePilotSalary(input: {
  flightTimeMin: number;
  rankOrder?: number | null;
}): Decimal {
  const { flightTimeMin, rankOrder } = input;

  if (flightTimeMin <= 0) {
    return new Decimal(0);
  }

  const blockHours = new Decimal(flightTimeMin).div(60);

  // Rank-multiplier: 1.0 + capped_order × progression
  const cappedOrder = Math.min(
    Math.max(rankOrder ?? 0, 0),
    RANK_PROGRESSION_MAX_ORDER,
  );
  const rankMultiplier = new Decimal(1).add(
    RANK_PROGRESSION_PER_ORDER.mul(cappedOrder),
  );

  return blockHours
    .mul(PILOT_BASE_SALARY_PER_HOUR_VAM)
    .mul(rankMultiplier);
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregate helper für UI-previews (was würde dieser flight bringen?)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pure-calc-aggregator. Gibt revenue + expenses + salary + net für einen
 * geplanten oder approved-flight zurück. Nutzbar für UI-vorschau (z.B.
 * "diese route würde X VAM$ revenue bringen") ohne DB-writes.
 *
 * Für den orchestrator (process-flight.ts) ist das die single source-of-
 * truth — die orchestrator-fn ruft das hier und bucht dann transactions
 * basierend auf den werten. So bleibt die formel an einer stelle.
 */
export function calculateFlightEconomy(input: {
  passengerCount: number;
  cargoKg: number;
  distanceNm: number;
  fuelUsedKg: number;
  flightTimeMin: number;
  rankOrder?: number | null;
}): {
  revenue: {
    passenger: Decimal;
    cargo: Decimal;
    total: Decimal;
  };
  expenses: {
    fuel: Decimal;
    landing: Decimal;
    groundHandling: Decimal;
    catering: Decimal;
    total: Decimal;
  };
  salary: Decimal;
  /** revenue.total - expenses.total - salary. Kann negativ sein. */
  net: Decimal;
} {
  const passengerRevenue = calculatePassengerRevenue(input);
  const cargoRevenue = calculateCargoRevenue(input);
  const fuelCost = calculateFuelCost(input);
  const landingFee = calculateLandingFee();
  const groundHandling = calculateGroundHandlingFee();
  const catering = calculateCateringCost(input);
  const salary = calculatePilotSalary(input);

  const revenueTotal = passengerRevenue.add(cargoRevenue);
  const expensesTotal = fuelCost
    .add(landingFee)
    .add(groundHandling)
    .add(catering);

  return {
    revenue: {
      passenger: passengerRevenue,
      cargo: cargoRevenue,
      total: revenueTotal,
    },
    expenses: {
      fuel: fuelCost,
      landing: landingFee,
      groundHandling,
      catering,
      total: expensesTotal,
    },
    salary,
    net: revenueTotal.sub(expensesTotal).sub(salary),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Helper für caller die eigene values mit Decimal-arithmetic mischen
// ─────────────────────────────────────────────────────────────────────────

/**
 * Snap eine Decimal auf 2 dezimalstellen (VAM-cent-präzision). Wir tun
 * das beim insert in DB nicht explicit — Postgres' DECIMAL(18,2) trunked
 * automatisch — aber für UI-vorschauen oder summen die NICHT in DB
 * landen, ist das nützlich um floating-tail wegzukriegen.
 *
 * Banker's rounding (default in decimal.js) — round-half-to-even.
 */
export function snapToCents(value: DecimalInput): Decimal {
  return toDecimal(value).toDecimalPlaces(2);
}
