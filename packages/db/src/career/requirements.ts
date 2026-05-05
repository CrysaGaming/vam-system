/**
 * Aircraft → license-requirements lookup für Welle 13E Career-System.
 *
 * Was hier rein gehört:
 *   - getAircraftRequirements(icaoType) — composite-lookup mit fallback
 *   - inferAircraftCategory(icaoType)   — pattern-matching auf ICAO-codes
 *   - AircraftCategory enum + per-category default-requirements
 *   - Explicit per-ICAO overrides für die häufigsten typen
 *
 * Was NICHT hier rein gehört:
 *   - License/type-rating lookups gegen DB (./licenses.ts, ./type-ratings.ts)
 *   - Composite booking-gate (./can-fly.ts)
 *
 * Design-prinzip:
 *   ICAO type-designators sind 4-zeichen codes (B738, A20N, C172). Der
 *   katalog ist groß (1000+ existing types) und wir wollen NICHT jeden
 *   einzeln pflegen. Stattdessen: kategorisiere via prefix-pattern, dann
 *   default-requirements pro kategorie. Häufige typen kriegen zusätzliche
 *   overrides (z.B. "B738 braucht specifically TR-B738", default für
 *   narrowbody hätte nur "irgendein TR" gesagt).
 *
 * Fallback-policy:
 *   Unbekannter ICAO-typ → strict mode default. Wenn keine kategorie
 *   inferrierbar ist, wird PPL als minimum-license gefordert + kein
 *   type-rating-zwang (für GA-aircraft die wir nicht kennen). Admins
 *   können in der UI einen aircraft als "career-relevant" markieren oder
 *   einzeln overrides definieren (kommt später, nicht im MVP).
 *
 * MCC-policy:
 *   Multi-Crew Cooperation ist required für aircraft die certification-
 *   tatsächlich 2-pilot-ops haben. Faustregel: alles wide-body + die
 *   meisten narrow-bodies. Light-twins (BE76, PA34) sind single-pilot.
 *   Regionals sind grenzwertig — wir setzen sie auf MCC-required für
 *   den realistic-mode (CRJ7, E190 sind definitively 2-crew).
 */

import type { LicenseType } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────
// AircraftCategory
// ─────────────────────────────────────────────────────────────────────────

/**
 * Grob-kategorisierung für default-requirements. Reicht von kleinem
 * trainer (SE_PISTON) bis ultra-long-range (HEAVY_WIDEBODY).
 */
export type AircraftCategory =
  | "SE_PISTON" // Cessna 172, Piper Cherokee — PPL ausreichend
  | "ME_PISTON" // Beech 76, Seminole — PPL + ME
  | "SE_TURBINE" // Caravan, PC-12 — CPL + IR + (TR specific)
  | "ME_TURBINE_LIGHT" // King Air 90/200 — CPL + ME + IR
  | "ME_TURBINE_REGIONAL" // ATR, Q400, CRJ — CPL + ME + IR + TR + MCC
  | "ME_TURBINE_NARROWBODY" // 737, A320 family — ATPL frozen + ME + IR + TR + MCC
  | "ME_TURBINE_WIDEBODY" // 777, A350, 747 — ATPL + ME + IR + TR + MCC
  | "HELI" // R22, EC135 — separate license-pfad (PPL-H, CPL-H)
  | "UNKNOWN";

// ─────────────────────────────────────────────────────────────────────────
// AircraftRequirements
// ─────────────────────────────────────────────────────────────────────────

export interface AircraftRequirements {
  /**
   * Alle license-types in dieser liste müssen ACTIVE sein. Order ist
   * irrelevant (wir prüfen unordered).
   */
  licenses: LicenseType[];
  /**
   * Specific type-rating required. NULL = kein type-rating (typisch für
   * GA-aircraft unter der commercial-grenze). Wenn gesetzt, muss der
   * pilot einen TypeRating-record für genau diesen aircraftType-string
   * haben, der nicht expired ist.
   */
  typeRating: string | null;
  /**
   * Convenience-flag. True wenn LicenseType.MCC in licenses[] ist —
   * primär für UI-display ("MCC erforderlich"-badge), die actual gate-
   * logik liest einfach licenses[].
   */
  mccRequired: boolean;
  /**
   * Zur transparenz: welche kategorie wurde gematcht? UI kann "this is
   * a wide-body, requires ATPL"-erklärungen anzeigen.
   */
  category: AircraftCategory;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-category default-requirements
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_REQUIREMENTS: Record<
  AircraftCategory,
  Omit<AircraftRequirements, "category" | "typeRating">
> = {
  SE_PISTON: {
    licenses: ["PPL"],
    mccRequired: false,
  },
  ME_PISTON: {
    licenses: ["PPL", "MULTI_ENGINE_RATING"],
    mccRequired: false,
  },
  SE_TURBINE: {
    // Single-engine turbine ist selten als trainer — wir setzen CPL als minimum
    // weil meiste betreiber commercial-ops sind.
    licenses: ["CPL", "INSTRUMENT_RATING"],
    mccRequired: false,
  },
  ME_TURBINE_LIGHT: {
    licenses: ["CPL", "MULTI_ENGINE_RATING", "INSTRUMENT_RATING"],
    mccRequired: false,
  },
  ME_TURBINE_REGIONAL: {
    licenses: ["CPL", "MULTI_ENGINE_RATING", "INSTRUMENT_RATING", "MCC"],
    mccRequired: true,
  },
  ME_TURBINE_NARROWBODY: {
    // ATPL als minimum für die career-progression-narrative. Realistisch
    // wäre frozen-ATPL für FO ausreichend — wir tracken das nicht separat
    // im MVP, ATPL deckt beide cases.
    licenses: ["ATPL", "MULTI_ENGINE_RATING", "INSTRUMENT_RATING", "MCC"],
    mccRequired: true,
  },
  ME_TURBINE_WIDEBODY: {
    licenses: ["ATPL", "MULTI_ENGINE_RATING", "INSTRUMENT_RATING", "MCC"],
    mccRequired: true,
  },
  HELI: {
    // Helis haben ihren eigenen license-pfad (PPL-H/CPL-H). Im MVP nicht
    // unterstützt — kein helo-license-type definiert. Daher leere licenses-
    // liste = effective "always blocked" wenn man ihn als requirement
    // zurückgibt. Wir markieren UNKNOWN für den booking-gate-fallback.
    licenses: ["ATPL"], // Placeholder — career-mode-airlines die helis betreiben
    // sollten typeRating-only-gates bauen.
    mccRequired: false,
  },
  UNKNOWN: {
    // Strikt-default: PPL + kein type-rating. Wenn admin einen unbekannten
    // type bewusst career-frei haben will, kann er die kategorie via
    // override-table später anpassen.
    licenses: ["PPL"],
    mccRequired: false,
  },
};

// ─────────────────────────────────────────────────────────────────────────
// inferAircraftCategory
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pattern-match auf ICAO-typ-string. Kategorisiert für default-requirements.
 *
 * Patterns sind manuell kuratiert. Reihenfolge ist wichtig — speziellere
 * checks vor allgemeineren (z.B. C208 [Caravan = SE_TURBINE] vor C2xx-
 * fallback wenn vorhanden).
 *
 * Unbekannte typen → UNKNOWN.
 */
export function inferAircraftCategory(icaoType: string): AircraftCategory {
  const t = icaoType.toUpperCase().trim();

  // ── Specific overrides (small list, high confidence) ───────────────────
  // Single-engine pistons (trainer + GA)
  if (
    t === "C150" ||
    t === "C152" ||
    t === "C162" ||
    t === "C172" ||
    t === "C177" ||
    t === "C182" ||
    t === "C206" ||
    t === "C210" ||
    t === "DA20" ||
    t === "DA40" ||
    t === "DR40" ||
    t === "P28A" ||
    t === "P28R" ||
    t === "PA24" ||
    t === "PA28" ||
    t === "PA32" ||
    t === "BE33" ||
    t === "BE35" ||
    t === "BE36" ||
    t === "M20P" ||
    t === "SR20" ||
    t === "SR22"
  ) {
    return "SE_PISTON";
  }

  // Multi-engine pistons
  if (
    t === "BE55" ||
    t === "BE58" ||
    t === "BE76" ||
    t === "BE95" ||
    t === "BE99" ||
    t === "PA23" ||
    t === "PA27" ||
    t === "PA30" ||
    t === "PA31" ||
    t === "PA34" ||
    t === "PA44" ||
    t === "C310" ||
    t === "C337" ||
    t === "C402" ||
    t === "C404" ||
    t === "C414" ||
    t === "C421" ||
    t === "DA42" ||
    t === "DA62"
  ) {
    return "ME_PISTON";
  }

  // Single-engine turbines
  if (
    t === "C208" ||
    t === "C20T" ||
    t === "C212" ||
    t === "PC12" ||
    t === "PC6T" ||
    t === "TBM7" ||
    t === "TBM8" ||
    t === "TBM9" ||
    t === "DHC2" ||
    t === "DHC3" ||
    t === "DHC6"
  ) {
    return "SE_TURBINE";
  }

  // Multi-engine turbine — light (King Airs, light bizjets, light twins)
  if (
    t === "BE9L" ||
    t === "BE10" ||
    t === "BE20" ||
    t === "BE30" ||
    t === "BE40" ||
    t === "B190" ||
    t === "B350" ||
    t === "C25A" ||
    t === "C25B" ||
    t === "C25C" ||
    t === "C500" ||
    t === "C510" ||
    t === "C525" ||
    t === "C550" ||
    t === "C560" ||
    t === "C56X" ||
    t === "C650" ||
    t === "C680" ||
    t === "C68A" ||
    t === "C700" ||
    t === "C750" ||
    t === "GLF2" ||
    t === "GLF3" ||
    t === "GLF4" ||
    t === "GLF5" ||
    t === "GLF6" ||
    t === "GL5T" ||
    t === "GL7T" ||
    t === "G280" ||
    t === "FA10" ||
    t === "FA20" ||
    t === "FA50" ||
    t === "FA7X" ||
    t === "FA8X" ||
    t === "F2TH" ||
    t === "F900" ||
    t === "LJ31" ||
    t === "LJ35" ||
    t === "LJ40" ||
    t === "LJ45" ||
    t === "LJ60" ||
    t === "LJ70" ||
    t === "LJ75" ||
    t === "PRM1" ||
    t === "E50P" ||
    t === "E55P" ||
    t === "E545" ||
    t === "E550" ||
    t === "EA50" ||
    t === "HA4T" ||
    t === "H25B" ||
    t === "H25C" ||
    t === "PC24"
  ) {
    return "ME_TURBINE_LIGHT";
  }

  // Regional turboprops + small jets (multi-crew certified)
  if (
    t === "AT42" ||
    t === "AT43" ||
    t === "AT44" ||
    t === "AT45" ||
    t === "AT46" ||
    t === "AT72" ||
    t === "AT73" ||
    t === "AT75" ||
    t === "AT76" ||
    t === "DH8A" ||
    t === "DH8B" ||
    t === "DH8C" ||
    t === "DH8D" ||
    t === "SF34" ||
    t === "SF50" ||
    t === "SB20" ||
    t === "JS31" ||
    t === "JS32" ||
    t === "JS41" ||
    t === "F50" ||
    t === "F60" ||
    t === "F70" ||
    t === "F100" ||
    t === "FK50" ||
    t === "FK70" ||
    t === "CRJ1" ||
    t === "CRJ2" ||
    t === "CRJ7" ||
    t === "CRJ9" ||
    t === "CRJX" ||
    t === "CL30" ||
    t === "CL35" ||
    t === "CL60" ||
    t === "CL64" ||
    t === "E135" ||
    t === "E140" ||
    t === "E145" ||
    t === "E170" ||
    t === "E75L" ||
    t === "E75S" ||
    t === "E190" ||
    t === "E195" ||
    t === "E290" ||
    t === "E295" ||
    t === "BCS1" ||
    t === "BCS3" ||
    t === "MD81" ||
    t === "MD82" ||
    t === "MD83" ||
    t === "MD87" ||
    t === "MD88" ||
    t === "MD90" ||
    t === "B461" ||
    t === "B462" ||
    t === "B463"
  ) {
    return "ME_TURBINE_REGIONAL";
  }

  // Narrow-body airliners
  if (
    t === "B731" ||
    t === "B732" ||
    t === "B733" ||
    t === "B734" ||
    t === "B735" ||
    t === "B736" ||
    t === "B737" ||
    t === "B738" ||
    t === "B739" ||
    t === "B37M" ||
    t === "B38M" ||
    t === "B39M" ||
    t === "B3XM" ||
    t === "B752" ||
    t === "B753" ||
    t === "A318" ||
    t === "A319" ||
    t === "A320" ||
    t === "A321" ||
    t === "A19N" ||
    t === "A20N" ||
    t === "A21N" ||
    t === "A220" ||
    t === "A223" ||
    t === "T204" ||
    t === "T214" ||
    t === "T334" ||
    t === "RJ70" ||
    t === "RJ85" ||
    t === "RJ1H"
  ) {
    return "ME_TURBINE_NARROWBODY";
  }

  // Wide-body airliners
  if (
    t === "B741" ||
    t === "B742" ||
    t === "B743" ||
    t === "B744" ||
    t === "B748" ||
    t === "B74F" ||
    t === "B74R" ||
    t === "B74S" ||
    t === "B762" ||
    t === "B763" ||
    t === "B764" ||
    t === "B772" ||
    t === "B773" ||
    t === "B77L" ||
    t === "B77W" ||
    t === "B778" ||
    t === "B779" ||
    t === "B788" ||
    t === "B789" ||
    t === "B78X" ||
    t === "A306" ||
    t === "A30B" ||
    t === "A310" ||
    t === "A30F" ||
    t === "A332" ||
    t === "A333" ||
    t === "A337" ||
    t === "A338" ||
    t === "A339" ||
    t === "A342" ||
    t === "A343" ||
    t === "A345" ||
    t === "A346" ||
    t === "A359" ||
    t === "A35K" ||
    t === "A388" ||
    t === "A380" ||
    t === "DC10" ||
    t === "MD11" ||
    t === "L101" ||
    t === "IL96"
  ) {
    return "ME_TURBINE_WIDEBODY";
  }

  // Helicopter heuristic — most ICAO heli-codes start with H, R, EC, AS,
  // BE-helis, B06/B47/B205/B212 etc. Wir matchen einen kleinen kanon.
  if (
    t === "R22" ||
    t === "R44" ||
    t === "R66" ||
    t === "EC20" ||
    t === "EC25" ||
    t === "EC30" ||
    t === "EC35" ||
    t === "EC45" ||
    t === "EC55" ||
    t === "EC75" ||
    t === "EC30T" ||
    t === "B06" ||
    t === "B06T" ||
    t === "B47G" ||
    t === "B205" ||
    t === "B206" ||
    t === "B212" ||
    t === "B214" ||
    t === "B222" ||
    t === "B412" ||
    t === "B429" ||
    t === "B505" ||
    t === "AS32" ||
    t === "AS35" ||
    t === "AS50" ||
    t === "AS55" ||
    t === "AS65" ||
    t === "AS3B" ||
    t === "AS50" ||
    t === "S76" ||
    t === "S92" ||
    t === "MI8" ||
    t === "MI17" ||
    t === "KA32" ||
    t === "H160" ||
    t === "H175" ||
    t === "H225"
  ) {
    return "HELI";
  }

  return "UNKNOWN";
}

// ─────────────────────────────────────────────────────────────────────────
// getAircraftRequirements
// ─────────────────────────────────────────────────────────────────────────

/**
 * Hauptfunktion: liefert composite-requirements für einen aircraft-typ.
 *
 * Logik:
 *   1. inferAircraftCategory(icaoType)
 *   2. lookup default-licenses + mccRequired aus DEFAULT_REQUIREMENTS
 *   3. typeRating policy:
 *        - SE_PISTON, ME_PISTON: kein type-rating-zwang
 *        - SE_TURBINE: kein type-rating-zwang im MVP (zu fragmentiert)
 *        - ME_TURBINE_LIGHT und höher: type-rating = icaoType (exact match)
 *        - HELI: type-rating = icaoType
 *        - UNKNOWN: kein type-rating-zwang (default-permissive)
 *
 * Rationale für die typeRating-policy:
 *   Realistic policy wäre "type-rating für jedes commercial aircraft".
 *   Im MVP hilft das aber nur, wenn admin/flight-school auch type-ratings
 *   ausstellt. Für SE_TURBINE und kleinere ME wäre der zwang bürokratisch
 *   ohne nutzen. Ab regional+ wird's relevant weil player-flight-schools
 *   (13E-12) typischerweise type-ratings als output haben.
 */
export function getAircraftRequirements(icaoType: string): AircraftRequirements {
  const category = inferAircraftCategory(icaoType);
  const defaults = DEFAULT_REQUIREMENTS[category];

  let typeRating: string | null = null;
  if (
    category === "ME_TURBINE_LIGHT" ||
    category === "ME_TURBINE_REGIONAL" ||
    category === "ME_TURBINE_NARROWBODY" ||
    category === "ME_TURBINE_WIDEBODY" ||
    category === "HELI"
  ) {
    typeRating = icaoType.toUpperCase().trim();
  }

  return {
    licenses: defaults.licenses,
    typeRating,
    mccRequired: defaults.mccRequired,
    category,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// formatRequirements (UI-helper)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Human-readable summary für UI ("PPL + ME + IR + Type Rating B738 + MCC").
 * Nicht für display in dropdowns gedacht — eher für tooltip / detail-card.
 */
export function formatRequirements(req: AircraftRequirements): string {
  const parts: string[] = [];
  for (const lic of req.licenses) {
    parts.push(licenseDisplayName(lic));
  }
  if (req.typeRating) {
    parts.push(`Type Rating ${req.typeRating}`);
  }
  return parts.join(" + ");
}

const LICENSE_DISPLAY: Record<LicenseType, string> = {
  SPL: "SPL (Student Pilot)",
  PPL: "PPL",
  NIGHT_RATING: "Night Rating",
  INSTRUMENT_RATING: "IR",
  MULTI_ENGINE_RATING: "ME",
  CPL: "CPL",
  MCC: "MCC",
  ATPL: "ATPL",
  TRI: "TRI",
  TRE: "TRE",
};

export function licenseDisplayName(type: LicenseType): string {
  return LICENSE_DISPLAY[type];
}
