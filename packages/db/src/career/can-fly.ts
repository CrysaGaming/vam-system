/**
 * Composite booking-gate-check für Welle 13E Career-System.
 *
 * Was hier rein gehört:
 *   - canPilotFlyAircraft({ userId, aircraftType, enforceCurrency? }) — boolean + missing[]
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

/**
 * Recency-cutoff für type-rating-currency-enforcement (option #29).
 * 90 tage entspricht der EASA Part-FCL "passenger-currency"-norm:
 * "3 takeoffs/landings in 90 days" ist der professional-pilot-standard.
 * Wir vereinfachen das zu "lastFlownAt < 90d" — die multi-event-norm
 * wäre für simulator-VAs zu aggressiv (3 separate flights innerhalb
 * von 90 tagen ist schon bei moderaten VAs keine garantie).
 */
const RECENCY_CUTOFF_DAYS = 90;

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
  /**
   * Option #29: Wenn true, zusätzlicher recency-check auf das type-
   * rating: lastFlownAt muss innerhalb der letzten 90 tage liegen
   * (oder null = never-flown, behandelt wie baseline-fresh weil das
   * type-rating gerade erst erworben wurde und noch keine PIREPs
   * ihre lastFlownAt setzen konnten).
   *
   * Default false → existing semantics: nur expired type-ratings
   * blocken (via hasTypeRating expiresAt-check), recency wird nicht
   * enforced.
   *
   * Wenn caller den dual-gate via shouldEnforceCareerGate gecheckt
   * hat, holt canPilotFlyAircraftStrict diesen wert aus der airline-
   * settings (Airline.enforceTypeRatingCurrency) und gibt ihn weiter.
   * Direkt-aufrufer (z.B. PIREP-approval-revalidation) können den flag
   * unabhängig setzen.
   */
  enforceCurrency?: boolean;
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
   *   - "Type Rating B738 (recency lapsed)"  (nur bei enforceCurrency=true)
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
 *      hasTypeRating(userId, requirements.typeRating)  // blockt expired
 *   5. (Option #29) Wenn enforceCurrency=true UND type-rating-check
 *      pass'd: zusätzlicher recency-check auf lastFlownAt < 90d-cutoff.
 *   6. Result-aggregation
 *
 * Performance-note: getActiveLicenses macht 1 query, hasTypeRating macht
 * 1 query. Bei enforceCurrency=true kommt 1 zusätzlicher findUnique für
 * den lastFlownAt-lookup hinzu (only wenn das type-rating exists). Total
 * = 2-3 DB-roundtrips. Akzeptabel für booking-flows (low-throughput).
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
      // Either rating fehlt komplett ODER ist expired — hasTypeRating
      // returnt false in beiden fällen. Wir können die zwei nicht ohne
      // additional query unterscheiden, also lassen wir die generic
      // message stehen. UI rendert das als "Type Rating B738" und der
      // pilot kann auf /licenses prüfen ob es expiry oder absence ist.
      missing.push(`Type Rating ${requirements.typeRating}`);
    } else if (input.enforceCurrency) {
      // Option #29: type-rating exists und ist nicht expired (sonst
      // wäre hasTR=false). Zusätzlich check ob recency-current.
      // Wir lookup'n lastFlownAt direkt — getUserTypeRatings würde
      // alle ratings holen (overkill für single-aircraft-check).
      const rating = await db.typeRating.findUnique({
        where: {
          userId_aircraftType: {
            userId: input.userId,
            aircraftType: requirements.typeRating,
          },
        },
        select: { lastFlownAt: true },
      });

      // lastFlownAt=null → never-flown nach issue. Wird als baseline-
      // fresh behandelt: das rating ist gerade erworben, der pilot hatte
      // noch keine chance einen flug zu loggen. Sonst wäre der pilot
      // nach der first issuance sofort recency-lapsed bevor er einen
      // einzigen flug machen konnte, was nonsense wäre.
      //
      // lastFlownAt < (now - 90d) → recency-lapsed, blockiert.
      if (rating?.lastFlownAt) {
        const cutoff = new Date(
          Date.now() - RECENCY_CUTOFF_DAYS * 86_400_000,
        );
        if (rating.lastFlownAt < cutoff) {
          missing.push(
            `Type Rating ${requirements.typeRating} (recency lapsed)`,
          );
        }
      }
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
 *
 * Option #29: Wenn airline.enforceTypeRatingCurrency=true, wird der
 * recency-check via canPilotFlyAircraft({enforceCurrency:true}) aktiviert.
 * Das sind die VAs die "regulatory realism mode" wollen — pilot muss in
 * 90d auf dem type geflogen sein um neue bookings auf dem type zu
 * machen.
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
  // Read both career-flag (dual-gate-check) and currency-flag in einem
  // query: sparen den separaten findUnique aus shouldEnforceCareerGate
  // weil wir die airline-row eh brauchen für die currency-decision.
  // User.careerEnabled bleibt separater query (kleiner row, getrennte
  // entity-domain).
  if (!input.airlineId) {
    // Solo-pilot — kein career-gate, kein currency-gate.
    return {
      enforced: false,
      allowed: true,
      missing: [],
      requirements: getAircraftRequirements(input.aircraftType),
    };
  }

  const [user, airline] = await Promise.all([
    db.user.findUnique({
      where: { id: input.userId },
      select: { careerEnabled: true },
    }),
    db.airline.findUnique({
      where: { id: input.airlineId },
      select: {
        careerEnabled: true,
        enforceTypeRatingCurrency: true,
      },
    }),
  ]);

  const enforced = Boolean(user?.careerEnabled && airline?.careerEnabled);

  if (!enforced) {
    return {
      enforced: false,
      allowed: true,
      missing: [],
      requirements: getAircraftRequirements(input.aircraftType),
    };
  }

  // Career-gate aktiv. Currency-flag wird nur bei aktivem career-gate
  // beachtet — sonst wäre es widersprüchlich (career-features off aber
  // recency-block on).
  const result = await canPilotFlyAircraft(
    {
      userId: input.userId,
      aircraftType: input.aircraftType,
      enforceCurrency: airline?.enforceTypeRatingCurrency === true,
    },
    db,
  );

  return { enforced: true, ...result };
}
