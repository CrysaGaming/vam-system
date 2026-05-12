/**
 * Track 5 #7 — Award Criteria DSL + Evaluator.
 *
 * Macht das `Award.criteria` JSON-feld (existiert seit prisma initial-
 * schema, war bisher ungenutzt) zu einem strukturierten DSL für
 * auto-grantable achievements.
 *
 * # Wieso ein DSL und nicht hardcoded rules
 *
 * - Admin kann awards im UI definieren ohne deploy: "100 flights",
 *   "100 hours", "fly an A380", etc.
 * - Criteria sind kombinierbar (AND/OR werden später möglich; V1 ist
 *   single-criterion)
 * - Evaluator kann progress-werte returnen — UI zeigt "73/100 Flüge"
 *   statt nur "nicht erreicht"
 *
 * # DSL-shape (V1)
 *
 * Single-criterion-per-award. Jedes criterion hat ein `kind`-tag (discrim-
 * inated union) plus kind-spezifische felder. Bei admin-create wird das
 * JSON über `parseCriteria()` validiert; runtime-evaluation passiert in
 * `evaluateCriteria()`.
 *
 * Beispiele:
 *   { kind: "totalFlights", threshold: 100 }
 *   { kind: "totalHours", threshold: 1000 }
 *   { kind: "singleFlightDistanceNm", threshold: 4000 }
 *   { kind: "smoothLandingFpm", threshold: 100 }  // |fpm| ≤ 100
 *   { kind: "aircraftTypeFlights", aircraftType: "A320", threshold: 50 }
 *   { kind: "differentAirports", threshold: 25 }
 *   { kind: "differentAircraftTypes", threshold: 5 }
 *
 * # AND/OR composition — out of V1 scope
 *
 * V2 könnte { kind: "and", criteria: [...] } / { kind: "or", criteria: [...] }
 * als compound-criteria hinzufügen. Für V1 reicht single-criterion —
 * jedes echte achievement das wir launchen brauchen würde, ist mit
 * einem einzigen kind ausdrückbar.
 *
 * # Evaluation
 *
 * `evaluateCriteria(userId, criteria)` returnt `EvaluationResult`:
 *   {
 *     met: boolean;             // true wenn criteria erfüllt
 *     progress: number;         // current value (e.g. 73 flights)
 *     target: number;           // threshold (e.g. 100 flights)
 *     description: string;      // human-readable z.B. "73/100 Flüge"
 *   }
 *
 * Jede kind-implementierung macht ihre eigene DB-query — manche sind
 * cached/aggregiert (totalFlights = pirep.count), andere fetchen
 * spezifische data (aircraftTypeFlights joint Aircraft.type).
 *
 * Bei N awards, N evaluations = N queries. Für /awards/personal-page
 * (~10-30 awards) akzeptabel. Bei größeren award-katalogen würde man
 * eine batched-evaluation bauen die alle career-stats einmal lädt
 * und dann die criteria gegen das in-memory-object checkt.
 */

import { prisma } from "../index.js";

// ─────────────────────────────────────────────────────────────────────
// DSL types
// ─────────────────────────────────────────────────────────────────────

export type AwardCriteriaV1 =
  | { kind: "totalFlights"; threshold: number }
  | { kind: "totalHours"; threshold: number }
  | { kind: "totalDistanceNm"; threshold: number }
  | { kind: "singleFlightDistanceNm"; threshold: number }
  /** smoothLandingFpm: smoothness, |fpm| ≤ threshold mind. einmal erreicht */
  | { kind: "smoothLandingFpm"; threshold: number }
  | { kind: "aircraftTypeFlights"; aircraftType: string; threshold: number }
  /** differentAirports: unique departures + arrivals zusammengezählt */
  | { kind: "differentAirports"; threshold: number }
  | { kind: "differentAircraftTypes"; threshold: number };

export type EvaluationResult = {
  met: boolean;
  progress: number;
  target: number;
  /** human-readable, deutsch (UI zeigt das direkt an) */
  description: string;
};

// ─────────────────────────────────────────────────────────────────────
// Parsing — JSON aus DB validieren
// ─────────────────────────────────────────────────────────────────────

/**
 * Parsed das raw-JSON-feld aus Award.criteria zu einem typed criteria-
 * object. Returnt null wenn:
 *   - input ist null/undefined (kein criteria gesetzt → award is manual-grant only)
 *   - input hat unbekannten kind
 *   - input fehlt required fields
 *
 * Null-return ist nicht ein error — der caller (evaluator) skipt awards
 * ohne valide criteria.
 */
export function parseCriteria(raw: unknown): AwardCriteriaV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;

  switch (kind) {
    case "totalFlights":
    case "totalHours":
    case "totalDistanceNm":
    case "singleFlightDistanceNm":
    case "smoothLandingFpm":
    case "differentAirports":
    case "differentAircraftTypes": {
      const t = obj.threshold;
      if (typeof t !== "number" || t <= 0) return null;
      return { kind, threshold: t };
    }
    case "aircraftTypeFlights": {
      const at = obj.aircraftType;
      const t = obj.threshold;
      if (typeof at !== "string" || at.length === 0) return null;
      if (typeof t !== "number" || t <= 0) return null;
      return { kind, aircraftType: at, threshold: t };
    }
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Evaluator — pro kind eine query
// ─────────────────────────────────────────────────────────────────────

const APPROVED_FILTER = { status: "Approved" as const };

export async function evaluateCriteria(
  userId: string,
  criteria: AwardCriteriaV1,
): Promise<EvaluationResult> {
  switch (criteria.kind) {
    case "totalFlights": {
      const count = await prisma.pirep.count({
        where: { userId, ...APPROVED_FILTER },
      });
      return mkResult(count, criteria.threshold, "Flüge");
    }

    case "totalHours": {
      const agg = await prisma.pirep.aggregate({
        where: { userId, ...APPROVED_FILTER },
        _sum: { flightTimeMin: true },
      });
      const totalHours = Math.round((agg._sum.flightTimeMin ?? 0) / 60);
      return mkResult(totalHours, criteria.threshold, "Stunden");
    }

    case "totalDistanceNm": {
      // Join über route — kein server-side _sum auf joined field, daher
      // findMany + in-memory-summe.
      const rows = await prisma.pirep.findMany({
        where: { userId, ...APPROVED_FILTER, routeId: { not: null } },
        select: { route: { select: { distanceNm: true } } },
      });
      const sum = rows.reduce((s, r) => s + (r.route?.distanceNm ?? 0), 0);
      return mkResult(sum, criteria.threshold, "nm");
    }

    case "singleFlightDistanceNm": {
      // Längster einzel-flug via max(route.distanceNm)
      const rows = await prisma.pirep.findMany({
        where: { userId, ...APPROVED_FILTER, routeId: { not: null } },
        select: { route: { select: { distanceNm: true } } },
      });
      const max = rows.reduce(
        (m, r) => Math.max(m, r.route?.distanceNm ?? 0),
        0,
      );
      return mkResult(max, criteria.threshold, "nm (Einzelflug)");
    }

    case "smoothLandingFpm": {
      // Mind. einmal |fpm| ≤ threshold erreicht. Progress = abs(best).
      // Inverted: progress=0 bedeutet "kein landing erfasst", progress
      // sinkt richtung threshold (= besser). Für UI: wir zeigen den
      // best-wert als progress + threshold als target — aber "met"
      // wird inverted geprüft (progress ≤ target).
      const rows = await prisma.pirep.findMany({
        where: {
          userId,
          ...APPROVED_FILTER,
          landingRateFpm: { not: null },
        },
        select: { landingRateFpm: true },
      });
      if (rows.length === 0) {
        return {
          met: false,
          progress: 0,
          target: criteria.threshold,
          description: `Keine Landings erfasst (Ziel ≤ ${criteria.threshold} fpm)`,
        };
      }
      const bestAbs = Math.min(
        ...rows.map((r) => Math.abs(r.landingRateFpm!)),
      );
      const met = bestAbs <= criteria.threshold;
      return {
        met,
        progress: bestAbs,
        target: criteria.threshold,
        description: met
          ? `Erreicht: ${bestAbs} fpm (Ziel ≤ ${criteria.threshold})`
          : `Beste Landung: ${bestAbs} fpm · Ziel ≤ ${criteria.threshold} fpm`,
      };
    }

    case "aircraftTypeFlights": {
      // Count via join — aircraftId → Aircraft.type matching.
      const count = await prisma.pirep.count({
        where: {
          userId,
          ...APPROVED_FILTER,
          aircraft: { type: criteria.aircraftType },
        },
      });
      return mkResult(
        count,
        criteria.threshold,
        `× ${criteria.aircraftType}`,
      );
    }

    case "differentAirports": {
      // Unique departures + arrivals zusammen. groupBy mit two columns
      // gibt uns die unique pairs nicht — wir brauchen UNION über
      // departureId + arrivalId. Einfacher: zwei groupBys + Set-merge.
      const [deps, arrs] = await Promise.all([
        prisma.pirep.groupBy({
          by: ["departureId"],
          where: { userId, ...APPROVED_FILTER },
        }),
        prisma.pirep.groupBy({
          by: ["arrivalId"],
          where: { userId, ...APPROVED_FILTER },
        }),
      ]);
      const set = new Set<string>();
      for (const d of deps) set.add(d.departureId);
      for (const a of arrs) set.add(a.arrivalId);
      return mkResult(set.size, criteria.threshold, "Airports besucht");
    }

    case "differentAircraftTypes": {
      // Unique aircraft.type werte über die PIREPs.
      const rows = await prisma.pirep.findMany({
        where: { userId, ...APPROVED_FILTER, aircraftId: { not: null } },
        select: { aircraft: { select: { type: true } } },
        distinct: ["aircraftId"],
      });
      // distinct: ["aircraftId"] gibt uns unique airframes — wir wollen
      // aber unique types (zwei verschiedene D-REGs vom gleichen typ
      // sollen nicht doppelt zählen).
      const types = new Set<string>();
      for (const r of rows) {
        if (r.aircraft?.type) types.add(r.aircraft.type);
      }
      return mkResult(types.size, criteria.threshold, "Aircraft-Types");
    }
  }
}

function mkResult(
  progress: number,
  target: number,
  unit: string,
): EvaluationResult {
  return {
    met: progress >= target,
    progress,
    target,
    description: `${progress.toLocaleString("de-DE")}/${target.toLocaleString("de-DE")} ${unit}`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Auto-grant runner
// ─────────────────────────────────────────────────────────────────────

export type AutoGrantedAward = {
  awardId: string;
  awardName: string;
};

/**
 * Evaluiert ALLE awards mit criteria gegen einen user und vergibt die
 * erfüllten + noch nicht verdienten. Idempotent: wenn alle bereits
 * gegranted sind, passiert nichts.
 *
 * Wird typischerweise aufgerufen:
 *   - nach PIREP-approval (PIREP-approval-action triggert das)
 *   - manuell von admin via "Auto-Check"-button
 *   - vielleicht später als nightly cron für back-fill
 *
 * Returnt die liste der NEU vergebenen awards (für UI-toast "Du hast
 * 2 awards verdient!").
 *
 * Performance: pro award eine query (siehe evaluator). Bei 30 awards
 * = 30 queries. Akzeptabel weil das nicht hot-path ist (passiert nur
 * bei approval-events).
 */
export async function runAutoGrantForUser(
  userId: string,
): Promise<AutoGrantedAward[]> {
  // 1. Alle awards mit criteria laden
  // 2. Alle bereits gegrantete award-ids für diesen user fetchen
  // 3. Pro un-gegrantetem award mit criteria: evaluate, grant wenn met
  const [allAwards, ownedRows] = await Promise.all([
    prisma.award.findMany({
      where: { criteria: { not: { equals: null } } },
      select: { id: true, name: true, criteria: true },
    }),
    prisma.userAward.findMany({
      where: { userId },
      select: { awardId: true },
    }),
  ]);

  const owned = new Set(ownedRows.map((r) => r.awardId));
  const granted: AutoGrantedAward[] = [];

  for (const award of allAwards) {
    if (owned.has(award.id)) continue;
    const criteria = parseCriteria(award.criteria);
    if (!criteria) continue;
    const result = await evaluateCriteria(userId, criteria);
    if (!result.met) continue;
    // Grant. createMany mit skipDuplicates wäre eleganter, aber wir
    // wollen pro grant einen UserAward-row mit fresh awardedAt — daher
    // create() pro award. Bei race-condition (zwei parallel grants
    // für dasselbe award) fängt der @@unique([userId,awardId])-constraint
    // den zweiten ab; wir catchen das und treat es als "already owned".
    try {
      await prisma.userAward.create({
        data: { userId, awardId: award.id },
      });
      granted.push({ awardId: award.id, awardName: award.name });
    } catch (err) {
      // P2002 = unique constraint violation. Andere errors propagieren.
      const isUniqueErr =
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002";
      if (!isUniqueErr) throw err;
    }
  }

  return granted;
}

// ─────────────────────────────────────────────────────────────────────
// Bulk-evaluator für catalog-page
// ─────────────────────────────────────────────────────────────────────

export type AwardWithProgress = {
  awardId: string;
  evaluation: EvaluationResult | null; // null = no criteria (manual-grant)
};

/**
 * Evaluiert alle awards gegen einen user und returnt pro award die
 * progress-evaluation. Für die "Mein Awards"-page wo wir bei jedem
 * not-yet-earned award den progress-bar zeigen wollen.
 *
 * Same query-volume wie runAutoGrantForUser, aber pure read.
 */
export async function evaluateAllAwardsForUser(
  userId: string,
): Promise<Map<string, EvaluationResult>> {
  const awards = await prisma.award.findMany({
    where: { criteria: { not: { equals: null } } },
    select: { id: true, criteria: true },
  });
  const out = new Map<string, EvaluationResult>();
  for (const a of awards) {
    const criteria = parseCriteria(a.criteria);
    if (!criteria) continue;
    out.set(a.id, await evaluateCriteria(userId, criteria));
  }
  return out;
}
