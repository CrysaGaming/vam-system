/**
 * Aircraft type-designator resolution for ACARS heartbeats (Welle 9 / M3.8).
 *
 * Combines registration-based fleet lookup with the pure pattern-matching
 * module in `@vam/shared` to turn whatever junk the SimConnect-client
 * sends into a clean ICAO doc-8643 designator ("A21N", "B738", "C172").
 *
 * RESOLUTION ORDER:
 *
 *   1. FLEET — Aircraft.findUnique({where: {registration}}) joined with
 *      AircraftType. If the pilot is flying a registered fleet airframe
 *      AND that airframe has aircraftTypeId set, we use the catalog's
 *      icaoType. This is the GOLD-STANDARD path: every airline-managed
 *      aircraft has known type metadata, so why re-derive it.
 *
 *   2. PATTERN — Regex match against `title` then `type`. See
 *      aircraft-patterns.ts for scope. Catches GA aircraft, non-fleet
 *      airframes, and anyone flying outside their airline.
 *
 *   3. FALLBACK — If the original `type` looks usable (not a leaked
 *      localization-token like "ATCCOM.AC_MODEL"), we keep it. Better a
 *      slightly weird value than nothing. If `type` IS a token, we
 *      return "UNKN" instead so the live-map shows something obviously
 *      placeholder rather than gibberish.
 *
 * NO MIGRATION:
 *   The resolved value goes into the EXISTING `LiveSession.aircraftType`
 *   String column. We deliberately don't add a separate "raw"/"resolved"
 *   pair — if you need the raw value for debugging, the heartbeat's
 *   inbound payload is already audit-logged at the request layer (and
 *   the title still lives unchanged in `LiveSession.aircraftTitle`).
 *   Older sessions with raw garbage stay garbage; only fresh heartbeats
 *   get the cleanup. Acceptable tradeoff for not running a backfill.
 *
 * IDEMPOTENCY:
 *   Calling resolve twice with the same inputs returns the same output.
 *   No mutation of any state. Safe to invoke per-heartbeat.
 *
 * COST:
 *   One indexed `Aircraft.findUnique` lookup by registration
 *   (`@unique` index on Aircraft.registration → O(log n) on Postgres).
 *   At our heartbeat cadence (1-2s) and DB-size (hundreds of airframes,
 *   not millions) this is well below the noise floor.
 */

import { prisma } from '@vam/db';
import {
  matchAircraftPattern,
  isLikelyLocalizationToken,
  type IcaoTypeDesignator,
} from '@vam/shared';

/**
 * Where the resolved value came from. Surfaced in debug logs and
 * potentially in the API-response if we ever want clients to display
 * provenance ("type guessed from title" vs "type confirmed by fleet").
 *
 * - `fleet`    — Aircraft.aircraftType.icaoType lookup hit.
 * - `pattern`  — Regex matched against title or type.
 * - `fallback` — Neither path resolved; we kept the original (or "UNKN").
 */
export type AircraftResolutionSource = 'fleet' | 'pattern' | 'fallback';

export interface ResolvedAircraftType {
  /** The ICAO designator we'll persist on the LiveSession. */
  icaoType: IcaoTypeDesignator;
  /** Provenance — see AircraftResolutionSource doc. */
  source: AircraftResolutionSource;
  /** Optional human-readable label for logs (e.g., "Airbus A321neo").
   *  Null for fleet/fallback where we don't have a label to surface. */
  matchedLabel: string | null;
}

/**
 * Sentinel returned when input is hopeless (empty + token + no match).
 * "UNKN" is a real-world ATC convention for unknown aircraft and
 * displays sensibly in the live-map without leaking the broken token.
 */
const UNKNOWN_PLACEHOLDER = 'UNKN';

export interface AircraftResolutionInput {
  /** Raw aircraftType string from heartbeat — may be a token like "ATCCOM.AC_MODEL". */
  type: string;
  /** Aircraft registration like "D-ANNE". Used for the fleet lookup. */
  registration: string;
  /** Optional full title from SimConnect TITLE simvar — pattern-matching's strongest signal. */
  title?: string | null;
}

/**
 * Resolve an inbound heartbeat's aircraft into a clean ICAO designator.
 * See file-header for the resolution order.
 */
export async function resolveAircraftType(
  input: AircraftResolutionInput,
): Promise<ResolvedAircraftType> {
  // ─── Step 1: fleet lookup by registration ─────────────────────────
  // The registration is on a @unique index, so this is cheap. We only
  // care about the linked AircraftType — if there's no link, this row
  // is legacy (pre-AircraftType-catalog) and we fall through.
  if (input.registration.length > 0) {
    const fleetMatch = await prisma.aircraft.findUnique({
      where: { registration: input.registration },
      select: {
        aircraftType: {
          select: { icaoType: true, name: true },
        },
      },
    });
    if (fleetMatch?.aircraftType?.icaoType) {
      return {
        icaoType: fleetMatch.aircraftType.icaoType,
        source: 'fleet',
        matchedLabel: fleetMatch.aircraftType.name ?? null,
      };
    }
  }

  // ─── Step 2: pattern matching ─────────────────────────────────────
  // Tries title first then type — see aircraft-patterns.ts for why.
  const patternMatch = matchAircraftPattern({
    type: input.type,
    title: input.title ?? null,
  });
  if (patternMatch) {
    return {
      icaoType: patternMatch.icaoType,
      source: 'pattern',
      matchedLabel: patternMatch.matchedLabel,
    };
  }

  // ─── Step 3: fallback / garbage detection ─────────────────────────
  // If the input looks like a localization-token leak, replace with
  // UNKN — better an obvious "I don't know" than displaying the leak.
  // Otherwise, the original was at least a string; keep it.
  const trimmed = input.type.trim();
  if (trimmed.length === 0 || isLikelyLocalizationToken(trimmed)) {
    return {
      icaoType: UNKNOWN_PLACEHOLDER,
      source: 'fallback',
      matchedLabel: null,
    };
  }

  return {
    icaoType: trimmed,
    source: 'fallback',
    matchedLabel: null,
  };
}
