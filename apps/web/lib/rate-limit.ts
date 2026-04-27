/**
 * Memory-basierter Rate-Limiter für Public-API-Endpoints.
 *
 * Use-Case: OBS-Overlay-API mit Token-Auth.
 * - Pro Token: 100 Requests/Minute (5s Polling = 12/Min, also viel Buffer)
 * - Pro IP:    200 Requests/Minute (mehrere OBS-Instanzen pro IP möglich)
 * - 401-Spike: Logging bei 5+ failed auths in 1 Min (Bruteforce-Verdacht)
 *
 * Memory-Footprint: ~100 bytes pro aktiver Client → 1000 Clients = 100KB
 * Cleanup: läuft automatisch alle 5 Min, entfernt Einträge älter als
 *          Window-Size + Buffer.
 *
 * Bei Skalierung > 1000 concurrent Streamern: auf Redis migrieren
 * (Interface bleibt gleich).
 */

// ────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────

const LIMITS = {
  // Token-Bucket (per overlay-token)
  TOKEN_REQUESTS_PER_MIN: 100,
  TOKEN_WINDOW_MS: 60_000,

  // IP-Bucket (per remote-IP)
  IP_REQUESTS_PER_MIN: 200,
  IP_WINDOW_MS: 60_000,

  // 401-Spike-Detection (potential bruteforce)
  AUTH_FAIL_THRESHOLD: 5,
  AUTH_FAIL_WINDOW_MS: 60_000,

  // Cleanup-Intervall: alle 5 Min stale entries entfernen
  CLEANUP_INTERVAL_MS: 5 * 60_000,
  // Eintrag stale wenn älter als max(window) + buffer
  STALE_THRESHOLD_MS: 10 * 60_000,
} as const;

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type RequestEntry = {
  /** Zeitstempel der Requests (ms epoch) */
  timestamps: number[];
  /** Letzter Zugriff für Cleanup-Detection */
  lastAccess: number;
};

type AuthFailEntry = {
  /** Zeitstempel der 401s */
  timestamps: number[];
  /** Wurde bereits geloggt für aktuelle Spike-Periode? (avoid log-spam) */
  alreadyLogged: boolean;
  lastAccess: number;
};

// ────────────────────────────────────────────────────────────
// STATE (in-memory)
// ────────────────────────────────────────────────────────────

const tokenRequests = new Map<string, RequestEntry>();
const ipRequests = new Map<string, RequestEntry>();
const authFails = new Map<string, AuthFailEntry>();

let cleanupInterval: NodeJS.Timeout | null = null;

// ────────────────────────────────────────────────────────────
// CLEANUP-CRON (lazy initialized on first usage)
// ────────────────────────────────────────────────────────────

function ensureCleanupRunning() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const stale = now - LIMITS.STALE_THRESHOLD_MS;

    let removed = 0;
    for (const [key, entry] of tokenRequests) {
      if (entry.lastAccess < stale) {
        tokenRequests.delete(key);
        removed++;
      }
    }
    for (const [key, entry] of ipRequests) {
      if (entry.lastAccess < stale) {
        ipRequests.delete(key);
        removed++;
      }
    }
    for (const [key, entry] of authFails) {
      if (entry.lastAccess < stale) {
        authFails.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[rate-limit] Cleanup: removed ${removed} stale entries`);
    }
  }, LIMITS.CLEANUP_INTERVAL_MS);
  // unref so cleanup-interval blockiert nicht Node-Exit (z.B. bei Tests)
  cleanupInterval.unref?.();
}

// ────────────────────────────────────────────────────────────
// CORE: Sliding-Window-Counter
// ────────────────────────────────────────────────────────────

function checkLimit(
  map: Map<string, RequestEntry>,
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  ensureCleanupRunning();
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = map.get(key);
  if (!entry) {
    entry = { timestamps: [], lastAccess: now };
    map.set(key, entry);
  }

  // Entferne abgelaufene Timestamps (sliding window)
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  entry.lastAccess = now;

  const used = entry.timestamps.length;
  const remaining = Math.max(0, maxRequests - used);
  const resetAt = entry.timestamps[0]
    ? entry.timestamps[0] + windowMs
    : now + windowMs;

  if (used >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt };
  }

  // Verbrauche ein Request-Slot
  entry.timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, resetAt };
}

// ────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────

export type RateLimitResult = {
  allowed: boolean;
  /** Verbleibende Requests im aktuellen Window */
  remaining: number;
  /** Wann das Window resettet (ms epoch) */
  resetAt: number;
  /** Welcher Limit-Type war ausschlaggebend (für Headers) */
  limitedBy?: 'token' | 'ip';
};

/**
 * Prüft Rate-Limit für Token + IP kombiniert.
 *
 * Returns allowed=false wenn ENTWEDER Token-Limit ODER IP-Limit überschritten.
 * Headers im Response: X-RateLimit-Remaining, X-RateLimit-Reset.
 */
export function checkRateLimit(
  token: string,
  ip: string,
): RateLimitResult {
  // Token-Check
  const tokenResult = checkLimit(
    tokenRequests,
    token,
    LIMITS.TOKEN_REQUESTS_PER_MIN,
    LIMITS.TOKEN_WINDOW_MS,
  );

  if (!tokenResult.allowed) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: tokenResult.resetAt,
      limitedBy: 'token',
    };
  }

  // IP-Check
  const ipResult = checkLimit(
    ipRequests,
    ip,
    LIMITS.IP_REQUESTS_PER_MIN,
    LIMITS.IP_WINDOW_MS,
  );

  if (!ipResult.allowed) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: ipResult.resetAt,
      limitedBy: 'ip',
    };
  }

  // Beide passen: nutze niedrigeren remaining-Wert für Header
  return {
    allowed: true,
    remaining: Math.min(tokenResult.remaining, ipResult.remaining),
    resetAt: Math.max(tokenResult.resetAt, ipResult.resetAt),
  };
}

/**
 * Loggt einen Auth-Failure. Bei Spike (5+ in 1 Min) wird einmalig
 * eine Warning ausgegeben (oder später Discord-Webhook getriggert).
 *
 * Identifier: kann IP, Token-Prefix, oder beides sein.
 */
export function recordAuthFail(identifier: string): void {
  ensureCleanupRunning();
  const now = Date.now();
  const cutoff = now - LIMITS.AUTH_FAIL_WINDOW_MS;

  let entry = authFails.get(identifier);
  if (!entry) {
    entry = { timestamps: [], alreadyLogged: false, lastAccess: now };
    authFails.set(identifier, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  entry.timestamps.push(now);
  entry.lastAccess = now;

  // Spike-Detection
  if (
    entry.timestamps.length >= LIMITS.AUTH_FAIL_THRESHOLD &&
    !entry.alreadyLogged
  ) {
    console.warn(
      `[rate-limit] Auth-fail spike detected for "${identifier}": ` +
        `${entry.timestamps.length} failures in last 60s. Possible bruteforce.`,
    );
    // TODO bei Bedarf: Discord-Webhook firen
    entry.alreadyLogged = true;
  }

  // Reset alreadyLogged-Flag wenn alle Failures im Window abgelaufen sind
  if (entry.timestamps.length === 0) {
    entry.alreadyLogged = false;
  }
}

/**
 * Test/Admin-Helper: Aktuelle Stats.
 */
export function getRateLimitStats() {
  return {
    activeTokens: tokenRequests.size,
    activeIps: ipRequests.size,
    suspectIdentifiers: Array.from(authFails.entries())
      .filter(([_, e]) => e.timestamps.length >= LIMITS.AUTH_FAIL_THRESHOLD)
      .map(([id]) => id),
  };
}

/**
 * Test-Helper: Reset all state. Nicht in Production verwenden.
 */
export function _resetRateLimitState() {
  tokenRequests.clear();
  ipRequests.clear();
  authFails.clear();
}

/**
 * Limits exportieren für Tests + Header-Generation.
 */
export const RATE_LIMITS = LIMITS;
