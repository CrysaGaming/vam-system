import 'server-only';
import { prisma, type Prisma } from '@vam/db';
import {
  generatePirepFromSession,
  type BlockOnPayload,
  type GeneratePirepResult,
} from './generate-pirep';
import { emitPirepSubmitted } from '@/lib/bot-events';
import { evaluatePromotion } from '@/lib/ranks';

/**
 * Auto-PIREP trigger orchestration (M6).
 *
 * Bundles the three things that happen when a BLOCK_ON event closes
 * out a flight session:
 *
 *   1. generatePirepFromSession — turns the LiveSession + payload into
 *      a real Pirep row, transfers FlightPlanCache, closes the session,
 *      links the AcarsEvent.triggeredPirepId for the audit-trail.
 *   2. emitPirepSubmitted — fans out to Discord-bot, leaderboards,
 *      anywhere else that wants to hear "pilot just filed a flight".
 *   3. evaluatePromotion — checks if the new flight pushes the pilot
 *      across a rank threshold (hours-based, in-airline).
 *
 * Both side-channels are best-effort and never block the PIREP itself
 * — they're fire-and-forget with their own .catch handlers, matching
 * the convention from the manual /pireps/new flow.
 *
 * Why a separate file: this exact orchestration runs from two call-
 * sites that arrived at it via different paths:
 *
 *   - POST /api/acars/event with type=BLOCK_ON — original Welle 9
 *     path, where the client explicitly fires an event after seeing
 *     parking-brake-set + GS=0 in its own simvar feed. The client
 *     POSTs once, the server files the PIREP synchronously and
 *     returns the pirepId in the response so the client can deep-
 *     link to /pireps/[id].
 *
 *   - POST /api/acars/heartbeat detecting a BlockOn phase transition
 *     server-side (M3.9). Heartbeats are best-effort, the client
 *     doesn't expect a pirepId back, and we don't want to make the
 *     2-Hz heartbeat round-trip wait on PIREP-creation + Discord.
 *     So this path fires-and-forgets the helper, the heartbeat ack
 *     goes back fast, and the PIREP lands a moment later.
 *
 * Both paths converge here so future side-channels (twitch-overlay
 * broadcast, webhook fan-out, post-flight metrics push) get added
 * once and benefit both. Without this helper the two routes would
 * accumulate their own divergent copies — exactly the kind of
 * boilerplate that ages badly.
 *
 * Idempotency guarantee: the underlying helper returns
 * 'session-already-closed' if a previous call already filed the
 * PIREP. Side-channels are skipped on that path so we don't
 * double-broadcast. Caller can distinguish "filed now" (ok=true)
 * from "filed earlier" (ok=false, reason='session-already-closed')
 * and route HTTP status / log-level accordingly.
 *
 * Failure-event recording: when generatePirepFromSession returns a
 * recoverable failure reason (unknown airport ICAO, missing fields,
 * etc.), we write a BLOCK_ON AcarsEvent row anyway with the failure
 * detail in the payload. This matches the original event-route's
 * behavior — the audit-trail captures "we tried to file but couldn't"
 * so the user can later see why their flight wasn't auto-filed and
 * either correct the data or file manually. Skipped for
 * not-found / not-owned / already-closed since those don't represent
 * useful audit information.
 */
export async function triggerAutoPirep(
  sessionId: string,
  userId: string,
  payload: BlockOnPayload | null,
): Promise<GeneratePirepResult> {
  const result = await generatePirepFromSession(sessionId, userId, payload);

  if (result.ok) {
    // Fire side-channels in parallel. void + .catch() is the canonical
    // fire-and-forget pattern; the caller never awaits these. Errors
    // get logged but don't propagate — a Discord outage shouldn't
    // make a successfully-filed PIREP look failed.
    void emitPirepSubmitted({
      pirepId: result.pirepId,
      userId,
      flightNumber: result.flightNumber,
      departureIcao: result.departureIcao,
      arrivalIcao: result.arrivalIcao,
      flightTimeMin: result.flightTimeMin,
      aircraftRegistration: result.aircraftRegistration,
      remarks: result.remarks,
    }).catch((err) =>
      console.warn('[auto-pirep] emitPirepSubmitted failed:', err),
    );

    void evaluatePromotion(userId).catch((err) =>
      console.warn('[auto-pirep] evaluatePromotion failed:', err),
    );

    return result;
  }

  // Recoverable failure: record audit-trail event so the user can see
  // why auto-filing didn't work. Skip the obviously-uninteresting reasons.
  if (
    result.reason !== 'session-already-closed' &&
    result.reason !== 'session-not-owned-by-user' &&
    result.reason !== 'session-not-found'
  ) {
    await prisma.acarsEvent
      .create({
        data: {
          sessionId,
          type: 'BLOCK_ON',
          payload: {
            ...((payload ?? {}) as Prisma.JsonObject),
            _trigger_failed: result.reason,
            _trigger_detail: result.detail ?? null,
          } as Prisma.InputJsonValue,
        },
      })
      .catch((err) => {
        // Audit-recording is best-effort — losing this row is annoying
        // but doesn't break anything. Don't let the DB hiccup propagate
        // to the caller, who has its own response semantics.
        console.warn(
          '[auto-pirep] failed to record failure-BLOCK_ON event:',
          err,
        );
      });
  }

  return result;
}
