/**
 * Welle C / C6 — per-user rate-limit for /api/acars/heartbeat.
 *
 * Same in-memory fixed-window pattern as packages/db/src/errors/index.ts
 * (the /api/errors rate-limiter), but tuned for the heartbeat cadence
 * and the different threat model.
 *
 * # Threat model
 *
 * Heartbeats are sent every 2-5s by legitimate clients. A pilot starting
 * a flight, going offline for an hour, then coming back with a backed-up
 * queue can legitimately produce a burst of ~100 messages over ~10s as
 * the client drains its offline queue. We want to TOLERATE that pattern
 * while still cutting off a pathological client that's sending
 * heartbeats at 100 Hz indefinitely.
 *
 * # Threshold choice (90 req / 60s)
 *
 *   - Default cadence is 2s → 30 req/min legit baseline.
 *   - Aggressive 1s cadence (configurable) → 60 req/min still below cap.
 *   - Queue-drain after 3min outage at 2s interval → ~90 messages.
 *     The first 90 of those fly under-cap; messages beyond that hit
 *     429 and the client should pause-and-retry (C6 client side).
 *   - Sustained 100+ req/min = pathological. Cap at 90 keeps the
 *     server's hot-path tight (each heartbeat does ~3 DB writes,
 *     1 reverse-geocode, position-derivation; at 100 req/min per user
 *     across many users we'd see thousands of writes/s).
 *
 * The window is FIXED, not sliding — same as /api/errors. The window
 * starts when the first request after expiry hits, and counts within
 * that 60s window. After 60s of no requests it resets fresh. Sliding
 * windows would be more sophisticated but the fixed-window pattern is
 * already proven in production for /api/errors and the operational
 * properties are easy to reason about.
 *
 * # Per-user keys
 *
 * /api/errors uses IP-or-userId. Heartbeats ALWAYS have a userId
 * (authenticateAcarsRequest gate runs before us), so we key strictly
 * by userId. Per-IP keys would over-share between pilots behind the
 * same NAT (think: virtual-airline event with all members at one
 * physical location), and would under-share for a single user on a
 * mobile-tethered laptop with rotating IPs.
 *
 * # Cross-process state
 *
 * Single-process Next.js dev/prod-build only. The Map lives on
 * globalThis to survive hot-reloads in dev mode. In a multi-process
 * deploy (clustered Node, multiple Next servers), each process has
 * its own bucket-map and the effective limit per user becomes
 * `processes * 90`. For our single-process Cloudflared deployment
 * this is fine; if we ever multi-process, swap in a Redis-backed
 * bucket store (out of scope for v1).
 *
 * # Why a new helper instead of generalising /api/errors checkRateLimit
 *
 * Two reasons:
 *   1. Different threshold + window — sharing the helper means passing
 *      in those constants and the shared Map, which adds plumbing
 *      complexity for two-callers worth of savings.
 *   2. Heartbeat needs RICHER return data: not just allowed/denied but
 *      remaining-quota + reset-timestamp for emitting X-RateLimit-*
 *      response headers. The /api/errors helper returns just `boolean`.
 *
 * If a third caller wants per-user rate limiting later, we'll DRY the
 * two into a shared primitive then.
 */

interface AcarsRateBucket {
  count: number;
  windowStartedAt: number;
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 90;

// Hot-reload-safe global storage. The Map is module-level state, but
// without `globalThis` it would be re-instantiated on every dev-server
// rebuild (every file save), wiping rate-limit state mid-flight and
// effectively disabling the limit during development. Production
// builds are stable so this is purely a dev-mode concern.
const globalForBuckets = globalThis as unknown as {
  __vam_acars_rate_buckets?: Map<string, AcarsRateBucket>;
};

function getBuckets(): Map<string, AcarsRateBucket> {
  if (!globalForBuckets.__vam_acars_rate_buckets) {
    globalForBuckets.__vam_acars_rate_buckets = new Map();
  }
  return globalForBuckets.__vam_acars_rate_buckets;
}

function pruneStaleBuckets(now: number): void {
  const buckets = getBuckets();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt > RATE_WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

/**
 * Result of a rate-limit check. Always includes the header values
 * (limit/remaining/reset) so callers can attach them to ALL responses,
 * not just the 429. Surfacing remaining-quota in normal-response
 * headers lets a sufficiently-smart client preemptively slow down
 * before getting throttled (graceful degradation > hard cutoff).
 */
export interface AcarsRateLimitResult {
  /** True if this request is under-cap and should proceed. */
  allowed: boolean;
  /** Total cap for the window (matches X-RateLimit-Limit). */
  limit: number;
  /** Remaining requests in the current window, clamped >= 0. */
  remaining: number;
  /** Unix seconds when the current window expires (matches X-RateLimit-Reset). */
  resetUnixSec: number;
  /**
   * Seconds until the window expires. Surfaced separately from
   * resetUnixSec because Retry-After uses delta-seconds semantics
   * (RFC 9110 §10.2.3) — pre-computing it here keeps the caller
   * from having to recompute (now - resetUnixSec).
   */
  retryAfterSec: number;
}

/**
 * Check whether a user-keyed request is under the heartbeat rate-limit.
 *
 * Side-effect: increments the bucket's count for `key` regardless of
 * whether the request is allowed. That's the same pattern as
 * /api/errors checkRateLimit — the bucket counts ATTEMPTS not
 * acceptances, which means a flood of denied requests still ratchets
 * the counter and keeps the requester throttled until the window
 * expires. Without that property, a client that ignores 429 could
 * keep hammering at full speed forever.
 *
 * The returned bucket state reflects the post-increment state so the
 * header values are accurate (remaining=0 on the 91st request, not -1).
 */
export function checkAcarsRateLimit(key: string): AcarsRateLimitResult {
  const now = Date.now();
  const buckets = getBuckets();
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStartedAt > RATE_WINDOW_MS) {
    bucket = { count: 0, windowStartedAt: now };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  // Lazy GC — same threshold as /api/errors. At per-user keys a typical
  // VA with 50 active pilots has ~50 entries; the 100-entry threshold
  // protects against pathological cases (lots of one-shot users or
  // stale buckets accumulating during traffic patterns).
  if (buckets.size > 100) pruneStaleBuckets(now);

  const resetAtMs = bucket.windowStartedAt + RATE_WINDOW_MS;
  const retryAfterMs = Math.max(0, resetAtMs - now);

  return {
    allowed: bucket.count <= RATE_MAX,
    limit: RATE_MAX,
    remaining: Math.max(0, RATE_MAX - bucket.count),
    resetUnixSec: Math.ceil(resetAtMs / 1000),
    // Round UP so a sub-second remainder doesn't suggest "0 seconds"
    // when the window still has 200ms left. The client should wait
    // a full integer second before retrying — matches Retry-After's
    // delta-seconds semantics.
    retryAfterSec: Math.ceil(retryAfterMs / 1000),
  };
}

/**
 * Build the standard X-RateLimit-* headers from a check result. Use
 * with `new NextResponse(..., { headers: rateLimitHeaders(rl) })` or
 * spread into an existing headers init. Always-on (attach to 2xx as
 * well as 429) so well-behaved clients can read remaining-quota and
 * preemptively slow down.
 *
 * Header names follow the IETF draft conventions used by GitHub,
 * Twitter, etc. — the X-prefix is legacy but ubiquitous, and the
 * RateLimit-* (no prefix) draft hasn't won enough adoption to be
 * worth depending on. Clients reading the X-RateLimit-* form work
 * with both this codebase and most production APIs.
 */
export function acarsRateLimitHeaders(
  rl: AcarsRateLimitResult,
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rl.limit),
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(rl.resetUnixSec),
  };
}
