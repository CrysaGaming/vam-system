import 'server-only';
import { prisma, type Prisma } from '@vam/db';
import {
  generatePirepFromSession,
  type BlockOnPayload,
  type GeneratePirepResult,
} from './generate-pirep';

/**
 * Auto-PIREP trigger orchestration (M6, updated for option #19).
 *
 * Bundles the things that happen when a BLOCK_ON event closes out a
 * flight session:
 *
 *   1. generatePirepFromSession — turns the LiveSession + payload into
 *      a real Pirep row (status=Draft after option #19), transfers
 *      FlightPlanCache, closes the session, links the AcarsEvent.
 *      triggeredPirepId for the audit-trail.
 *   2. (was: emitPirepSubmitted + evaluatePromotion as fire-and-forget
 *      side-channels). Now DELIBERATELY omitted on the auto-Draft path.
 *      Both side-channels fire later when the pilot manually clicks
 *      "Submit zur Review" on /pireps/[id], which calls
 *      submitDraftPirep → Draft → Submitted transition. The Discord
 *      embed and rank-promotion are tied to "the pilot is happy with
 *      this PIREP", not "the auto-generator finished".
 *
 * Why move them out: the original M6 behaviour broadcast every flight
 * to Discord the moment BLOCK_ON fired, with whatever the heuristic
 * splice produced in remarks (sim-rate flags, replay-flags). When a
 * heuristic produced a false-positive the pilot wanted to remove it
 * before it reached #pireps. The Draft-state (option #19) is the gate
 * that gives them that chance.
 *
 * Why a separate file (still): this exact orchestration runs from two
 * call-sites that arrived at it via different paths:
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
 *     2-Hz heartbeat round-trip wait on PIREP-creation.
 *     So this path fires-and-forgets the helper, the heartbeat ack
 *     goes back fast, and the PIREP lands a moment later.
 *
 * Both paths converge here so future side-channels (twitch-overlay
 * broadcast, post-flight metrics push) can be added once and benefit
 * both. Without this helper the two routes would accumulate their own
 * divergent copies — exactly the kind of boilerplate that ages badly.
 *
 * Idempotency guarantee: the underlying helper returns
 * 'session-already-closed' if a previous call already filed the
 * PIREP. Caller can distinguish "filed now" (ok=true) from "filed
 * earlier" (ok=false, reason='session-already-closed') and route
 * HTTP status / log-level accordingly.
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
    // Note (option #19): we deliberately do NOT fire emitPirepSubmitted
    // or evaluatePromotion here. The PIREP just landed in Draft; the
    // pilot has not yet decided to publish it. Both side-channels move
    // to submitDraftPirep (apps/web/app/pireps/actions.ts) and fire on
    // the Draft → Submitted transition the pilot triggers manually.
    //
    // Why even keep this branch then: the result envelope still carries
    // pilot/aircraft/landing-rate enrichment fields the caller may want
    // for HTTP-response logging or live-UI feedback. Returning ok=true
    // also distinguishes "Draft created" from "session-already-closed"
    // for the heartbeat-route's status-code logic.

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
