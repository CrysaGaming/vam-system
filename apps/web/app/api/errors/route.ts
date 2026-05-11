import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recordClientError, Prisma } from '@vam/db';
import { auth } from '@/auth';

/**
 * Track 4 #103 (Section T) — POST /api/errors
 *
 * Endpoint für client-side error-reporting. Client (browser) postet
 * errors hierher; helper recordClientError persistiert sie in
 * ClientErrorLog mit in-memory rate-limit (10/60s pro IP).
 *
 * # Auth
 *
 * Optional. Wenn session existiert, wird userId gespeichert.
 * Unauth-user können auch errors melden (z.b. signin-page-crash),
 * dann userId=null.
 *
 * # Body-shape
 *
 *   {
 *     url: string         // current page URL inkl. query
 *     message: string     // error.message
 *     stack?: string      // error.stack (truncated server-side)
 *     occurredAt: string  // ISO-timestamp (client-clock)
 *     context?: object    // free-shape extra data
 *     userAgent?: string  // optional, fallback navigator.userAgent
 *   }
 *
 * # Responses
 *
 *   200 { ok: true, id: "..." }       — recorded
 *   429 { ok: false, rateLimited: 1 } — rate-limit hit, NOT recorded
 *   400 { ok: false, error: "..." }   — invalid body
 *
 * # Rate-limit-key
 *
 * Bevorzugt userId wenn auth (fairer für mehrere user hinter NAT),
 * fallback x-forwarded-for (production behind proxy), fallback
 * 'anon-noip' (lokal/test).
 */

// Force-dynamic: kein static-gen, jeder request hits den handler
export const dynamic = 'force-dynamic';

const PostBodySchema = z.object({
  url: z.string().min(1).max(2500),
  message: z.string().min(1).max(2500),
  stack: z.string().max(20_000).optional(),
  occurredAt: z.string().datetime({ offset: true }),
  context: z.record(z.string(), z.unknown()).optional(),
  userAgent: z.string().max(600).optional(),
});

function getClientIp(req: NextRequest): string {
  // Cloudflare tunnel + Next.js: x-forwarded-for ist der korrekte
  // header (kein x-real-ip). Comma-separated bei mehreren proxies →
  // erster eintrag ist client.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'anon-noip';
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON.' },
      { status: 400 },
    );
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid body.',
        issues: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  // Auth ist optional — recordClientError akzeptiert userId=null.
  // auth() ist relativ teuer (DB-roundtrip für session) aber wir brauchen
  // userId für link-back-to-user in der admin-view + bessere rate-limit-
  // keys. Bei error-storms ist das ein bisschen wasteful, aber der
  // rate-limit kappt das eh schnell.
  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session?.user?.id ?? null;
  } catch {
    // Auth failures sollen nicht den error-report blockieren
    userId = null;
  }

  const ip = getClientIp(req);
  const rateLimitKey = userId ? `user:${userId}` : `ip:${ip}`;

  const userAgent =
    parsed.data.userAgent ?? req.headers.get('user-agent') ?? null;

  // context-handling: zod validated als Record<string, unknown>. Prisma's
  // InputJsonValue ist eine restrictive union (no functions, no symbols,
  // no Date). JSON.stringify→parse-roundtrip strippt alle nicht-JSON-
  // serializable values und gibt uns ein guaranteed-JSON-compatible-object.
  // Cast via `unknown` ist sicher weil das resultat de-facto JSON-only ist.
  let safeContext: Prisma.InputJsonValue | null = null;
  if (parsed.data.context) {
    try {
      safeContext = JSON.parse(
        JSON.stringify(parsed.data.context),
      ) as Prisma.InputJsonValue;
    } catch {
      safeContext = null;
    }
  }

  const result = await recordClientError({
    userId,
    url: parsed.data.url,
    message: parsed.data.message,
    stack: parsed.data.stack ?? null,
    userAgent,
    occurredAt: new Date(parsed.data.occurredAt),
    context: safeContext,
    rateLimitKey,
  });

  if (result.rateLimited) {
    return NextResponse.json(
      { ok: false, rateLimited: true },
      { status: 429 },
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}
