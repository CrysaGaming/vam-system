/**
 * Composite booking-gate-check für Welle 13E Career-System.
 *
 * Was hier rein gehört:
 *   - canPilotFlyAircraft({ userId, aircraftType }) — boolean + missing[]
 *   - shouldEnforceCareerGate({ userId, airlineId }) — dual-flag-check
 *
 * Was NICHT hier rein gehört:
 *   - License-CRUD (./licenses.ts)
 *   - Type-rating-CRUD (./type-ratings.ts)
 *   - Aircraft-requirements lookup-table (./requirements.ts)
 *
 * Verwendung:
 *   In 13E-7 wird der booking-flow (apps/web/app/.../book/...) diesen
 *   helper aufrufen vor dem .create({ state: BOOKED }). Bei !allowed
 *   zeigt UI eine error-card mit `missing`-liste an.
 *
 *   Auch im PIREP-approval-flow (13E-9) wird canPilotFlyAircraft
 *   re-checked als safety-net (falls licenses zwischen booking und
 *   approval expired sind).
 */

import { prisma } from "../index.js";
import type { DbClient } from "../economy/wallet.js";
import { getActiveLicenses } from "./licenses.js";
import { hasTypeRating } from "./type-ratings.js";
import {
  getAircraftRequirements,
  licenseDisplayName,
  type AircraftRequirements,
} from "./requirements.js";

// ─────────────────────────────────────────────────────────────────────────
// shouldEnforceCareerGate
// ─────────────────────────────────────────────────────────────────────────

export interface ShouldEnforceInput {
  userId: string;
  /** Falls null: pilot ist solo (kein airline). */
  airlineId: string | null;
}

/**
 * Dual-flag-gate: career-mode greift NUR wenn BEIDE flags true sind:
 *   - User.careerEnabled
 *   - Airline.careerEnabled
 *
 * Wenn airlineId null: solo-pilot, kein career-mode (keine airline-flag,
 * default-permissive).
 *
 * Diese funktion ist die single-source-of-truth für "soll der gate
 * greifen". Alle UI-checks und API-checks rufen diese helper, sodass die
 * dual-flag-philosophie konsistent über das system durchgehalten wird.
 */
export async function shouldEnforceCareerGate(
  input: ShouldEnforceInput,
  db: DbClient = prisma,
): Promise<boolean> {
  if (!input.airlineId) return false;

  const [user, airline] = await Promise.all([
    db.user.findUnique({
      where: { id: input.userId },
      select: { careerEnabled: true },
    }),
    db.airline.findUnique({
      where: { id: input.airlineId },
      select: { careerEnabled: true },
    }),
  ]);

  return Boolean(user?.careerEnabled && airline?.careerEnabled);
}

// ─────────────────────────────────────────────────────────────────────────
// canPilotFlyAircraft
// ─────────────────────────────────────────────────────────────────────────

export interface CanFlyInput {
  userId: string;
  /** ICAO type-designator. Wird normalisiert (uppercase + trim). */
  aircraftType: string;
}

export interface CanFlyResult {
  /** True wenn pilot alle requirements erfüllt. */
  allowed: boolean;
  /**
   * Human-readable liste der fehlenden requirements. Leer wenn allowed=true.
   * Beispiele:
   *   - "PPL"
   *   - "ATPL (license expired)"
   *   - "Type Rating B738"
   */
  missing: string[];
  /**
   * Vollständige requirements-info für UI-display (z.B. "this aircraft
   * needs: PPL + ME + IR + Type Rating B738").
   */
  requirements: AircraftRequirements;
}

/**
 * Check ob pilot ein aircraft fliegen darf.
 *
 * Logik:
 *   1. getAircraftRequirements(aircraftType) — was wird gebraucht?
 *   2. getActiveLicenses(userId) — was hat er?
 *   3. Set-difference: was fehlt?
 *   4. typeRating-check (wenn requirements.typeRating != null):
 *      hasTypeRating(userId, requirements.typeRating)
 *   5. Result-aggregation
 *
 * Performance-note: getActiveLicenses macht 1 query, hasTypeRating macht
 * 1 query. Total = 2 DB-roundtrips. Das ist akzeptabel für booking-flows
 * (low-throughput). Falls ein bulk-check nötig wird (admin-dashboard
 * "welche piloten dürfen B738 fliegen"), brauchen wir später eine bulk-
 * version.
 *
 * Beachte: diese funktion ENFORCED den gate NICHT — sie reportet nur
 * den status. Der caller (13E-7 booking-handler) muss bei allowed=false
 * den booking blocken UND vorher shouldEnforceCareerGate prüfen.
 */
export async function canPilotFlyAircraft(
  input: CanFlyInput,
  db: DbClient = prisma,
): Promise<CanFlyResult> {
  const aircraftType = input.aircraftType.toUpperCase().trim();
  const requirements = getAircraftRequirements(aircraftType);

  const activeLicenses = await getActiveLicenses(input.userId, db);
  const heldLicenseTypes = new Set(activeLicenses.map((l) => l.type));

  const missing: string[] = [];

  // License-check
  for (const required of requirements.licenses) {
    if (!heldLicenseTypes.has(required)) {
      missing.push(licenseDisplayName(required));
    }
  }

  // Type-rating-check (nur wenn requirement gesetzt)
  if (requirements.typeRating) {
    const hasTR = await hasTypeRating(input.userId, requirements.typeRating, db);
    if (!hasTR) {
      missing.push(`Type Rating ${requirements.typeRating}`);
    }
  }

  return {
    allowed: missing.length === 0,
    missing,
    requirements,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// canPilotFlyAircraftStrict
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wrapper: combined check incl. dual-flag-gate.
 *
 * Returnt:
 *   - { enforced: false } wenn career-mode nicht aktiv (= booking immer erlaubt)
 *   - { enforced: true, ...canFly } sonst
 *
 * Use-case: single-call-helper für booking-handler die KEIN context über
 * dual-flag-philosophie haben sollen — sie checken nur "darf er?".
 */
export interface CanFlyStrictInput {
  userId: string;
  airlineId: string | null;
  aircraftType: string;
}

export type CanFlyStrictResult =
  | { enforced: false; allowed: true; missing: []; requirements: AircraftRequirements }
  | ({ enforced: true } & CanFlyResult);

export async function canPilotFlyAircraftStrict(
  input: CanFlyStrictInput,
  db: DbClient = prisma,
): Promise<CanFlyStrictResult> {
  const enforced = await shouldEnforceCareerGate(
    { userId: input.userId, airlineId: input.airlineId },
    db,
  );

  if (!enforced) {
    return {
      enforced: false,
      allowed: true,
      missing: [],
      requirements: getAircraftRequirements(input.aircraftType),
    };
  }

  const result = await canPilotFlyAircraft(
    { userId: input.userId, aircraftType: input.aircraftType },
    db,
  );

  return { enforced: true, ...result };
}
