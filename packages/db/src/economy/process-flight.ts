/**
 * Per-PIREP economy-orchestrator.
 *
 * Was macht processFlightEconomy?
 *   Genau die transactions buchen, die einen einzelnen approved PIREP
 *   in den airline + pilot wallets reflektieren. Idempotent via dem
 *   Pirep.revenueProcessed-flag — running this twice for the same
 *   PIREP ist no-op.
 *
 * Aufruf-kontext:
 *   - Beim PIREP-approval-flow (apps/web/app/pireps/actions.ts), nach
 *     der existing $transaction die status+position updated.
 *   - Manuell vom admin via einer "re-eval"-aktion (für corrections —
 *     setzt revenueProcessed back auf false und ruft das hier nochmal).
 *   - Recovery-job (out-of-scope für 13C, könnte später kommen) der
 *     pireps mit status=Approved AND revenueProcessed=false findet
 *     und nachträglich verarbeitet (im fall dass approval-flow
 *     mid-way crashed).
 *
 * Gating-bedingungen (alle müssen true sein, sonst return early):
 *   - Pirep.status === "Approved"
 *   - Pirep.revenueProcessed === false (oder opts.force === true)
 *   - Pirep.airline.economyEnabled === true
 *   - Pirep.user.economyEnabled === true
 *
 * Wenn eine bedingung nicht erfüllt ist, return { processed: false,
 * reason }. Caller kann das loggen oder UI-feedback geben.
 *
 * Transaction-pattern (alle in einer prisma.$transaction):
 *   1. Revenues zuerst (positive auf airline-wallet) — passenger + cargo
 *   2. Expenses (negative auf airline-wallet) — fuel + landing + ground +
 *      catering. Counterparty: keine FK, nur description sagt "fuel-supplier"
 *      etc. SYSTEM-wallet wird im MVP NICHT als counterparty getrackt
 *      (siehe system.ts model-docstring — system-wallet ist forward-compat).
 *   3. Salary als transfer airline → user (TWO legs, automatisch atomic)
 *   4. Pirep-update revenueProcessed=true + revenueProcessedAt=now()
 *
 * Error-handling:
 *   - InsufficientFundsError bei salary-transfer → das ganze $transaction
 *     rolled back. revenueProcessed bleibt false. Caller bekommt error.
 *     UI sollte hint geben "airline-wallet leer, einzahlung nötig".
 *   - Sonstige errors (DB unreachable, etc.) → propagate. Roll-back.
 *
 * Was 13C NICHT macht:
 *   - Marketing-budget (würde load-factor beeinflussen — kommt später)
 *   - Per-airport landing-fee-class (medium-default für alle)
 *   - Per-aircraft-class ground-handling (narrow-body-default)
 *   - Cargo-typ-spezifische rates (general-default)
 *   - Pilot-reputation-modifier
 *   - Twitch-ticket-revenue (Welle 14)
 *   - Maintenance-reserve (Welle 15+)
 */

import {
  type Transaction,
} from "@prisma/client";
import { prisma } from "../index.js";
import { Decimal } from "./decimal.js";
import {
  getOrCreateWallet,
  recordTransaction,
  transfer,
} from "./wallet.js";
import { calculateFlightEconomy } from "./calc.js";

/**
 * Default credit-puffer für airline-wallets beim allerersten anlegen.
 * Verhindert dass die erste expense-transaktion auf insufficient-funds
 * läuft bevor revenues gebucht werden — die ordering im orchestrator
 * (revenues first) macht das praktisch unnötig, aber als safety-net
 * für edge-cases (route ohne pax/cargo aber mit fuel-cost).
 *
 * 100k VAM$ deckt grob 20 unprofitable kurzstrecken-flights. Realistisch
 * sollte eine airline nie negativ stehen wenn pax+cargo gebucht werden.
 */
const AIRLINE_STARTER_CREDIT_LIMIT_VAM = "100000";

export interface ProcessFlightOptions {
  /**
   * Wenn true, ignoriert revenueProcessed=true und re-bucht trotzdem.
   * NICHT für normalen flow — admin-tool für corrections wo der admin
   * vorher revenueProcessed manuell auf false zurückgesetzt hat (was
   * allein nicht "doppelt-buchen" verhindern würde wenn force gesetzt
   * ist). Fauxleaf: caller verantwortlich dass das nur einmal passiert.
   */
  force?: boolean;
}

/**
 * Result-shape von processFlightEconomy. Discriminated union via
 * `processed`-flag.
 */
export type ProcessFlightResult =
  | {
      processed: true;
      transactions: Transaction[];
      summary: {
        revenue: { passenger: Decimal; cargo: Decimal; total: Decimal };
        expenses: {
          fuel: Decimal;
          landing: Decimal;
          groundHandling: Decimal;
          catering: Decimal;
          total: Decimal;
        };
        salary: Decimal;
        net: Decimal;
      };
    }
  | {
      processed: false;
      reason:
        | "not-approved"
        | "already-processed"
        | "airline-economy-disabled"
        | "user-economy-disabled"
        | "missing-flight-data";
    };

/**
 * Verarbeite economy für einen einzelnen approved PIREP.
 *
 * @returns ProcessFlightResult — entweder { processed: true, ... } mit den
 *   gebuchten transactions, oder { processed: false, reason } wenn eine
 *   gating-bedingung das verhindert hat (kein error-state, nur "skip").
 *
 * @throws InsufficientFundsError wenn airline-wallet (auch nach credit-
 *   puffer) salary nicht zahlen kann
 * @throws Error bei DB-fehlern
 */
export async function processFlightEconomy(
  pirepId: string,
  opts: ProcessFlightOptions = {},
): Promise<ProcessFlightResult> {
  const { force = false } = opts;

  // Step 1: load PIREP + dependencies. Outside transaction — read-only.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    include: {
      airline: { select: { id: true, economyEnabled: true } },
      user: {
        select: {
          id: true,
          economyEnabled: true,
          rank: { select: { order: true, salaryMultiplier: true } },
        },
      },
      route: { select: { distanceNm: true } },
      departure: { select: { latitude: true, longitude: true } },
      arrival: { select: { latitude: true, longitude: true } },
    },
  });

  if (!pirep) {
    throw new Error(`processFlightEconomy: Pirep not found: ${pirepId}`);
  }

  // Step 2: gating
  if (pirep.status !== "Approved") {
    return { processed: false, reason: "not-approved" };
  }
  if (pirep.revenueProcessed && !force) {
    return { processed: false, reason: "already-processed" };
  }
  if (!pirep.airline.economyEnabled) {
    return { processed: false, reason: "airline-economy-disabled" };
  }
  if (!pirep.user.economyEnabled) {
    return { processed: false, reason: "user-economy-disabled" };
  }

  // Step 3: distance ermitteln. Route hat distanceNm vorab berechnet.
  // Free-flight-PIREPs (kein routeId) → haversine aus departure/arrival
  // koordinaten.
  const distanceNm =
    pirep.route?.distanceNm ??
    haversineDistanceNm(
      pirep.departure.latitude,
      pirep.departure.longitude,
      pirep.arrival.latitude,
      pirep.arrival.longitude,
    );

  // Step 4: edge-case — wenn weder pax/cargo noch fuel/flight-time, gibt
  // es nichts zu buchen. Das passiert bei legacy-PIREPs ohne diese
  // datenfelder (alle null). Wir markieren als processed (sonst recovery-
  // job triggert endless), aber buchen nichts.
  const hasAnyData =
    (pirep.passengerCount ?? 0) > 0 ||
    (pirep.cargoKg ?? 0) > 0 ||
    (pirep.fuelUsedKg ?? 0) > 0 ||
    (pirep.flightTimeMin ?? 0) > 0;

  if (!hasAnyData) {
    // Mark as processed to prevent re-eval-loops, but don't book anything.
    await prisma.pirep.update({
      where: { id: pirepId },
      data: { revenueProcessed: true, revenueProcessedAt: new Date() },
    });
    return { processed: false, reason: "missing-flight-data" };
  }

  // Step 5: economy ausrechnen (pure-fn, keine I/O)
  const summary = calculateFlightEconomy({
    passengerCount: pirep.passengerCount ?? 0,
    cargoKg: pirep.cargoKg ?? 0,
    distanceNm,
    fuelUsedKg: pirep.fuelUsedKg ?? 0,
    flightTimeMin: pirep.flightTimeMin ?? 0,
    rankOrder: pirep.user.rank?.order,
    // Welle 13E-10: explicit per-rank multiplier durchreichen. Default
    // 1.00 in DB → calc.ts fällt auf legacy order-skalierung zurück
    // (siehe calculatePilotSalary docstring). Wenn admin den multiplier
    // auf z.B. 1.5 gesetzt hat, wird der hier verwendet.
    rankSalaryMultiplier: pirep.user.rank?.salaryMultiplier ?? null,
  });

  // Step 6: get-or-create wallets. Außerhalb der atomic-transaction —
  // wallet-creation hat eigene atomicity (race-conditions akzeptabel,
  // siehe getOrCreateWallet docstring) und es ist ok wenn das wallet
  // schon existiert wenn die transactions starten.
  const airlineWallet = await getOrCreateWallet({
    ownerType: "AIRLINE",
    ownerAirlineId: pirep.airline.id,
    walletType: "primary",
    starterCreditLimit: AIRLINE_STARTER_CREDIT_LIMIT_VAM,
  });
  const userWallet = await getOrCreateWallet({
    ownerType: "USER",
    ownerUserId: pirep.user.id,
    walletType: "primary",
  });

  // Step 7: alle transactions in einem $transaction. Bei error rollback
  // alles inkl. der revenueProcessed-flag. Idempotent für retries.
  const transactions = await prisma.$transaction(async (tx) => {
    const booked: Transaction[] = [];

    // 7a) Passenger revenue (wenn > 0)
    if (summary.revenue.passenger.greaterThan(0)) {
      booked.push(
        await recordTransaction({
          walletId: airlineWallet.id,
          amount: summary.revenue.passenger,
          type: "REVENUE_PASSENGER",
          category: "passenger-tickets",
          description: `Passagier-Einnahmen: ${pirep.passengerCount} Pax`,
          pirepId,
          metadata: {
            passengerCount: pirep.passengerCount ?? 0,
            distanceNm,
          },
          db: tx,
        }),
      );
    }

    // 7b) Cargo revenue (wenn > 0)
    if (summary.revenue.cargo.greaterThan(0)) {
      booked.push(
        await recordTransaction({
          walletId: airlineWallet.id,
          amount: summary.revenue.cargo,
          type: "REVENUE_CARGO",
          category: "cargo-general",
          description: `Cargo-Einnahmen: ${pirep.cargoKg} kg`,
          pirepId,
          metadata: { cargoKg: pirep.cargoKg ?? 0 },
          db: tx,
        }),
      );
    }

    // 7c) Fuel expense (wenn > 0)
    if (summary.expenses.fuel.greaterThan(0)) {
      booked.push(
        await recordTransaction({
          walletId: airlineWallet.id,
          amount: summary.expenses.fuel.neg(),
          type: "EXPENSE_FUEL",
          category: "fuel-jet-a",
          description: `Treibstoff: ${pirep.fuelUsedKg} kg Jet-A1`,
          pirepId,
          metadata: { fuelUsedKg: pirep.fuelUsedKg ?? 0 },
          db: tx,
        }),
      );
    }

    // 7d) Landing fee (immer — fixed default, könnte 0 nicht passieren)
    booked.push(
      await recordTransaction({
        walletId: airlineWallet.id,
        amount: summary.expenses.landing.neg(),
        type: "EXPENSE_LANDING_FEE",
        category: "landing-fee",
        description: `Landegebühr (Standard-Tarif)`,
        pirepId,
        db: tx,
      }),
    );

    // 7e) Ground-handling (immer)
    booked.push(
      await recordTransaction({
        walletId: airlineWallet.id,
        amount: summary.expenses.groundHandling.neg(),
        type: "EXPENSE_GROUND_HANDLING",
        category: "ground-handling",
        description: `Ground-Handling (Narrow-Body-Tarif)`,
        pirepId,
        db: tx,
      }),
    );

    // 7f) Catering (wenn passengers > 0)
    if (summary.expenses.catering.greaterThan(0)) {
      booked.push(
        await recordTransaction({
          walletId: airlineWallet.id,
          amount: summary.expenses.catering.neg(),
          type: "EXPENSE_CATERING",
          category: "catering-cold-meal",
          description: `Catering: ${pirep.passengerCount} Pax`,
          pirepId,
          metadata: { passengerCount: pirep.passengerCount ?? 0 },
          db: tx,
        }),
      );
    }

    // 7g) Salary transfer (wenn > 0). Two legs als ein transfer-call.
    if (summary.salary.greaterThan(0)) {
      const { outTx, inTx } = await transfer({
        fromWalletId: airlineWallet.id,
        toWalletId: userWallet.id,
        amount: summary.salary,
        category: "pilot-salary",
        description: `Gehalt: ${((pirep.flightTimeMin ?? 0) / 60).toFixed(2)} Std.`,
        pirepId,
        outType: "SALARY_PAID",
        inType: "SALARY_RECEIVED",
        metadata: {
          flightTimeMin: pirep.flightTimeMin ?? 0,
          rankOrder: pirep.user.rank?.order ?? 0,
        },
        db: tx,
      });
      booked.push(outTx, inTx);
    }

    // 7h) Mark PIREP as processed
    await tx.pirep.update({
      where: { id: pirepId },
      data: {
        revenueProcessed: true,
        revenueProcessedAt: new Date(),
      },
    });

    return booked;
  });

  return {
    processed: true,
    transactions,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────

/**
 * Haversine-distance zwischen zwei lat/lon-points in nautischen meilen.
 *
 * Formel-quelle: standard greater-circle-distance.
 *   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
 *   c = 2 · atan2(√a, √(1−a))
 *   d = R · c
 *
 * Earth-radius R = 3440.065 NM (entspricht 6371.0 km / 1.852).
 *
 * Genauigkeit: für unsere zwecke (revenue-rechnung) reicht haversine
 * voll aus — der fehler vs. präziseren Vincenty-formel ist <0.5% bei
 * realistischen flight-distances. Spec-realistic.
 */
function haversineDistanceNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3440.065; // earth-radius in nautical miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}
