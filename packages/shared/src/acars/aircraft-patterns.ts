/**
 * MSFS aircraft → ICAO type-designator pattern matching (Welle 9 / M3.8).
 *
 * Pure deterministic regex table that maps SimConnect-derived strings
 * (ATC MODEL, TITLE, atc_model.cfg) onto canonical ICAO doc-8643
 * type designators ("A21N", "B738", "C172"). No DB access — see
 * apps/web/lib/acars/aircraft-resolution.ts for the orchestrating helper
 * that combines pattern-matching with fleet-registration lookup.
 *
 * WHY THIS EXISTS:
 *   SimConnect's `ATC MODEL` simvar reads the `atc_model` field from
 *   aircraft.cfg, which in many MSFS aircraft is set to a localization
 *   key like "ATCCOM.AC_MODEL" instead of the actual model name. The
 *   live-map then displays that token verbatim, which is unhelpful to
 *   say the least. We salvage the situation by also reading the
 *   `TITLE` simvar (full aircraft name like "Asobo A320neo Lufthansa")
 *   and pattern-matching against both.
 *
 * MATCHING ORDER:
 *   `matchAircraftPattern` tries patterns sequentially, first against
 *   `title` then against `type`. First match wins. Patterns are ordered
 *   from MOST SPECIFIC to LEAST SPECIFIC so e.g. "A320neo" matches
 *   A20N before the broader "A320" pattern catches it.
 *
 * SCOPE:
 *   Curated list of ~50 common MSFS / general-aviation aircraft. NOT
 *   exhaustive. If a pilot flies something exotic, we fall back to the
 *   raw SimConnect value (caller's responsibility — see the resolver
 *   helper). Adding new patterns is cheap; over time this grows by
 *   responding to "my aircraft shows up as junk" reports.
 *
 * FALSE-POSITIVE RISK:
 *   Regex on free-form aircraft names is inherently fragile. We accept
 *   small false-positive rate (e.g., a livery containing "B738" in its
 *   name causing wrong type) in exchange for the >90% case where the
 *   pattern is the only signal we have. Fleet-registration lookup
 *   ALWAYS wins over pattern-matching at the orchestration layer —
 *   see resolveAircraftType().
 */

/** ICAO doc-8643 type designators we currently recognize. Not an enum
 *  — kept open so the resolver can pass through unknown but valid
 *  values from fleet-lookup without recompilation. */
export type IcaoTypeDesignator = string;

/**
 * One pattern entry. `regex` is matched against the input string;
 * first regex to match wins. `label` is a human-readable description
 * shown only in tests and debug logs — never in user-facing output.
 */
interface AircraftPattern {
  regex: RegExp;
  icao: IcaoTypeDesignator;
  label: string;
}

/**
 * Pattern table. Ordering is significant: more specific patterns
 * MUST appear before broader ones that would also match.
 *
 * General rules to keep matches sane:
 * - Use `\b` word-boundaries where useful so "A320" doesn't match
 *   "A3201" or "MA320".
 * - For variant suffixes (neo, MAX, ER), use a negative lookahead on
 *   the broader pattern so e.g. "A320" doesn't swallow "A320neo".
 * - Allow optional whitespace and punctuation between known tokens
 *   (e.g. "B 737-800", "B737 800", "B-737-800" all map to B738).
 * - Case-insensitive flag is on every pattern (`i`) — AAA320 and
 *   a320 should both match.
 */
const PATTERNS: readonly AircraftPattern[] = [
  // ─── Airbus narrowbody — neo variants must come before legacy ──────
  { regex: /\bA\s*-?\s*319\s*neo\b/i, icao: 'A19N', label: 'Airbus A319neo' },
  { regex: /\bA\s*-?\s*320\s*neo\b/i, icao: 'A20N', label: 'Airbus A320neo' },
  { regex: /\bA\s*-?\s*321\s*neo\b/i, icao: 'A21N', label: 'Airbus A321neo' },
  // Legacy ceo. Negative lookahead avoids stealing "A320neo" matches
  // that may have slipped past the neo patterns above (e.g. from
  // hyphenated "A-320-neo" with unusual whitespace).
  { regex: /\bA\s*-?\s*318\b(?!\s*neo)/i, icao: 'A318', label: 'Airbus A318' },
  { regex: /\bA\s*-?\s*319\b(?!\s*neo)/i, icao: 'A319', label: 'Airbus A319' },
  { regex: /\bA\s*-?\s*320\b(?!\s*neo)/i, icao: 'A320', label: 'Airbus A320' },
  { regex: /\bA\s*-?\s*321\b(?!\s*neo)/i, icao: 'A321', label: 'Airbus A321' },

  // ─── Airbus widebody ──────────────────────────────────────────────
  { regex: /\bA\s*-?\s*330\s*-?\s*200\b/i, icao: 'A332', label: 'Airbus A330-200' },
  { regex: /\bA\s*-?\s*330\s*-?\s*300\b/i, icao: 'A333', label: 'Airbus A330-300' },
  { regex: /\bA\s*-?\s*330\s*-?\s*800\b|\bA330neo800\b/i, icao: 'A338', label: 'Airbus A330-800neo' },
  { regex: /\bA\s*-?\s*330\s*-?\s*900\b|\bA330neo900\b|\bA330\s*neo\b/i, icao: 'A339', label: 'Airbus A330-900neo' },
  { regex: /\bA\s*-?\s*340\s*-?\s*200\b/i, icao: 'A342', label: 'Airbus A340-200' },
  { regex: /\bA\s*-?\s*340\s*-?\s*300\b/i, icao: 'A343', label: 'Airbus A340-300' },
  { regex: /\bA\s*-?\s*340\s*-?\s*500\b/i, icao: 'A345', label: 'Airbus A340-500' },
  { regex: /\bA\s*-?\s*340\s*-?\s*600\b/i, icao: 'A346', label: 'Airbus A340-600' },
  { regex: /\bA\s*-?\s*350\s*-?\s*900\b|\bA350\s*-?\s*XWB\b/i, icao: 'A359', label: 'Airbus A350-900' },
  { regex: /\bA\s*-?\s*350\s*-?\s*1000\b/i, icao: 'A35K', label: 'Airbus A350-1000' },
  { regex: /\bA\s*-?\s*380\b/i, icao: 'A388', label: 'Airbus A380-800' },

  // ─── Boeing 737 family — MAX before ceo, like neo/ceo above ────────
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*MAX\s*-?\s*7\b|\bB37M\b/i, icao: 'B37M', label: 'Boeing 737 MAX 7' },
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*MAX\s*-?\s*8\b|\bB38M\b/i, icao: 'B38M', label: 'Boeing 737 MAX 8' },
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*MAX\s*-?\s*9\b|\bB39M\b/i, icao: 'B39M', label: 'Boeing 737 MAX 9' },
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*MAX\s*-?\s*10\b|\bB3XM\b/i, icao: 'B3XM', label: 'Boeing 737 MAX 10' },
  // Legacy Next-Generation. Negative lookahead so "737-800MAX" or
  // "737 MAX 8" don't get demoted to B738.
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*600\b/i, icao: 'B736', label: 'Boeing 737-600' },
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*700\b/i, icao: 'B737', label: 'Boeing 737-700' },
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*800\b(?!\s*MAX)/i, icao: 'B738', label: 'Boeing 737-800' },
  { regex: /\b(?:737|B\s*-?\s*737)\s*-?\s*900\b(?!\s*MAX)/i, icao: 'B739', label: 'Boeing 737-900' },

  // ─── Boeing 747 / 757 / 767 ───────────────────────────────────────
  { regex: /\b(?:747|B\s*-?\s*747)\s*-?\s*8\b/i, icao: 'B748', label: 'Boeing 747-8' },
  { regex: /\b(?:747|B\s*-?\s*747)\s*-?\s*400\b/i, icao: 'B744', label: 'Boeing 747-400' },
  { regex: /\b(?:747|B\s*-?\s*747)\s*-?\s*200\b/i, icao: 'B742', label: 'Boeing 747-200' },
  { regex: /\b(?:757|B\s*-?\s*757)\s*-?\s*200\b/i, icao: 'B752', label: 'Boeing 757-200' },
  { regex: /\b(?:757|B\s*-?\s*757)\s*-?\s*300\b/i, icao: 'B753', label: 'Boeing 757-300' },
  { regex: /\b(?:767|B\s*-?\s*767)\s*-?\s*200\b/i, icao: 'B762', label: 'Boeing 767-200' },
  { regex: /\b(?:767|B\s*-?\s*767)\s*-?\s*300\b/i, icao: 'B763', label: 'Boeing 767-300' },
  { regex: /\b(?:767|B\s*-?\s*767)\s*-?\s*400\b/i, icao: 'B764', label: 'Boeing 767-400' },

  // ─── Boeing 777 ───────────────────────────────────────────────────
  { regex: /\b(?:777|B\s*-?\s*777)\s*-?\s*200\s*LR\b|\bB77L\b/i, icao: 'B77L', label: 'Boeing 777-200LR' },
  { regex: /\b(?:777|B\s*-?\s*777)\s*-?\s*200\s*F\b|\bB77F\b/i, icao: 'B77F', label: 'Boeing 777-200F' },
  { regex: /\b(?:777|B\s*-?\s*777)\s*-?\s*300\s*ER\b|\bB77W\b/i, icao: 'B77W', label: 'Boeing 777-300ER' },
  { regex: /\b(?:777|B\s*-?\s*777)\s*-?\s*200\b/i, icao: 'B772', label: 'Boeing 777-200' },
  { regex: /\b(?:777|B\s*-?\s*777)\s*-?\s*300\b/i, icao: 'B773', label: 'Boeing 777-300' },

  // ─── Boeing 787 Dreamliner ────────────────────────────────────────
  { regex: /\b(?:787|B\s*-?\s*787)\s*-?\s*8\b|\bB788\b|\b787\s*Dream/i, icao: 'B788', label: 'Boeing 787-8' },
  { regex: /\b(?:787|B\s*-?\s*787)\s*-?\s*9\b|\bB789\b/i, icao: 'B789', label: 'Boeing 787-9' },
  { regex: /\b(?:787|B\s*-?\s*787)\s*-?\s*10\b|\bB78X\b/i, icao: 'B78X', label: 'Boeing 787-10' },

  // ─── Embraer ──────────────────────────────────────────────────────
  { regex: /\bE\s*-?\s*170\b|\bERJ\s*-?\s*170\b/i, icao: 'E170', label: 'Embraer E170' },
  { regex: /\bE\s*-?\s*175\b|\bERJ\s*-?\s*175\b/i, icao: 'E175', label: 'Embraer E175' },
  { regex: /\bE\s*-?\s*190(?:\s*-?\s*E2)?\b|\bERJ\s*-?\s*190\b/i, icao: 'E290', label: 'Embraer E190-E2' },
  { regex: /\bE\s*-?\s*195(?:\s*-?\s*E2)?\b|\bERJ\s*-?\s*195\b/i, icao: 'E295', label: 'Embraer E195-E2' },

  // ─── Regional turboprops ──────────────────────────────────────────
  { regex: /\bATR\s*-?\s*72\b/i, icao: 'AT72', label: 'ATR 72' },
  { regex: /\bATR\s*-?\s*42\b/i, icao: 'AT42', label: 'ATR 42' },
  { regex: /\bDash\s*-?\s*8\s*-?\s*Q?400\b|\bDHC-?8-?Q?400\b/i, icao: 'DH8D', label: 'Dash 8-Q400' },

  // ─── Cessna single-engine ─────────────────────────────────────────
  { regex: /\bC\s*-?\s*152\b|Cessna\s*152/i, icao: 'C152', label: 'Cessna 152' },
  { regex: /\bC\s*-?\s*172\b|Cessna\s*172|Skyhawk/i, icao: 'C172', label: 'Cessna 172' },
  { regex: /\bC\s*-?\s*182\b|Cessna\s*182|Skylane/i, icao: 'C182', label: 'Cessna 182' },
  { regex: /\bC\s*-?\s*208\b|Cessna\s*208|Caravan/i, icao: 'C208', label: 'Cessna 208 Caravan' },

  // ─── Cessna Citation ──────────────────────────────────────────────
  { regex: /Citation\s*Longitude|\bC\s*-?\s*700\b/i, icao: 'C700', label: 'Citation Longitude' },
  { regex: /Citation\s*X\b|\bC\s*-?\s*750\b/i, icao: 'C750', label: 'Citation X' },
  { regex: /Citation\s*CJ4|\bC\s*-?\s*25C\b/i, icao: 'C25C', label: 'Citation CJ4' },

  // ─── GA / training / light twins ──────────────────────────────────
  { regex: /\bDA\s*-?\s*40(?:NG)?\b|Diamond\s*DA40/i, icao: 'DA40', label: 'Diamond DA40' },
  { regex: /\bDA\s*-?\s*42\b|Diamond\s*DA42/i, icao: 'DA42', label: 'Diamond DA42' },
  { regex: /\bDA\s*-?\s*62\b|Diamond\s*DA62/i, icao: 'DA62', label: 'Diamond DA62' },
  { regex: /\bSR\s*-?\s*22\b|Cirrus\s*SR22/i, icao: 'SR22', label: 'Cirrus SR22' },
  { regex: /\bSR\s*-?\s*20\b|Cirrus\s*SR20/i, icao: 'SR20', label: 'Cirrus SR20' },
  { regex: /\bPA\s*-?\s*28\b|Piper\s*Cherokee|Piper\s*Archer|Piper\s*Warrior/i, icao: 'PA28', label: 'Piper PA-28' },
  { regex: /\bTBM\s*-?\s*9(?:30|40)?\b|TBM\s*930|TBM\s*940/i, icao: 'TBM9', label: 'Daher TBM 930/940' },
  { regex: /\bKing\s*Air\s*350\b|\bB350\b/i, icao: 'B350', label: 'King Air 350' },
] as const;

/**
 * Localization-token pattern: MSFS sometimes leaks raw aircraft.cfg
 * keys like "ATCCOM.AC_MODEL_320_AIRBUS" or "$$:NAME_KEY". Detecting
 * this lets the resolver throw the value away rather than presenting
 * it as an aircraft type. Conservative pattern — only matches strings
 * that consist entirely of upper-case tokens separated by `.` or `:`.
 */
const LOCALIZATION_TOKEN_REGEX = /^(?:\$\$:|TT:|@@:)?[A-Z][A-Z0-9_]*(?:[.:][A-Z0-9_]+)+$/;

export interface AircraftPatternMatch {
  /** ICAO doc-8643 designator (e.g., "A21N", "B738"). */
  icaoType: IcaoTypeDesignator;
  /** Which input field the pattern fired on — `title` is preferred, `type` is fallback. */
  matchedOn: 'title' | 'type';
  /** The pattern label that won, for debug logging. NOT user-facing. */
  matchedLabel: string;
}

/**
 * Try each pattern in order against `title` first, then `type`.
 * Returns the first match or null. Whitespace-trimmed inputs;
 * empty strings are treated as null.
 *
 * Why title first: MSFS aircraft titles are usually rich English
 * strings ("Asobo A320neo Lufthansa") that embed model info reliably.
 * `type` (from ATC MODEL simvar) is often a localization token or
 * abbreviated string. Title gives us the better signal when both
 * are present.
 */
export function matchAircraftPattern(input: {
  type?: string | null;
  title?: string | null;
}): AircraftPatternMatch | null {
  const title = input.title?.trim();
  const type = input.type?.trim();

  for (const p of PATTERNS) {
    if (title && p.regex.test(title)) {
      return { icaoType: p.icao, matchedOn: 'title', matchedLabel: p.label };
    }
  }
  for (const p of PATTERNS) {
    if (type && p.regex.test(type)) {
      return { icaoType: p.icao, matchedOn: 'type', matchedLabel: p.label };
    }
  }
  return null;
}

/**
 * True if `value` looks like a raw MSFS localization-token leak
 * (e.g., "ATCCOM.AC_MODEL", "$$:LOC_AC_MODEL"). The resolver uses
 * this to decide whether to keep or discard the original `type`
 * value as a last-resort fallback — we'd rather store nothing than
 * show pilots a key like "ATCCOM.AC_MODEL" on the live-map.
 */
export function isLikelyLocalizationToken(value: string): boolean {
  return LOCALIZATION_TOKEN_REGEX.test(value.trim());
}
