/**
 * Track 4 #16 (Section C polish) — Heuristic tier-family detection.
 *
 * VA-admins typischerweise benennen tier-progressions nach einem
 * konsistenten naming-scheme:
 *   - "Vielflieger Bronze" / "Vielflieger Silber" / "Vielflieger Gold"
 *   - "Senior Captain I" / "Senior Captain II" / "Senior Captain III"
 *   - "Hours Diamond" / "Hours Platinum" / etc.
 *
 * Da der Award-model im DB-schema kein dediziertes `tier` oder `family`-
 * field hat (criteria ist freeform Json?), erkennen wir families via
 * suffix-heuristik aus dem name. Nur wenn 2+ awards den selben stripped-
 * prefix teilen wird's als family behandelt — single-awards bleiben
 * stand-alone.
 *
 * # Bekannte tier-suffixe (ranked low → high)
 *
 *   Material-tier:  Bronze < Silber/Silver < Gold < Platin/Platinum < Diamant/Diamond
 *   Roman-numeral:  I < II < III < IV < V
 *   Stufe:          Stufe 1 < Stufe 2 < ...  (wir parsen ziffer)
 *
 * Suffix-matching ist case-insensitive und matched nur am ende des names
 * (mit optional vorhandenem trennzeichen `-` oder ` `). Awards ohne
 * erkanntes suffix kriegen tierIndex=0 + tierLabel=name selbst und
 * werden NICHT in eine family gruppiert.
 *
 * # Keine schema-änderung
 *
 * Bewusst keine migration für ein tier/family-feld — der Award-model ist
 * stabil seit M0, und ein heuristischer reader-pfad ist eine reversible
 * schicht. Sollte sich später ein expliziter `family` + `tierIndex`
 * column lohnen, wird der heuristik-pfad zum fallback. Bis dahin reicht
 * die naming-convention.
 */

/**
 * Tier-suffix-table. Ordering matters: longer suffixes (e.g. "Platinum")
 * MÜSSEN vor kürzeren (z.B. "Plat") kommen, sonst matched die kürzere
 * variante zuerst und schluckt beide. Ranking-zahlen sind beliebig
 * gewählt, aber stabil sortierbar — Bronze=10, Silver=20, Gold=30,
 * Platin=40, Diamant=50. Roman-numerals laufen 1..5.
 */
const TIER_SUFFIXES: Array<{ pattern: RegExp; label: string; rank: number }> = [
  // Material tiers (longer-first to avoid Plat → Platinum prefix-collision)
  { pattern: /\s+Diamant$/i,  label: 'Diamant',   rank: 50 },
  { pattern: /\s+Diamond$/i,  label: 'Diamond',   rank: 50 },
  { pattern: /\s+Platinum$/i, label: 'Platinum',  rank: 40 },
  { pattern: /\s+Platin$/i,   label: 'Platin',    rank: 40 },
  { pattern: /\s+Gold$/i,     label: 'Gold',      rank: 30 },
  { pattern: /\s+Silver$/i,   label: 'Silver',    rank: 20 },
  { pattern: /\s+Silber$/i,   label: 'Silber',    rank: 20 },
  { pattern: /\s+Bronze$/i,   label: 'Bronze',    rank: 10 },
  // Roman numerals — match exactly at end after whitespace, NOT inside
  // words (so "Captain Iverson" stays untouched). Rank = literal value.
  { pattern: /\s+V$/,         label: 'V',         rank: 5 },
  { pattern: /\s+IV$/,        label: 'IV',        rank: 4 },
  { pattern: /\s+III$/,       label: 'III',       rank: 3 },
  { pattern: /\s+II$/,        label: 'II',        rank: 2 },
  { pattern: /\s+I$/,         label: 'I',         rank: 1 },
];

/**
 * Result-shape von `detectTier`. `null` bedeutet "name hatte kein
 * erkennbares tier-suffix".
 */
export interface TierMatch {
  /** Stripped prefix — z.B. "Vielflieger" für "Vielflieger Bronze". */
  family: string;
  /** Display-label des tiers — z.B. "Bronze". */
  tierLabel: string;
  /** Numerischer rank für ordering. Höher = höherer tier. */
  rank: number;
}

/**
 * Versucht ein tier-suffix vom name zu strippen. Returns null wenn
 * keiner der bekannten suffixe matched.
 */
export function detectTier(name: string): TierMatch | null {
  for (const entry of TIER_SUFFIXES) {
    const m = name.match(entry.pattern);
    if (m) {
      const family = name.slice(0, m.index!).trim();
      // Defensive: strip auch trailing dashes/colons die manche admins
      // verwenden ("Vielflieger - Bronze" → family="Vielflieger -",
      // wir wollen "Vielflieger"). Trim non-word trailing chars.
      const cleanFamily = family.replace(/[\s\-–—:·]+$/u, '');
      if (cleanFamily.length === 0) return null;
      return {
        family: cleanFamily,
        tierLabel: entry.label,
        rank: entry.rank,
      };
    }
  }
  return null;
}

export interface FamilyAnnotation {
  /** Stripped family-name (z.B. "Vielflieger"). */
  family: string;
  /** Display-label dieses tiers (z.B. "Bronze"). */
  tierLabel: string;
  /** 1-based position in der family, sorted low → high. */
  index: number;
  /** Total tier-count in der family. */
  total: number;
  /** Wieviele tiers in dieser family hat der user schon? */
  earnedInFamily: number;
}

/**
 * Annotiert eine award-liste mit family-info. Awards die zu keiner
 * family gehören (single-tier oder unerkanntes naming) kriegen `null`.
 *
 * @param awards Liste von award-objekten mit mind. id + name
 * @param earnedIds Set von award-ids die der user schon hat (für
 *   earnedInFamily-counter)
 * @returns Map<awardId, FamilyAnnotation | null>
 */
export function annotateFamilies<T extends { id: string; name: string }>(
  awards: T[],
  earnedIds: Set<string>,
): Map<string, FamilyAnnotation | null> {
  const result = new Map<string, FamilyAnnotation | null>();

  // Pass 1: erkenne tiers, gruppiere nach family-key.
  type FamilyEntry = { award: T; tier: TierMatch };
  const byFamily = new Map<string, FamilyEntry[]>();

  for (const award of awards) {
    const tier = detectTier(award.name);
    if (!tier) {
      result.set(award.id, null);
      continue;
    }
    const list = byFamily.get(tier.family) ?? [];
    list.push({ award, tier });
    byFamily.set(tier.family, list);
  }

  // Pass 2: für jede family mit 2+ members → annotation; singles
  // werden zu null degradiert (eine "family" mit einem einzigen tier
  // ist visuell keine progression, also nicht wert sie als family zu
  // rendern).
  for (const [family, entries] of byFamily) {
    if (entries.length < 2) {
      // Single-tier family — degradieren zu null (kein family-display)
      for (const entry of entries) {
        result.set(entry.award.id, null);
      }
      continue;
    }

    // Sort low → high tier
    entries.sort((a, b) => a.tier.rank - b.tier.rank);
    const earnedInFamily = entries.filter((e) => earnedIds.has(e.award.id)).length;

    entries.forEach((entry, idx) => {
      result.set(entry.award.id, {
        family,
        tierLabel: entry.tier.tierLabel,
        index: idx + 1,
        total: entries.length,
        earnedInFamily,
      });
    });
  }

  return result;
}
