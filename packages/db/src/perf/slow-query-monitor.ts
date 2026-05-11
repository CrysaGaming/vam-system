/**
 * Track 4 #102 (Section T) — Slow-Query-Monitor.
 *
 * Prisma `$extends` client-extension die jeden query intercepted,
 * duration misst, und queries die einen threshold übersteigen in
 * einen module-level in-memory ring-buffer schreibt.
 *
 * # Scope
 *
 * Reine in-memory observability — keine DB-writes, keine externe
 * service-integration. Resettet bei dev-server-restart (analog zu
 * /admin/status process-uptime).
 *
 * # Threshold
 *
 * 200ms hardcoded. "User-perceptible" cutoff — postgres-roundtrip auf
 * localhost ist typischerweise 1-5ms, also alles >200ms ist entweder
 * ein full-scan, ein N+1-pattern, oder ein composite-query der noch
 * keinen index hat. Threshold via env-var (VAM_SLOW_QUERY_MS) overridable.
 *
 * # Ring-buffer
 *
 * Capacity 100. FIFO — älteste entry wird verworfen wenn voll. Keine
 * persistence: ein dev-server-restart oder prod-deploy resettet alles.
 * Bei N=100 entries und durchschnittlich ~500 bytes pro entry sind das
 * ~50 KB RAM — vernachlässigbar.
 *
 * # API surface
 *
 *   - extendWithSlowQueryMonitor(client) — applies $extends-wrapper
 *   - getSlowQueries() — read-only snapshot, neuste first
 *   - getSlowQueryStats() — count + P50/P95/P99 + oldest/newest
 *   - clearSlowQueryBuffer() — reset (für admin "clear"-button)
 *   - getSlowQueryThresholdMs() — current threshold (für UI-display)
 *
 * # Caveats
 *
 *   - Single-process scope. Bei multi-instance prod-setup hat jede
 *     instance ihren eigenen buffer. Aggregation wäre für V2 mit
 *     persistence + admin-view-across-instances.
 *   - Args werden truncated auf ~500 chars. Lange JSON-payloads (z.b.
 *     bulk-create) sind nicht voll dargestellt — der entry zeigt
 *     dann "...truncated".
 *   - $extends-overhead pro query: ~1-2 microseconds (perf.now + math).
 *     Vernachlässigbar gegenüber DB-roundtrip.
 */

import type { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD_MS = 200;
const BUFFER_CAPACITY = 100;
const MAX_ARGS_PREVIEW_CHARS = 500;

function getThresholdMs(): number {
  const env = process.env.VAM_SLOW_QUERY_MS;
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_THRESHOLD_MS;
}

// ─────────────────────────────────────────────────────────────────────────
// Buffer types
// ─────────────────────────────────────────────────────────────────────────

export interface SlowQueryEntry {
  /** "User", "Pirep", etc. Or null for raw queries ($queryRaw, $executeRaw). */
  model: string | null;
  /** "findMany", "create", "$queryRaw", etc. */
  operation: string;
  /** Measured duration in milliseconds, rounded. */
  durationMs: number;
  /** JSON-stringified args, truncated to ~500 chars. */
  argsPreview: string;
  /** When the query finished. */
  timestamp: Date;
}

// Module-level ring buffer. globalThis-cached für dev-mode hot-reload
// resistance (sonst würde jeder edit den buffer leeren).
const globalForBuffer = globalThis as unknown as {
  __vam_slow_query_buffer?: SlowQueryEntry[];
};

function getBuffer(): SlowQueryEntry[] {
  if (!globalForBuffer.__vam_slow_query_buffer) {
    globalForBuffer.__vam_slow_query_buffer = [];
  }
  return globalForBuffer.__vam_slow_query_buffer;
}

// ─────────────────────────────────────────────────────────────────────────
// Prisma extension
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wraps a PrismaClient with a `$allOperations` query-extension that
 * times every operation and records slow ones to the ring buffer.
 *
 * Returns a new (extended) client. The original client remains the
 * same shape but should not be used directly — always use the returned
 * extended client.
 */
export function extendWithSlowQueryMonitor(client: PrismaClient) {
  return client.$extends({
    name: 'vam-slow-query-monitor',
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        const startedAt = performance.now();
        try {
          const result = await query(args);
          const durationMs = performance.now() - startedAt;
          maybeRecord(model ?? null, operation, durationMs, args);
          return result;
        } catch (err) {
          // Auch fehlgeschlagene queries die slow waren sind interessant
          // (z.b. timeouts). Wir loggen sie mit dem failed-marker.
          const durationMs = performance.now() - startedAt;
          maybeRecord(model ?? null, `${operation} (failed)`, durationMs, args);
          throw err;
        }
      },
    },
  });
}

function maybeRecord(
  model: string | null,
  operation: string,
  durationMs: number,
  args: unknown,
): void {
  const threshold = getThresholdMs();
  if (durationMs < threshold) return;

  const buffer = getBuffer();
  const argsStr = safeStringify(args);
  const argsPreview =
    argsStr.length > MAX_ARGS_PREVIEW_CHARS
      ? argsStr.slice(0, MAX_ARGS_PREVIEW_CHARS) + '…(truncated)'
      : argsStr;

  buffer.push({
    model,
    operation,
    durationMs: Math.round(durationMs),
    argsPreview,
    timestamp: new Date(),
  });

  // FIFO trim. Splice statt shift() vermeidet repeated O(n)-allocations.
  if (buffer.length > BUFFER_CAPACITY) {
    buffer.splice(0, buffer.length - BUFFER_CAPACITY);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (val instanceof Date) return val.toISOString();
      return val;
    });
  } catch {
    return '<unserializable>';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns a copy of the current slow-query buffer, newest first.
 * Safe to call from server-components — purely reads in-memory state.
 */
export function getSlowQueries(): SlowQueryEntry[] {
  return [...getBuffer()].reverse();
}

export interface SlowQueryStats {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  oldestAt: Date | null;
  newestAt: Date | null;
  thresholdMs: number;
  capacity: number;
}

export function getSlowQueryStats(): SlowQueryStats {
  const buffer = getBuffer();
  const thresholdMs = getThresholdMs();

  if (buffer.length === 0) {
    return {
      count: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
      oldestAt: null,
      newestAt: null,
      thresholdMs,
      capacity: BUFFER_CAPACITY,
    };
  }

  // Sortiertes duration-array für percentile-berechnung. Bei N≤100 ist
  // das billig — kein streaming-quantile nötig.
  const sortedDurations = buffer
    .map((e) => e.durationMs)
    .sort((a, b) => a - b);

  return {
    count: buffer.length,
    p50Ms: percentile(sortedDurations, 0.5),
    p95Ms: percentile(sortedDurations, 0.95),
    p99Ms: percentile(sortedDurations, 0.99),
    maxMs: sortedDurations[sortedDurations.length - 1] ?? null,
    oldestAt: buffer[0]?.timestamp ?? null,
    newestAt: buffer[buffer.length - 1]?.timestamp ?? null,
    thresholdMs,
    capacity: BUFFER_CAPACITY,
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  // Nearest-rank method (kein interpolieren — bei kleinen samples
  // ist exact-value verlässlicher als linear-interp).
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx] ?? null;
}

export function clearSlowQueryBuffer(): void {
  const buffer = getBuffer();
  buffer.length = 0;
}

export function getSlowQueryThresholdMs(): number {
  return getThresholdMs();
}

export function getSlowQueryBufferCapacity(): number {
  return BUFFER_CAPACITY;
}
