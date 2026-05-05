/**
 * Public Overlay API
 *
 * Endpoint: GET /api/overlay/[token]/data
 *
 * Liefert die aktuellen Live-Daten eines Pilots für externe Konsumenten
 * (OBS Browser-Source, Streaming-Tools, Discord-Bots, etc.).
 *
 * Authentication: Token-basiert via URL-Path-Parameter.
 *   - Token ist 32 hex chars (128 bit Entropie)
 *   - User generiert Token in /settings, kann rotieren
 *   - Bei Leak: User rotiert → alter Token sofort ungültig
 *
 * Rate-Limiting:
 *   - 100 Requests/Min pro Token (5s Polling = 12/Min, viel Buffer)
 *   - 200 Requests/Min pro IP (mehrere OBS-Instanzen pro IP möglich)
 *   - 401-Spike-Detection bei 5+ failed auths in 1 Min
 *
 * CORS: Access-Control-Allow-Origin: *
 *   → Erlaubt OBS-Browser-Source und externe Web-Apps
 *
 * Cache: no-store
 *   → Daten ändern sich alle 30s (Tracker-Interval), aber User erwartet
 *     "live", also kein Caching auf Browser/CDN-Ebene.
 *
 * Response-Format: siehe OverlayResponse in _lib/build-payload.ts
 *
 * Track 1 #8 Phase 6 (commit cd6068e+):
 *   - Business-logic ist jetzt in _lib/build-payload.ts shared mit
 *     stream/route.ts. Diese route ist nur noch der polling-transport.
 *
 * @see _lib/build-payload.ts          shared response-builder
 * @see _lib/auth-helpers.ts            shared token + IP utilities
 * @see /api/overlay/[token]/stream     SSE-variant (push statt poll)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@vam/db';
import {
  checkRateLimit,
  recordAuthFail,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  CORS_HEADERS,
  jsonResponse,
  getClientIp,
  isValidTokenFormat,
} from '../_lib/auth-helpers';
import {
  buildOverlayPayload,
  type OverlayErrorResponse,
} from '../_lib/build-payload';

// ────────────────────────────────────────────────────────────
// OPTIONS HANDLER (CORS preflight)
// ────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ────────────────────────────────────────────────────────────
// GET HANDLER
// ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const ip = getClientIp(req);

  // ─── 1. Token-Format-Check (vor DB-Hit, schnell) ──────────
  if (!isValidTokenFormat(token)) {
    recordAuthFail(`bad-format:${ip}`);
    return jsonResponse<OverlayErrorResponse>(
      { error: 'invalid_token_format' },
      401,
    );
  }

  // ─── 2. Rate-Limit ─────────────────────────────────────────
  const rateLimit = checkRateLimit(token, ip);
  const rateLimitHeaders = {
    'X-RateLimit-Limit': String(RATE_LIMITS.TOKEN_REQUESTS_PER_MIN),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
  };

  if (!rateLimit.allowed) {
    return jsonResponse<OverlayErrorResponse>(
      {
        error: 'rate_limit_exceeded',
        message: `Too many requests. Limited by ${rateLimit.limitedBy}.`,
      },
      429,
      rateLimitHeaders,
    );
  }

  // ─── 3. Token-Lookup ───────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { overlayToken: token },
    select: {
      id: true,
      name: true,
      rank: { select: { name: true } },
    },
  });

  if (!user) {
    recordAuthFail(`unknown-token:${ip}`);
    return jsonResponse<OverlayErrorResponse>(
      { error: 'invalid_token' },
      401,
      rateLimitHeaders,
    );
  }

  // ─── 4. Build payload (LiveSession + Airport + METAR + …) ─
  const payload = await buildOverlayPayload(user);

  return jsonResponse(payload, 200, rateLimitHeaders);
}
