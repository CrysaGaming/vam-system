/**
 * Welle N / N4 — Garmin Connect IQ token helpers.
 *
 * Server-only. Token-lifecycle: generate → store-hash → verify on
 * every request → mark lastUsedAt.
 *
 * # Format
 *
 *   plain:  "vamg_" + 48 hex chars (192 bit entropy)
 *   hash:   sha256(plain) hex-encoded (64 chars)
 *   suffix: last 4 chars of plain (for UI display)
 *
 * # Storage
 *
 * DB never sees the plain token after the create call returns it. UI
 * shows the plain string once + a copy button; we save tokenHash +
 * tokenSuffix for later identification.
 */

import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@vam/db';

const TOKEN_PREFIX = 'vamg_';
const TOKEN_HEX_BYTES = 24; // → 48 hex chars

export function hashToken(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/**
 * Generate a fresh plain-token + its sha256 hash + display-suffix.
 * Caller stores the hash; the plain is returned to the user exactly
 * once.
 */
export function generateToken(): {
  plain: string;
  hash: string;
  suffix: string;
} {
  const plain = TOKEN_PREFIX + randomBytes(TOKEN_HEX_BYTES).toString('hex');
  return {
    plain,
    hash: hashToken(plain),
    suffix: plain.slice(-4),
  };
}

/**
 * Verify a bearer token from an incoming request. Returns the userId
 * if valid + not-revoked + correct prefix; null otherwise.
 *
 * Side effect on success: sets lastUsedAt = now() so the user can see
 * which tokens are actively in use (for revocation decisions).
 *
 * The lastUsedAt write is fire-and-forget — even if it races/fails,
 * the request itself succeeds. We don't want token-auth to be slower
 * than necessary.
 */
export async function verifyBearer(
  authHeader: string | null,
): Promise<{ userId: string; tokenId: string } | null> {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const plain = match[1];
  if (!plain.startsWith(TOKEN_PREFIX)) return null;

  const hash = hashToken(plain);
  const row = await prisma.garminApiToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return null;

  // Fire-and-forget lastUsedAt update — don't block the response.
  prisma.garminApiToken
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      // Swallow — caller already got their auth result.
    });

  return { userId: row.userId, tokenId: row.id };
}
