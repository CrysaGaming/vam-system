import { randomBytes } from 'node:crypto';

/**
 * ACARS pairing helpers (Welle 9 commit 9B).
 *
 * Two distinct token-lifetimes here:
 *
 * 1. Pairing code: short, human-typable, one-time-use, 15-min TTL.
 *    Generated on /settings via server-action when the user clicks
 *    "Pair Device", consumed by the ACARS-client when the user types
 *    it in. After consume the code is dead.
 *
 * 2. ACARS token: long random, bearer-auth for /api/acars/*. Lives
 *    until the user disconnects (or pairs a new device — pairing
 *    rotates the token). Never sent in URL params or logs.
 *
 * Why pairing-code instead of OAuth/password: the client is third-party
 * (separate Electron repo). We don't want Discord-passwords leaving the
 * web-app, and OAuth-flow in a desktop-app means dealing with localhost-
 * redirect-listeners and DPAPI-keychain integration. The pairing-code
 * pattern (Spotify Connect, Discord-bot-pairing) is well-understood and
 * keeps the trust-boundary clean: web-app vouches for the user, hands
 * the client a token, done.
 */

/** 15 minutes — pairing code is a short-lived handshake artifact */
export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Unambiguous alphabet for pairing codes — excludes 0/O, 1/I/L. The
 * remaining 32 characters give us 32^9 ≈ 35e12 possible codes; with
 * 15-min TTL and rate-limited redeem (in 9C), brute-force is not a
 * realistic threat even if a user is the target.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a pairing code in 3-3-3 format, e.g. "X4F-7K2-9PB".
 * Uses crypto.randomBytes for proper entropy — Math.random would be
 * predictable enough that a determined attacker could narrow the search
 * space dramatically.
 */
export function generateReadableCode(): string {
  const bytes = randomBytes(9);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 3).join('')}-${chars.slice(3, 6).join('')}-${chars.slice(6, 9).join('')}`;
}

/**
 * Generate a 64-character hex ACARS token. 256 bits of entropy from
 * crypto.randomBytes — not brute-force-able under any realistic attack
 * model. Stored plaintext in DB because:
 *   1. Already random (vs hashing a password where the input is low-
 *      entropy and hashing prevents rainbow-table attacks).
 *   2. Comparing on every heartbeat — hashed lookup would force a
 *      table-scan instead of an index-seek on @unique.
 * If/when the threat model shifts (e.g., DB-dump scenarios), we can
 * revisit with constant-time-comparison and SHA256 of the token.
 */
export function generateAcarsToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Check if a pairing code's format looks plausible. Used for fast-fail
 * in the redeem endpoint before hitting the DB. Format: 9 chars from
 * CODE_ALPHABET in 3-3-3 layout.
 *
 * NOT a security check — even invalid-looking codes go to the DB
 * eventually (because someone might mistype) — this is just to short-
 * circuit obviously-malformed payloads (e.g., a missing dash).
 */
export function looksLikePairingCode(input: string): boolean {
  return /^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(input);
}
