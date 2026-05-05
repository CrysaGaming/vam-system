/**
 * Public Overlay SSE Stream
 *
 * Endpoint: GET /api/overlay/[token]/stream
 *
 * Server-Sent-Events variant of /api/overlay/[token]/data. Statt 5s-poll
 * vom client öffnet der client eine persistent connection und der server
 * pusht alle 5s den aktuellen payload. Reduces:
 *   - HTTP-overhead (ein 200-OK statt 12 pro minute)
 *   - latenz (server pusht sofort wenn neue daten da sind, statt bis zum
 *     nächsten poll-tick zu warten)
 *   - rate-limit-pressure (1 connection counted statt 12 requests/min)
 *
 * Track 1 #8 Phase 6.
 *
 * # Architektur
 *
 * ReadableStream-controller bekommt vom server-side setInterval die
 * payloads enqueued. Auf client-disconnect (req.signal aborted) clearen
 * wir das interval und schließen den stream. Cleanup ist kritisch — sonst
 * läuft der DB-poll pro toter connection ewig weiter.
 *
 * Initial-tick passiert sofort nach connect (nicht erst nach 5s warten).
 * Dann läuft der setInterval(5000).
 *
 * # SSE-Format
 *
 * Jedes event:
 *   data: <JSON>\n\n
 *
 * Der client (EventSource) parst das automatisch und feuert onmessage
 * mit event.data = JSON-string. Wir brauchen kein custom event-name —
 * das default 'message' reicht.
 *
 * Heartbeat (kommentar-line ":\n\n") alle 25s — das hält die connection
 * durch idle-proxies offen (Cloudflare killt nach ~100s idle, GCP
 * load-balancer nach 240s). Da wir eh alle 5s ein data-event pushen ist
 * der heartbeat redundant solange daten fließen, aber falls die session
 * zwischen ticks inactive→active wechselt und der payload identisch
 * bleibt, schadet's nicht.
 *
 * # Auth + Rate-Limit
 *
 * Token-format-check + token-lookup laufen einmal beim connect, NICHT
 * pro tick. Der rate-limit zählt also nur die connection-establishment,
 * nicht die einzelnen events. Damit kann ein client den ganzen tag
 * verbunden bleiben ohne rate-limit-issues.
 *
 * # CORS
 *
 * SSE braucht KEIN preflight für simple GET (kein custom-header). Aber
 * wir setzen CORS-headers auf den stream-response damit cross-origin
 * EventSource (z.B. OBS-overlay-source vom externen webserver) funktioniert.
 *
 * @see _lib/build-payload.ts          shared response-builder
 * @see /api/overlay/[token]/data      polling-variant
 */

import { NextRequest } from 'next/server';
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
// CONSTANTS
// ────────────────────────────────────────────────────────────

const PUSH_INTERVAL_MS = 5000;

/**
 * Heartbeat zwischen den data-events. SSE-spec: lines starting mit ":"
 * sind comments und werden vom EventSource ignoriert. Verhindert dass
 * idle-proxies die connection killen, falls mal mehrere ticks dieselbe
 * payload liefern.
 */
const HEARTBEAT_INTERVAL_MS = 25_000;

// ────────────────────────────────────────────────────────────
// GET HANDLER
// ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const ip = getClientIp(req);

  // ─── 1. Token-Format-Check ─────────────────────────────────
  if (!isValidTokenFormat(token)) {
    recordAuthFail(`bad-format:${ip}`);
    return jsonResponse<OverlayErrorResponse>(
      { error: 'invalid_token_format' },
      401,
    );
  }

  // ─── 2. Rate-Limit (nur bei connect, nicht pro tick) ──────
  const rateLimit = checkRateLimit(token, ip);
  if (!rateLimit.allowed) {
    return jsonResponse<OverlayErrorResponse>(
      {
        error: 'rate_limit_exceeded',
        message: `Too many connections. Limited by ${rateLimit.limitedBy}.`,
      },
      429,
      {
        'X-RateLimit-Limit': String(RATE_LIMITS.TOKEN_REQUESTS_PER_MIN),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
      },
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
    );
  }

  // ─── 4. SSE-Stream ─────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(dataInterval);
        clearInterval(heartbeatInterval);
        try {
          controller.close();
        } catch {
          // controller schon geschlossen — ignorieren
        }
      };

      const sendData = async () => {
        if (closed) return;
        try {
          const payload = await buildOverlayPayload(user);
          if (closed) return;
          const line = `data: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(line));
        } catch (err) {
          // DB-error o.ä. — wir senden ein error-event und schließen
          // damit der client weiß dass er reconnecten soll. EventSource
          // macht das automatisch, mit etwas backoff.
          if (closed) return;
          const errPayload = {
            error: 'stream_error',
            message: err instanceof Error ? err.message : String(err),
          };
          try {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify(errPayload)}\n\n`,
              ),
            );
          } catch {
            // controller schon zu — egal
          }
          close();
        }
      };

      const sendHeartbeat = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          close();
        }
      };

      // Initial-tick sofort nach connect (kein 5s wait beim ersten frame)
      await sendData();

      const dataInterval = setInterval(() => {
        void sendData();
      }, PUSH_INTERVAL_MS);

      const heartbeatInterval = setInterval(
        sendHeartbeat,
        HEARTBEAT_INTERVAL_MS,
      );

      // Client-disconnect-handling: wenn der browser die connection schließt
      // (tab close, network drop, EventSource.close()), feuert req.signal
      // 'abort'. Ohne diesen handler liefe der setInterval ewig weiter und
      // würde DB-queries fürs nichts machen.
      req.signal.addEventListener('abort', close);
    },
    cancel() {
      // Wird gerufen wenn der consumer (Next.js runtime) den stream
      // canceled — z.B. response-timeout. Wir markieren als closed
      // damit pending sends bail. Die intervals werden im start-scope
      // closure-captured und nicht hier sichtbar; das req.signal
      // 'abort'-event feuert in derselben situation und cleant up.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform ist KRITISCH — sonst buffern Cloudflare/Nginx den
      // stream und der client sieht events erst minutenweise gebatched.
      'Cache-Control': 'no-cache, no-transform',
      // Connection: keep-alive ist HTTP/1.1 default aber explicit für
      // proxies die's nicht setzen.
      Connection: 'keep-alive',
      // Nginx-style proxies: explizit buffering disablen.
      'X-Accel-Buffering': 'no',
      ...CORS_HEADERS,
    },
  });
}

// ────────────────────────────────────────────────────────────
// OPTIONS HANDLER (CORS preflight)
// ────────────────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
