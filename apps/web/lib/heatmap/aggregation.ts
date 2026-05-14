import { prisma } from '@vam/db';

/**
 * Welle E / E5 — Position-track heatmap aggregator.
 *
 * Aggregates LiveSessionPosition rows into geographic grid cells +
 * returns one weighted point per cell. The result feeds the Mapbox
 * heatmap layer on /live as a complement to the existing PIREP-DEP/ARR
 * heatmap — where the PIREP heatmap shows "popular endpoints", the
 * positions heatmap shows "actual flight density" (en-route corridors,
 * SID/STAR fan-outs, holding patterns, etc.).
 *
 * # Why bucketed aggregation (not raw points)
 *
 * 1 month of flights ≈ 5M position rows for an active airline. Shipping
 * raw points to the browser would crater both bandwidth and the
 * client-side Mapbox layer (heatmap re-rasterizes per zoom, raw point
 * count drives memory). Server-side bucketing collapses to ≤ ~10000
 * cells globally (180×360 grid at 1° cellSize = 64800 cells, in
 * practice most are empty), which compresses to <100 KB on the wire.
 *
 * # Grid cell sizing
 *
 * 1° cells (~111 km on the equator, ~70 km at 45°N). Coarse enough
 * for the global "where do we fly" view, fine enough to distinguish
 * SID fan-outs from en-route corridors. We considered 0.5° (better
 * resolution) but the row-count for the en-route corridors above
 * Europe inflates the cell count by 4× without changing what a user
 * actually sees in the rendered heatmap (Mapbox's gaussian blur
 * dominates at 0.5° anyway).
 *
 * Cells are anchored at (floor(lat), floor(lng)). The reported center
 * is the cell's geometric center — (floor + 0.5). This matches what
 * Mapbox expects for point-style heatmap data; the layer's
 * heatmap-radius and -intensity expressions handle the smoothing.
 *
 * # Why raw SQL
 *
 * Prisma's groupBy doesn't support computed-column grouping (we need
 * `floor(latitude / cellSize) * cellSize` as a grouping key, not a
 * pre-existing column). $queryRaw with a numeric template is the
 * cleanest path — runs server-side aggregation in Postgres, returns
 * just the bucketed result. Postgres handles 5M rows of GROUP BY in
 * ~1-2 seconds on commodity hardware; we'd never want to ship that
 * volume through the Node.js layer.
 *
 * # In-memory caching
 *
 * Heatmap shape changes only when new positions are recorded — but
 * the aggregation is expensive enough that re-running it on every
 * client poll would waste compute. We cache per (airlineId, timeframe)
 * for HEATMAP_CACHE_TTL_MS (1h). This is a process-local cache, not
 * cross-process — fine for our scale (single Next.js node). When we
 * scale out, replace with Redis or move the agg to a periodic cron.
 *
 * # Airline scoping
 *
 * The query joins through LiveSession → User → User.airlineId and
 * filters on the calling user's airline. Cross-airline snooping is
 * disabled by design — the heatmap reveals operational patterns
 * (preferred routes, peak hours) that competing virtual airlines
 * shouldn't see. Same scoping convention as /api/live/sessions and
 * /api/live/heatmap (PIREP).
 */

/**
 * Cell size in degrees. See module docstring for the 1° vs 0.5°
 * rationale. Constant rather than env-var because changing this
 * invalidates the cache + reshapes the wire format, which is the
 * kind of change that wants a code review, not a deploy-time knob.
 */
const CELL_SIZE_DEG = 1;

/** Cache TTL — 1 hour. */
const HEATMAP_CACHE_TTL_MS = 60 * 60 * 1000;

/** Allowed timeframe values. "all" means no time-cutoff. */
export type PositionsHeatmapTimeframe = '24h' | '7d' | '30d' | 'all';

const TIMEFRAME_HOURS: Record<Exclude<PositionsHeatmapTimeframe, 'all'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

/** A single weighted grid-cell center for the heatmap layer. */
export type HeatmapCell = {
  lat: number;
  lng: number;
  /** Number of position rows that fell into this cell. */
  weight: number;
};

type CacheEntry = {
  expiresAt: number;
  cells: HeatmapCell[];
};

// Process-local cache, keyed by `${airlineId}:${timeframe}`. Cleared
// implicitly on process restart (which is fine — the next request
// regenerates within ~1-2 seconds). No LRU bound because per-airline-
// per-timeframe combinations are O(airlines × 4) ≤ ~200 entries
// total across the platform.
const cache = new Map<string, CacheEntry>();

function cacheKey(airlineId: string, timeframe: PositionsHeatmapTimeframe): string {
  return `${airlineId}:${timeframe}`;
}

/**
 * Public aggregator. Returns the heatmap cells for the given airline
 * and timeframe, hitting the in-memory cache when possible.
 *
 * The query joins LiveSessionPosition (p) → LiveSession (s) → User (u)
 * and filters on u.airlineId. We do NOT filter on session.isActive —
 * positions from completed flights (most of the data) are exactly
 * what we want for a "where did we fly" view.
 *
 * For timeframe='all' the recordedAt filter is omitted entirely;
 * Postgres scans only the (sessionId, recordedAt) index for the join,
 * which is still O(N) but doesn't add a redundant cutoff predicate.
 */
export async function getPositionsHeatmap(
  airlineId: string,
  timeframe: PositionsHeatmapTimeframe,
): Promise<HeatmapCell[]> {
  const key = cacheKey(airlineId, timeframe);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.cells;
  }

  // Compute the optional time-cutoff. JS Date math is fine here —
  // we pass the ISO string into the SQL template, Postgres reads it
  // as a timestamptz literal.
  let sinceRecordedAt: Date | null = null;
  if (timeframe !== 'all') {
    const hours = TIMEFRAME_HOURS[timeframe];
    sinceRecordedAt = new Date(now - hours * 60 * 60 * 1000);
  }

  // Aggregation query. Bucketing math: floor(coord / cellSize) *
  // cellSize gives the cell anchor (south-west corner for lat, lng);
  // + cellSize/2 shifts to the cell center. Cell center is what the
  // Mapbox heatmap layer wants as a point.
  //
  // We use $queryRawUnsafe-style template construction via the
  // Prisma.sql tagged template (re-exported as Prisma from @vam/db).
  // Actually — Prisma's $queryRaw with template literals binds
  // parameters safely. Build two variants: one with the recordedAt
  // filter, one without. Avoids a NULL-vs-value shape mismatch in
  // the prepared statement.
  type Row = { cell_lat: number; cell_lng: number; cnt: bigint };

  const rows: Row[] = sinceRecordedAt
    ? await prisma.$queryRaw<Row[]>`
        SELECT
          floor(p.latitude  / ${CELL_SIZE_DEG}) * ${CELL_SIZE_DEG} + ${CELL_SIZE_DEG} / 2.0 AS cell_lat,
          floor(p.longitude / ${CELL_SIZE_DEG}) * ${CELL_SIZE_DEG} + ${CELL_SIZE_DEG} / 2.0 AS cell_lng,
          COUNT(*)::bigint AS cnt
        FROM "LiveSessionPosition" p
        JOIN "LiveSession" s ON s.id = p."sessionId"
        JOIN "User" u ON u.id = s."userId"
        WHERE u."airlineId" = ${airlineId}
          AND p."recordedAt" >= ${sinceRecordedAt}
        GROUP BY cell_lat, cell_lng
      `
    : await prisma.$queryRaw<Row[]>`
        SELECT
          floor(p.latitude  / ${CELL_SIZE_DEG}) * ${CELL_SIZE_DEG} + ${CELL_SIZE_DEG} / 2.0 AS cell_lat,
          floor(p.longitude / ${CELL_SIZE_DEG}) * ${CELL_SIZE_DEG} + ${CELL_SIZE_DEG} / 2.0 AS cell_lng,
          COUNT(*)::bigint AS cnt
        FROM "LiveSessionPosition" p
        JOIN "LiveSession" s ON s.id = p."sessionId"
        JOIN "User" u ON u.id = s."userId"
        WHERE u."airlineId" = ${airlineId}
        GROUP BY cell_lat, cell_lng
      `;

  // COUNT(*) returns bigint from Postgres → BigInt in JS via Prisma.
  // Mapbox can't serialize BigInt over JSON, and our consumers do
  // arithmetic on `weight` (relative-scale rendering), so we convert
  // to Number here. Counts ≤ 2^53 are safe — the table caps at a few
  // million rows globally, well below that.
  const cells: HeatmapCell[] = rows.map((r) => ({
    lat: r.cell_lat,
    lng: r.cell_lng,
    weight: Number(r.cnt),
  }));

  cache.set(key, {
    expiresAt: now + HEATMAP_CACHE_TTL_MS,
    cells,
  });

  return cells;
}

/**
 * Test/admin helper to manually clear the cache. Not exposed via API
 * for v1 — the natural cache cycle (1h TTL + process-restart) is
 * fine. Useful in test suites that want deterministic state.
 */
export function clearPositionsHeatmapCache(): void {
  cache.clear();
}
