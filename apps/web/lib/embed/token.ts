/**
 * Welle N / N5 — Embed token helpers.
 *
 * Server-only. URL-safe public tokens for sharing live-flight-status
 * via Discord, OBS, Twitch panels. Different security model from
 * Garmin bearer-tokens:
 *
 *   - Token lives in URL (no header), so it's inherently public-ish
 *   - Stored plain (no hash) — knowing-the-DB-row doesn't tell you
 *     more than knowing-the-URL
 *   - 128 bit entropy (shorter than Garmin's 192 bit) — sufficient
 *     against brute-force on a per-user scope
 *   - Revocable, with lastUsedAt tracking
 */

import { randomBytes } from 'node:crypto';
import { prisma } from '@vam/db';

const TOKEN_PREFIX = 'vame_';
const TOKEN_HEX_BYTES = 16; // → 32 hex chars

export function generateEmbedToken(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_HEX_BYTES).toString('hex');
}

export type ResolvedEmbed = {
  userId: string;
  tokenId: string;
};

/**
 * Lookup an embed token. Returns null if missing or revoked. Side-
 * effect: bumps lastUsedAt (fire-and-forget).
 */
export async function resolveEmbedToken(
  token: string,
): Promise<ResolvedEmbed | null> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.embedToken.findUnique({
    where: { tokenString: token },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return null;

  prisma.embedToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {
      // ignore
    });

  return { userId: row.userId, tokenId: row.id };
}
