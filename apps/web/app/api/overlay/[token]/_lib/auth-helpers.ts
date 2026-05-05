import 'server-only';

/**
 * Track 1 #8 Phase 6 — Shared auth-helpers für die overlay-routes.
 *
 * Das war früher inline in data/route.ts. Jetzt mit dem stream-endpoint
 * dazu — eine zweite kopie ist nicht acceptable, also extracted.
 *
 * Die helpers sind read-only utilities (kein state), keine session-info,
 * keine cookies. Reines token-format-checking + IP-extraction +
 * response-construction.
 */

import { NextRequest, NextResponse } from 'next/server';

// ────────────────────────────────────────────────────────────
// CORS-HEADERS
// ────────────────────────────────────────────────────────────

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

export function jsonResponse<T>(
  data: T,
  status: number,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Extrahiert die Client-IP aus dem Request. Berücksichtigt Cloudflare-
 * Tunnel-Header und Standard-Proxy-Header.
 *
 * Reihenfolge: cf-connecting-ip > x-forwarded-for[0] > x-real-ip >
 * 'unknown'. Cloudflare ist primary weil Kevin's prod via tunnel läuft.
 */
export function getClientIp(req: NextRequest): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;

  return 'unknown';
}

/**
 * Validiert Token-Format. Schnell-Check vor DB-Zugriff um Bruteforce
 * via Garbage-Tokens zu reduzieren.
 *
 * Erwartetes Format: 32 hex chars (a-f, 0-9), case-insensitive
 */
export function isValidTokenFormat(token: string): boolean {
  return /^[0-9a-f]{32}$/i.test(token);
}
