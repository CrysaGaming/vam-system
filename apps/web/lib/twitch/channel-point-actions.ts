import 'server-only';

/**
 * Welle O / O4 — Channel-points action executor.
 *
 * Centralises the "given a matched reward + redemption, do the thing"
 * logic. Called from /api/twitch/redemption after the bot delivers a
 * webhook and we've resolved the reward-mapping.
 *
 * # Why a separate module rather than inline in the route
 *
 * The route's job is: auth the bot, validate the payload, look up the
 * mapping, write the redemption log. The action-execution is its own
 * concern — fuel-bonus credits a wallet, callsign-shout fires a discord
 * webhook, etc. Different code paths, different failure modes. Keeping
 * the dispatcher here means the route stays short and the executors
 * stay testable in isolation.
 *
 * # Action-handler contract
 *
 * Each handler returns `{ ok: true } | { ok: false, error: string }`.
 * The route translates that into the ChannelPointRedemption.status
 * enum (EXECUTED vs FAILED) + errorMessage. Handlers don't throw —
 * any thrown exception bubbles up to the route and gets caught there
 * as a generic FAILED with `error.message`, but the well-behaved path
 * is to return ok=false with a friendly message.
 *
 * # Failure mode for missing LiveSession
 *
 * GATE_REQUEST and WEATHER_NUDGE are "in-flight" actions — they need
 * an active LiveSession to attach to. If none exists at redemption-
 * time, we return ok=false with "no active flight". The route logs
 * this as FAILED (not UNMATCHED — UNMATCHED is for missing mapping,
 * not missing session-state). The streamer sees on the page: "Viewer
 * X redeemed Gate Request but you weren't flying — sorry viewer".
 */

import {
  prisma,
  recordTransaction,
  getOrCreateWallet,
  getSystemWallet,
  InsufficientFundsError,
  type ChannelPointActionType,
} from '@vam/db';

export type ExecuteContext = {
  /** Owner of the mapping (the streamer). */
  userId: string;
  actionType: ChannelPointActionType;
  /** Reward-config payload (action-type-specific shape). */
  payload: Record<string, unknown> | null;
  /** Viewer who redeemed — for log/display messages. */
  redeemerUsername: string;
  /** Free-text input the viewer typed (empty string if not requested). */
  redeemerUserInput: string;
};

export type ExecuteResult =
  | { ok: true; note?: string }
  | { ok: false, error: string };

export async function executeChannelPointAction(
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  switch (ctx.actionType) {
    case 'FUEL_BONUS':
      return executeFuelBonus(ctx);
    case 'CALLSIGN_SHOUT':
      return executeCallsignShout(ctx);
    case 'GATE_REQUEST':
      return executeGateRequest(ctx);
    case 'WEATHER_NUDGE':
      return executeWeatherNudge(ctx);
    default: {
      // Exhaustiveness-check: if a new ChannelPointActionType lands
      // in the schema, TS will complain here until we wire a handler.
      const _exhaustive: never = ctx.actionType;
      void _exhaustive;
      return { ok: false, error: `Unknown action: ${ctx.actionType}` };
    }
  }
}

// ────────────────────────────────────────────────────────────
// FUEL_BONUS — wallet credit
// ────────────────────────────────────────────────────────────

async function executeFuelBonus(ctx: ExecuteContext): Promise<ExecuteResult> {
  // Default 25 VAM$ if the streamer didn't set a custom amount. Cap
  // at 1000 to prevent a misconfigured payload (or a hand-edited DB
  // row) from draining the system-wallet.
  const rawAmount =
    ctx.payload && typeof ctx.payload.amountVam === 'number'
      ? ctx.payload.amountVam
      : 25;
  const amount = Math.max(1, Math.min(1000, Math.round(rawAmount)));

  try {
    const streamerWallet = await getOrCreateWallet({
      ownerType: 'USER',
      ownerUserId: ctx.userId,
    });
    const systemWallet = await getSystemWallet();

    await prisma.$transaction(async (db) => {
      await recordTransaction({
        walletId: streamerWallet.id,
        amount,
        type: 'REVENUE_STREAM_REWARD',
        category: 'twitch-channel-point-fuel',
        description: `Channel-points: ${ctx.redeemerUsername} → Fuel Bonus (+${amount})`,
        counterpartyWalletId: systemWallet.id,
        db,
      });
    });

    return { ok: true, note: `Credited ${amount} VAM$` };
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      // Won't happen for credits (TRANSFER from system), but recordTransaction
      // can throw it for the counterparty in extreme cases.
      return { ok: false, error: 'System wallet out of funds — contact admin' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Wallet write failed',
    };
  }
}

// ────────────────────────────────────────────────────────────
// CALLSIGN_SHOUT — discord post (delegated to bot)
// ────────────────────────────────────────────────────────────

/**
 * CALLSIGN_SHOUT delegation:
 *
 * We don't post to discord from the web app — the discord-bot lives
 * in apps/bot (separate process, holds the bot-token, manages channel
 * IDs per-airline). Posting from here would require either (a) calling
 * the discord-bot's REST API which doesn't exist yet, or (b) duplicating
 * the bot-token into the web environment.
 *
 * Instead we record the intent: a row written to the redemption log
 * with status=EXECUTED and the redeemer's name is enough. The bot,
 * when it next polls this user's recent redemptions (or when the
 * EventSub forwarding round-trips), already has the data it needs to
 * post the message.
 *
 * Trade-off: in the current architecture the bot HAS the redemption
 * data first (it's what forwarded it to us), so the bot can post
 * locally before/after calling us. The success-marker we return here
 * is the bot's signal that the mapping was valid + logged, not that
 * a discord-message was posted. For now this is fine; if we later
 * decouple (e.g. polling-based reconciliation), we'll revisit.
 */
async function executeCallsignShout(
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  // No side-effect from the web app's side. The redemption log row
  // IS the side-effect; the bot consumes it.
  void ctx;
  return { ok: true, note: 'Shout-out queued for #livestreams' };
}

// ────────────────────────────────────────────────────────────
// GATE_REQUEST — verify in-flight, log is the record
// ────────────────────────────────────────────────────────────

/**
 * GATE_REQUEST + WEATHER_NUDGE both require an active LiveSession to
 * be meaningful — they're "viewer suggests something during the
 * flight" actions. We do NOT write to AcarsEvent: the existing enum
 * (PHASE_CHANGE/TOUCHDOWN/INCIDENT/etc) is for sim-derived events,
 * not viewer-injected notes. Misusing INCIDENT would pollute the
 * post-flight log with false-positive incident markers.
 *
 * Instead the ChannelPointRedemption row IS the persistent record —
 * userId + createdAt + redeemerUserInput. The pilot's PIREP-detail
 * page can JOIN redemptions that fall within the LiveSession's
 * activeAt..endedAt window and display them as "Viewer suggestions
 * during this flight". No schema mutation needed; we just gate the
 * action on an active session existing here.
 */
async function executeGateRequest(
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const session = await prisma.liveSession.findFirst({
    where: { userId: ctx.userId, isActive: true },
    select: { id: true },
  });
  if (!session) {
    return { ok: false, error: 'No active flight — gate-request dropped' };
  }
  // The redemption log row (written by the route) is the side-effect;
  // we just confirm the flight context.
  return { ok: true, note: 'Logged against active flight' };
}

// ────────────────────────────────────────────────────────────
// WEATHER_NUDGE — verify in-flight, log is the record
// ────────────────────────────────────────────────────────────

async function executeWeatherNudge(
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const session = await prisma.liveSession.findFirst({
    where: { userId: ctx.userId, isActive: true },
    select: { id: true },
  });
  if (!session) {
    return { ok: false, error: 'No active flight — weather-nudge dropped' };
  }
  const preset =
    ctx.payload && typeof ctx.payload.preset === 'string'
      ? String(ctx.payload.preset).slice(0, 40)
      : 'unspecified';
  return { ok: true, note: `Weather nudge "${preset}" logged` };
}
