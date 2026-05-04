import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, AcarsEventType, type Prisma } from '@vam/db';
import { authenticateAcarsRequest } from '@/lib/acars/auth';
import {
  generatePirepFromSession,
  type BlockOnPayload,
} from '@/lib/acars/generate-pirep';
import { emitPirepSubmitted } from '@/lib/bot-events';
import { evaluatePromotion } from '@/lib/ranks';

/**
 * POST /api/acars/event — Welle 9 commit 9F.
 *
 * Lifecycle and telemetry events from the ACARS-client. Distinct from
 * /api/acars/heartbeat (which is the high-frequency telemetry stream)
 * — this endpoint is event-driven, fires only on state-transitions:
 * phase-changes, touchdown, block-on/block-off, incidents, connection
 * recovery. The rate is low (a typical flight has maybe 15-30 events
 * across ~2 hours) but each event matters semantically.
 *
 * The event-type drives behavior:
 *   - BLOCK_ON: trigger auto-PIREP-creation (the headline feature
 *     of welle 9). Closes the LiveSession, files a Pirep with
 *     state=Landed/status=Submitted, links the AcarsEvent back to
 *     the PIREP it produced, fires the discord notification.
 *   - All others: persist as AcarsEvent rows for audit-trail. Future
 *     features may consume them (e.g., 9F+ might surface INCIDENTs
 *     in admin-review). For now they're just durable history.
 *
 * Why one endpoint for all event-types instead of per-type endpoints:
 * the client batches events naturally (it has a single event-bus that
 * dispatches over HTTP), and the dispatching logic stays here in one
 * file rather than scattered across /api/acars/event/touchdown,
 * /api/acars/event/block-on, etc. Tradeoff: a slightly larger switch
 * statement here. Worth it for fewer files and clearer ownership.
 *
 * Idempotency: BLOCK_ON is the only event with a meaningful side-
 * effect (PIREP-creation). The generate-pirep helper checks isActive
 * inside its transaction — a duplicate BLOCK_ON for the same session
 * returns 'session-already-closed' rather than filing twice. Other
 * event-types are append-only AcarsEvent rows; duplicate-prevention
 * isn't needed (or even desirable — repeated PHASE_CHANGEs to the
 * same phase are a real signal of state-flapping the client wants
 * us to see).
 */

// Same anti-replay window as heartbeat. 5min past tolerates retries on
// flaky net; 1min future tolerates client clock-drift.
const TIMESTAMP_PAST_WINDOW_MS = 5 * 60 * 1000;
const TIMESTAMP_FUTURE_WINDOW_MS = 60 * 1000;

function isTimestampWithinWindow(clientTs: string): boolean {
  const ts = Date.parse(clientTs);
  if (Number.isNaN(ts)) return false;
  const now = Date.now();
  return ts >= now - TIMESTAMP_PAST_WINDOW_MS && ts <= now + TIMESTAMP_FUTURE_WINDOW_MS;
}

const EventSchema = z.object({
  // ISO-8601 client-side timestamp. Anti-replay window check.
  timestamp: z.string().datetime(),

  // Which session this event belongs to. Verified server-side that
  // the requesting user owns this session before we trust it (see
  // generate-pirep's session-not-owned-by-user check). For non-PIREP
  // events we still check ownership before recording.
  sessionId: z.string().min(1).max(64),

  type: z.nativeEnum(AcarsEventType),

  // Type-specific payload. Validated lightly (object-or-null); the
  // semantic shape per type is documented in AcarsEvent's schema-comment.
  // We intentionally don't z.discriminatedUnion here: payloads evolve
  // across client-versions and rejecting on shape-drift would lock the
  // server to a specific client. Better to accept and let downstream
  // consumers (admin-review, future analytics) handle missing fields.
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await authenticateAcarsRequest(req);
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }

  const parsed = EventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid-payload', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  if (!isTimestampWithinWindow(data.timestamp)) {
    return NextResponse.json(
      { error: 'timestamp-out-of-window' },
      { status: 400 },
    );
  }

  // BLOCK_ON has the heaviest side-effects (file-PIREP) and gets a
  // dedicated codepath via the generate-pirep helper. The helper
  // verifies session-ownership inside, but for the OTHER event-types
  // we don't go through the helper — so we still need to check that
  // the requesting user owns the session before persisting an event
  // against it. Without this check, a paired ACARS-client could write
  // events to any session-id (data-pollution attack, even if low-impact).
  if (data.type !== 'BLOCK_ON') {
    const session = await prisma.liveSession.findUnique({
      where: { id: data.sessionId },
      select: { userId: true },
    });
    if (!session) {
      return NextResponse.json(
        { error: 'session-not-found' },
        { status: 404 },
      );
    }
    if (session.userId !== auth.user.id) {
      return NextResponse.json(
        { error: 'session-not-owned' },
        { status: 403 },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // BLOCK_ON: auto-PIREP path
  // ─────────────────────────────────────────────────────────────────
  if (data.type === 'BLOCK_ON') {
    const result = await generatePirepFromSession(
      data.sessionId,
      auth.user.id,
      (data.payload ?? null) as BlockOnPayload | null,
    );

    if (!result.ok) {
      // Even when PIREP-creation fails (e.g., unknown airport ICAO),
      // we still want to record the BLOCK_ON event for the audit-trail.
      // Otherwise the client would have no way to surface "your sim
      // was at FOO airport but FOO isn't in our catalog, file manually".
      //
      // Skip recording when reason is session-already-closed (the helper
      // didn't file because someone else did first; the originating
      // BLOCK_ON event is already in the DB) or session-not-owned (we
      // don't trust the request enough to write to the DB).
      if (
        result.reason !== 'session-already-closed' &&
        result.reason !== 'session-not-owned-by-user' &&
        result.reason !== 'session-not-found'
      ) {
        await prisma.acarsEvent
          .create({
            data: {
              sessionId: data.sessionId,
              type: 'BLOCK_ON',
              payload: {
                ...((data.payload ?? {}) as Prisma.JsonObject),
                _trigger_failed: result.reason,
                _trigger_detail: result.detail ?? null,
              } as Prisma.InputJsonValue,
            },
          })
          .catch((err) => {
            // Don't propagate event-recording failures — the client
            // should still see the trigger-result. AcarsEvent failure
            // is non-fatal (next event has its own try, audit-trail
            // is best-effort here).
            console.warn('[acars/event] failed to record failed-BLOCK_ON event', err);
          });
      }

      // Map helper-reasons to HTTP status codes. 4xx for client-data
      // problems (unknown airport, missing fields), 409 for
      // already-filed (idempotent retry), 403 for session ownership.
      const statusByReason: Record<typeof result.reason, number> = {
        'session-not-found': 404,
        'session-not-owned-by-user': 403,
        'no-airline': 400,
        'missing-departure-icao': 400,
        'missing-arrival-icao': 400,
        'departure-airport-unknown': 422,
        'arrival-airport-unknown': 422,
        'session-already-closed': 409,
      };
      return NextResponse.json(
        {
          ok: false,
          reason: result.reason,
          detail: result.detail,
        },
        { status: statusByReason[result.reason] },
      );
    }

    // PIREP filed. Fire the side-channels best-effort: discord
    // notification + rank-promotion check. Both are non-critical
    // (matches the manual-flow's pattern in /pireps/new) — failures
    // here shouldn't roll back the PIREP since it's already committed.
    void emitPirepSubmitted({
      pirepId: result.pirepId,
      userId: auth.user.id,
      flightNumber: result.flightNumber,
      departureIcao: result.departureIcao,
      arrivalIcao: result.arrivalIcao,
      flightTimeMin: result.flightTimeMin,
      aircraftRegistration: result.aircraftRegistration,
      remarks: result.remarks,
    }).catch((err) =>
      console.warn('[acars/event] emitPirepSubmitted failed:', err),
    );

    void evaluatePromotion(auth.user.id).catch((err) =>
      console.warn('[acars/event] evaluatePromotion failed:', err),
    );

    return NextResponse.json({
      ok: true,
      pirepId: result.pirepId,
      flightTimeMin: result.flightTimeMin,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // All other event-types: append-only audit log
  // ─────────────────────────────────────────────────────────────────
  const event = await prisma.acarsEvent.create({
    data: {
      sessionId: data.sessionId,
      type: data.type,
      payload: (data.payload ?? null) as Prisma.InputJsonValue,
      // timestamp uses the schema's default(now()) — we deliberately
      // use server-time, not the client-provided timestamp, for the
      // canonical event-time. Client timestamp is in the payload if
      // we ever need to reconstruct client-clock for analysis.
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, eventId: event.id });
}
