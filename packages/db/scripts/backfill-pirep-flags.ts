/**
 * One-time backfill-script für legacy-PIREPs (option #31).
 *
 * Hintergrund: Option #20 hat das Pirep.flags Json? feld eingeführt
 * (commit d3820d9), als machine-readable mirror der [ACARS-flag: …]
 * und [Replay-flag: …] remarks-prefixes die der auto-PIREP path
 * (generate-pirep.ts) ab dann in beide surfaces schreibt.
 *
 * Pre-#20 PIREPs haben aber nur die remarks-prefixes — flags-column
 * ist NULL. Das macht admin-queries (z.B. option #1 PIREP-list flag-
 * filter, option #27 admin-queue severity-sort) inkonsistent: neuere
 * PIREPs sind sauber filterbar via flags->>'simRate', ältere müssen
 * substring-match-fallback machen.
 *
 * Dieser script repariert die historie: er liest legacy-PIREPs deren
 * flags=NULL aber remarks ein bekanntes prefix enthält, parst die
 * prefix-strings via regex zurück zu strukturierten werten, und
 * UPDATE't die flags-column.
 *
 * # Was wird rekonstruiert
 *
 *   - simRate: aus "[ACARS-flag: ... sim-rate Nx ...]" prefix.
 *     Format-string ist "sim-rate {N.N}x" (sieh generate-pirep.ts
 *     line 325). Regex matcht eine float vor dem "x".
 *
 *   - pauseSec: aus "[ACARS-flag: ... paused Nmin ...]" prefix.
 *     Format-string ist "paused {N}min" (line 328). Regex matcht
 *     eine integer vor "min". Wir multiplizieren *60 zurück zu
 *     sekunden — der originale value (totalPauseSeconds als raw-
 *     seconds) ist nicht recoverable, nur die minutes-rundung. Das
 *     ist ok, der filter cared eh nur um den minute-bereich.
 *
 *   - replayFlags: aus "[Replay-flag: A; B; C]" prefix. Items sind
 *     mit "; " separated (line 372). Regex extrahiert den content
 *     zwischen den brackets, dann split on "; ".
 *
 * # Was NICHT rekonstruiert wird
 *
 *   - hardLanding: kommt aus AcarsEvent.payload (kind=HARD_LANDING),
 *     nicht aus remarks. Für legacy-PIREPs bräuchten wir per-PIREP
 *     ein lookup über Pirep.triggeringEvent → session → INCIDENT-
 *     event-search. Der complexity-cost ist hoch und der use-case
 *     niedrig (hardLanding-flag ist im UI vorhanden via direct-
 *     event-render, der flags-mirror ist hauptsächlich für sort-
 *     ordering nützlich, was bei 2 historischen hardLandings keinen
 *     spürbaren effekt hat).
 *
 *     Wenn das je gebraucht wird, ein separater backfill-script kann
 *     das ergänzen — die existing flags-rows werden dann gemergt
 *     statt überschrieben.
 *
 * # Idempotenz
 *
 * Re-runs sind safe. Der WHERE-clause inkludiert flags=NULL, also
 * werden bereits backfilled rows skipped. Wenn ein admin den script
 * mehrfach laufen lässt (z.B. wenn neue legacy-PIREPs aus einem
 * import-flow ankommen), werden nur die noch-nicht-prozessierten
 * pireps angepackt.
 *
 * # Run-time-erwartungen
 *
 * Bei < 10k legacy-PIREPs: < 30 sekunden auf einer lokalen DB.
 * Pro PIREP: 1 read (subset of pireps), 1 update (per-row, sequenziell).
 * Wir batched updaten NICHT atomic — jeder PIREP ist eigenständig,
 * partial-completion bei einem crash ist akzeptabel (re-run räumt
 * den rest auf via idempotency).
 *
 * # Aufruf
 *
 * Aus packages/db/ heraus, mit env-file-flag damit tsx den DATABASE_URL
 * aus dem workspace-root .env lädt:
 *
 *   cd packages/db
 *   npx tsx --env-file=../../.env scripts/backfill-pirep-flags.ts
 *
 * (pnpm exec route würde wegen pnpm's exec-arg-handling den env-file
 * pfad falsch resolven — npx ist hier zuverlässiger.)
 *
 * Erwartet dass dev-server gestoppt ist (sonst race-conditions wenn
 * der heartbeat-route gerade einen neuen PIREP schreibt — aber das
 * ist kein hartes problem, nur potentiell verwirrende log-output).
 */

import { prisma } from "../src/index.js";

// ─────────────────────────────────────────────────────────────────────────
// Regex-helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Match the entire ACARS-flag prefix block. Captures the contents
 * between "[ACARS-flag: " and "]". Non-greedy to handle remarks that
 * have BOTH prefixes (ACARS + Replay) without bleeding the closing
 * bracket of the first into the second's body.
 *
 * Example matches:
 *   "[ACARS-flag: sim-rate 4.0x] Draft auto..."
 *   "[ACARS-flag: paused 15min] Hello"
 *   "[ACARS-flag: sim-rate 4.0x, paused 15min] [Replay-flag: ...] Draft"
 */
const ACARS_FLAG_RE = /\[ACARS-flag:\s+([^\]]+)\]/;

/** Same shape for Replay-flag prefix. */
const REPLAY_FLAG_RE = /\[Replay-flag:\s+([^\]]+)\]/;

/**
 * Match "sim-rate Nx" or "sim-rate N.Nx" inside the ACARS-flag body.
 * Captures the float. Non-greedy on the digits so "12.5x" works.
 */
const SIM_RATE_RE = /sim-rate\s+(\d+(?:\.\d+)?)x/;

/**
 * Match "paused Nmin" inside the ACARS-flag body. Captures the integer.
 * Reverse-conversion: stored as `totalPauseSeconds` in original session
 * row (raw seconds), spliced as `Math.round(secs/60)` minutes into the
 * remarks. We can't recover the exact seconds — multiply minutes back
 * to seconds and accept the rounding-loss.
 */
const PAUSED_MIN_RE = /paused\s+(\d+)min/;

// ─────────────────────────────────────────────────────────────────────────
// PirepFlags shape (mirrored from apps/web/lib/acars/pirep-flags.ts)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Minimal-shape mirror der PirepFlags type aus apps/web. Wir können
 * den dortigen type nicht importieren weil das ein "server-only"-
 * marked file in einem anderen package ist. Statt einer cross-package-
 * dependency duplizieren wir die shape hier — bei sehr seltenen
 * änderungen am type ist das maintenance-cheap.
 */
type ParsedFlags = {
  simRate?: number;
  pauseSec?: number;
  replayFlags?: string[];
};

/**
 * Parse a remarks-string and reconstruct the structured flags object.
 * Returns null if no flags fired (clean PIREP — caller should leave
 * flags-column at NULL).
 */
function parseRemarksToFlags(remarks: string | null): ParsedFlags | null {
  if (!remarks) return null;

  const result: ParsedFlags = {};

  // ACARS-flag block
  const acarsMatch = remarks.match(ACARS_FLAG_RE);
  if (acarsMatch) {
    const body = acarsMatch[1]!;

    const simRateMatch = body.match(SIM_RATE_RE);
    if (simRateMatch) {
      const value = parseFloat(simRateMatch[1]!);
      if (Number.isFinite(value) && value > 1.01) {
        // Round to one decimal — matches the precision in pirep-flags.ts
        // buildPirepFlags() so the structured value is identical to
        // what auto-PIREPs from #20 onwards write.
        result.simRate = Math.round(value * 10) / 10;
      }
    }

    const pauseMatch = body.match(PAUSED_MIN_RE);
    if (pauseMatch) {
      const minutes = parseInt(pauseMatch[1]!, 10);
      if (Number.isFinite(minutes) && minutes > 1) {
        // Reverse-conversion: minutes back to seconds. Original-precision
        // ist verloren (totalPauseSeconds war raw-seconds), aber 60-
        // sekunden-rundung ist akzeptabel für admin-filter ("paused >
        // 5min" arbeitet auf der gleichen rundung).
        result.pauseSec = minutes * 60;
      }
    }
  }

  // Replay-flag block
  const replayMatch = remarks.match(REPLAY_FLAG_RE);
  if (replayMatch) {
    const body = replayMatch[1]!.trim();
    // Split on "; " (with space — matches join('; ') in generate-pirep.ts).
    // Filter empty strings to be defensive against edge-cases like
    // trailing "; " or double-separators.
    const items = body
      .split("; ")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (items.length > 0) {
      result.replayFlags = items;
    }
  }

  if (Object.keys(result).length === 0) {
    return null;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Main backfill loop
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[backfill-pirep-flags] Start.");
  const startTs = Date.now();

  // Prisma's JsonNullableFilter unterscheidet `flags: null` (= JSON-null
  // value gespeichert, gibt's bei uns nie) von SQL-null (= column ist
  // unset). Wir wollen SQL-null. Der idiomatic-prisma-weg wäre `flags:
  // { equals: Prisma.DbNull }` aber das complicated den import-graph
  // unnötig hier. Workaround: fetch alle candidates mit prefix-substring,
  // filter app-seitig auf flags===null. Bei <10k rows trivial.
  const candidates = await prisma.pirep.findMany({
    where: {
      OR: [
        { remarks: { contains: "[ACARS-flag:" } },
        { remarks: { contains: "[Replay-flag:" } },
      ],
    },
    select: { id: true, remarks: true, flags: true },
  });

  const toProcess = candidates.filter((p) => p.flags === null);

  console.log(
    `[backfill-pirep-flags] Found ${candidates.length} pireps with flag-prefixes; ` +
      `${toProcess.length} have flags=NULL and need backfill, ` +
      `${candidates.length - toProcess.length} skipped (already populated).`,
  );

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const pirep of toProcess) {
    processed++;
    try {
      const flags = parseRemarksToFlags(pirep.remarks);

      if (flags === null) {
        // Remarks hatte zwar das prefix-substring aber unser parser
        // konnte nichts strukturieren (z.B. malformed-prefix oder
        // ein false-positive-substring der nicht im erwarteten format
        // ist). Skip — flags bleibt NULL.
        skipped++;
        if (skipped <= 5) {
          console.log(
            `[backfill-pirep-flags]   SKIP pirep=${pirep.id}: prefix detected aber kein parseable inhalt.`,
          );
        } else if (skipped === 6) {
          console.log(
            `[backfill-pirep-flags]   (additional skips suppressed — see counter at end)`,
          );
        }
        continue;
      }

      await prisma.pirep.update({
        where: { id: pirep.id },
        data: {
          // Cast zu Prisma's JSON-input — runtime-shape ist garantiert
          // serialisierbar (alle properties sind primitives oder
          // string[]).
          flags: flags as object,
        },
      });
      updated++;

      // Progress-log alle 50 rows. Bei 1000 PIREPs wären das 20 zeilen
      // — übersichtlich genug für die console ohne overload.
      if (updated % 50 === 0) {
        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
        console.log(
          `[backfill-pirep-flags]   ... ${updated} updated, ${skipped} skipped, ${failed} failed (${elapsed}s elapsed)`,
        );
      }
    } catch (err) {
      failed++;
      console.error(
        `[backfill-pirep-flags]   FAIL pirep=${pirep.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const totalSec = ((Date.now() - startTs) / 1000).toFixed(1);
  console.log(`[backfill-pirep-flags] Done.`);
  console.log(`[backfill-pirep-flags]   processed: ${processed}`);
  console.log(`[backfill-pirep-flags]   updated:   ${updated}`);
  console.log(`[backfill-pirep-flags]   skipped:   ${skipped}`);
  console.log(`[backfill-pirep-flags]   failed:    ${failed}`);
  console.log(`[backfill-pirep-flags]   elapsed:   ${totalSec}s`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfill-pirep-flags] Fatal error:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
