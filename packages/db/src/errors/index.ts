/**
 * Track 4 #103 (Section T) — Client-Error-Log helpers.
 *
 * Server-side ingestion + read-queries für ClientErrorLog. Konsumiert
 * vom POST /api/errors-endpoint (write) und der /admin/errors-page (read).
 *
 * # Rate-limiting
 *
 * In-memory bucket pro IP. 10 errors / 60s. Über-rate-limit returnen
 * `{ rateLimited: true }` und der API-endpoint antwortet 429. Buckets
 * werden lazy gepruned (cleanup beim nächsten record).
 *
 * # Out-of-scope V1
 *
 * - Source-map-resolution (browser-stacks sind in prod minified)
 * - Auto-prune (entries > 30d alt löschen) — manual via DB-cleanup
 * - De-duplication (gleicher error 100× = 100 entries) — V2 könnte
 *   einen "count"-spalte addieren mit unique-index auf (message, url,
 *   stack-hash)
 */

import { prisma } from "../index.js";
import type { ClientErrorLog, Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────
// Rate-limiting (in-memory bucket)
// ─────────────────────────────────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStartedAt: number;
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

const globalForBuckets = globalThis as unknown as {
  __vam_error_rate_buckets?: Map<string, RateBucket>;
};

function getBuckets(): Map<string, RateBucket> {
  if (!globalForBuckets.__vam_error_rate_buckets) {
    globalForBuckets.__vam_error_rate_buckets = new Map();
  }
  return globalForBuckets.__vam_error_rate_buckets;
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
 * Liefert true wenn dieser key noch unter dem rate-limit ist, false
 * wenn drüber. Sliding-window-light: window resettet bei erstem call
 * nach ablauf. Bei mehr als RATE_MAX calls innerhalb des aktiven
 * windows → rate-limited.
 */
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const buckets = getBuckets();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartedAt > RATE_WINDOW_MS) {
    bucket = { count: 0, windowStartedAt: now };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  // Garbage-collect alle paar minuten — bei high-traffic verhindert das
  // unbounded growth der Map.
  if (buckets.size > 100) pruneStaleBuckets(now);

  return bucket.count <= RATE_MAX;
}

// ─────────────────────────────────────────────────────────────────────────
// Ingestion
// ─────────────────────────────────────────────────────────────────────────

export interface RecordClientErrorInput {
  userId?: string | null;
  url: string;
  message: string;
  stack?: string | null;
  userAgent?: string | null;
  occurredAt: Date;
  context?: Prisma.InputJsonValue | null;
  /** Rate-limit-key. Typischerweise IP + userId-fallback. */
  rateLimitKey: string;
}

export interface RecordClientErrorResult {
  recorded: boolean;
  rateLimited: boolean;
  id?: string;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 16_000;
const MAX_URL_LEN = 2000;
const MAX_USER_AGENT_LEN = 500;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…(truncated)";
}

/**
 * Persistiert einen client-seitigen error nach validation + rate-limit.
 * Truncated felder zu sane sizes (postgres Text ist unlimited aber wir
 * wollen kein 10-MB-blob in einer row).
 *
 * Returns `{ recorded: false, rateLimited: true }` wenn der rate-limit-
 * key sein quota überschritten hat — caller (api-endpoint) returnt
 * dann 429.
 */
export async function recordClientError(
  input: RecordClientErrorInput,
): Promise<RecordClientErrorResult> {
  if (!checkRateLimit(input.rateLimitKey)) {
    return { recorded: false, rateLimited: true };
  }

  const created = await prisma.clientErrorLog.create({
    data: {
      userId: input.userId ?? null,
      url: truncate(input.url, MAX_URL_LEN),
      message: truncate(input.message, MAX_MESSAGE_LEN),
      stack: input.stack ? truncate(input.stack, MAX_STACK_LEN) : null,
      userAgent: input.userAgent
        ? truncate(input.userAgent, MAX_USER_AGENT_LEN)
        : null,
      occurredAt: input.occurredAt,
      context: input.context ?? undefined,
    },
    select: { id: true },
  });

  return { recorded: true, rateLimited: false, id: created.id };
}

// ─────────────────────────────────────────────────────────────────────────
// Read queries (admin viewer)
// ─────────────────────────────────────────────────────────────────────────

export interface ListClientErrorsInput {
  limit?: number;
  /** Cursor-pagination: ID der zuletzt gezeigten entry. */
  beforeId?: string | null;
  userId?: string | null;
  url?: string | null;
}

export interface ListClientErrorsResult {
  entries: (ClientErrorLog & {
    user: { id: string; name: string | null; image: string | null } | null;
  })[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listClientErrors(
  input: ListClientErrorsInput = {},
): Promise<ListClientErrorsResult> {
  const limit = Math.min(input.limit ?? 50, 200);
  const where: Prisma.ClientErrorLogWhereInput = {};
  if (input.userId) where.userId = input.userId;
  if (input.url) where.url = input.url;

  const entries = await prisma.clientErrorLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.beforeId
      ? { cursor: { id: input.beforeId }, skip: 1 }
      : {}),
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
  });

  const hasMore = entries.length > limit;
  const trimmed = hasMore ? entries.slice(0, limit) : entries;
  const nextCursor = hasMore ? (trimmed[trimmed.length - 1]?.id ?? null) : null;

  return { entries: trimmed, hasMore, nextCursor };
}

export async function countClientErrorsSince(since: Date): Promise<number> {
  return prisma.clientErrorLog.count({
    where: { createdAt: { gte: since } },
  });
}

/**
 * Top-10 URLs by error-count innerhalb der letzten 24h. Für
 * admin-overview "which pages crash most".
 */
export async function getTopErrorUrlsLast24h(): Promise<
  { url: string; count: number }[]
> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.clientErrorLog.groupBy({
    by: ["url"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { url: "desc" } },
    take: 10,
  });
  return rows.map((r) => ({ url: r.url, count: r._count._all }));
}
