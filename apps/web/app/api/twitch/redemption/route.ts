/**
 * Welle O / O4 — Twitch channel-points redemption webhook.
 *
 * Route: POST /api/twitch/redemption
 *
 * Called by the VAM-bot (apps/bot, separate process) when it receives
 * a Twitch EventSub event of type
 * `channel.channel_points_custom_reward_redemption.add`. The bot
 * forwards the relevant fields to this endpoint so we can:
 *
 *   1. Look up the configured ChannelPointReward mapping for this
 *      streamer + reward-id.
 *   2. Dispatch to the matching action-handler (wallet credit,
 *      callsign-shout marker, gate/weather note).
 *   3. Log the redemption in ChannelPointRedemption for UI display.
 *
 * # Why a server-to-server webhook rather than direct EventSub here
 *
 * EventSub-websocket connections need to be held open with a stable
 * client-secret + reconnect handling. The bot already runs that loop
 * for stream.online/offline (Welle 14B); duplicating it in the web
 * server would mean two parallel websocket lifetimes for the same
 * twitch-account. Cheaper to let the bot stay the single EventSub
 * subscriber and forward business events here via HTTP.
 *
 * # Auth
 *
 * Shared-secret in `X-VAM-Bot-Token` header. Env var TWITCH_BOT_WEBHOOK_SECRET
 * is required server-side. Missing/wrong header → 401. The bot reads
 * the same env var when initializing its forwarder. No per-request
 * signing (HMAC) because the bot↔server traffic is over an internal
 * network or trusted-tunnel and the secret rotates with redeploys —
 * acceptable trade-off for now.
 *
 * # Idempotency
 *
 * Twitch's EventSub occasionally re-delivers on websocket reconnect.
 * ChannelPointRedemption.twitchRedemptionId is @unique, so a retry
 * with the same redemption-id will hit the unique-constraint and we
 * respond with the SAME 200 OK from the existing row's status, rather
 * than executing the action again. Without this, viewers could get
 * double-credited if the bot crashed mid-forward.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@vam/db';
import { executeChannelPointAction } from '@/lib/twitch/channel-point-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────
// REQUEST SCHEMA
// ────────────────────────────────────────────────────────────
//
// Bot sends a single JSON object per redemption. The streamer is
// identified by their twitchUserId (which the bot knows from the
// EventSub subscription metadata). We resolve twitchUserId → our
// User row server-side to avoid the bot having to track that mapping.
//
// All strings sized to comfortably fit Twitch's actual max lengths
// (channel names ≤25, reward titles ≤45, user input ≤500). The bot
// MUST not send fields we don't define; extra keys get dropped by
// zod's default strict parsing.

const RedemptionPayload = z.object({
  /** Streamer's twitchUserId (numeric string, e.g. "12345678"). */
  broadcasterTwitchUserId: z.string().min(1).max(64),
  /** Twitch's UUID for the redemption-instance — used for idempotency. */
  redemptionId: z.string().min(1).max(64),
  /** Twitch's UUID for the custom reward (survives renames). */
  rewardId: z.string().min(1).max(64),
  /** Display title at time of redemption. */
  rewardTitle: z.string().min(1).max(120),
  /** Viewer who redeemed. */
  redeemerUsername: z.string().min(1).max(60),
  /** Optional free-text input from the viewer. */
  redeemerUserInput: z.string().max(500).optional().default(''),
});

type RedemptionInput = z.infer<typeof RedemptionPayload>;

// ────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ─── Auth ──────────────────────────────────────────────────
  const expectedSecret = process.env.TWITCH_BOT_WEBHOOK_SECRET;
  if (!expectedSecret) {
    // Env-misconfiguration: refuse to process so the bot's retries
    // don't silently succeed against an unauthenticated endpoint.
    return NextResponse.json(
      { error: 'server_misconfigured', message: 'TWITCH_BOT_WEBHOOK_SECRET not set' },
      { status: 500 },
    );
  }
  const providedSecret = req.headers.get('x-vam-bot-token');
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ─── Parse + validate body ─────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = RedemptionPayload.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_payload',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }
  const input: RedemptionInput = parsed.data;

  // ─── Resolve streamer ──────────────────────────────────────
  const streamer = await prisma.user.findUnique({
    where: { twitchUserId: input.broadcasterTwitchUserId },
    select: { id: true },
  });
  if (!streamer) {
    // Bot is forwarding for a twitchUserId that isn't linked to any
    // VAM account. Could happen if the user disconnected mid-flight.
    // Return 200 with status=unlinked so the bot doesn't retry.
    return NextResponse.json(
      { status: 'unlinked', message: 'No VAM user linked to that twitchUserId' },
      { status: 200 },
    );
  }

  // ─── Idempotency check ─────────────────────────────────────
  // Existing redemption with the same Twitch UUID = duplicate delivery.
  // Return the cached outcome rather than re-executing.
  const existing = await prisma.channelPointRedemption.findUnique({
    where: { twitchRedemptionId: input.redemptionId },
    select: { id: true, status: true, errorMessage: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        status: 'duplicate',
        redemptionId: existing.id,
        outcome: existing.status,
        error: existing.errorMessage,
      },
      { status: 200 },
    );
  }

  // ─── Look up reward-mapping ────────────────────────────────
  const reward = await prisma.channelPointReward.findUnique({
    where: {
      userId_twitchRewardId: {
        userId: streamer.id,
        twitchRewardId: input.rewardId,
      },
    },
  });

  // ─── No mapping configured → log as UNMATCHED, ack 200 ─────
  if (!reward) {
    const row = await prisma.channelPointRedemption.create({
      data: {
        userId: streamer.id,
        rewardId: null,
        twitchRedemptionId: input.redemptionId,
        redeemerUsername: input.redeemerUsername,
        redeemerUserInput: input.redeemerUserInput,
        rewardTitleSnapshot: input.rewardTitle,
        status: 'UNMATCHED',
      },
      select: { id: true },
    });
    return NextResponse.json(
      { status: 'unmatched', redemptionId: row.id },
      { status: 200 },
    );
  }

  // ─── Mapping disabled → log as SKIPPED_DISABLED ────────────
  if (!reward.isEnabled) {
    const row = await prisma.channelPointRedemption.create({
      data: {
        userId: streamer.id,
        rewardId: reward.id,
        twitchRedemptionId: input.redemptionId,
        redeemerUsername: input.redeemerUsername,
        redeemerUserInput: input.redeemerUserInput,
        rewardTitleSnapshot: input.rewardTitle,
        status: 'SKIPPED_DISABLED',
      },
      select: { id: true },
    });
    return NextResponse.json(
      { status: 'skipped', redemptionId: row.id },
      { status: 200 },
    );
  }

  // ─── Execute action ────────────────────────────────────────
  // Wrap in try/catch — handlers should return ok=false but if one
  // throws unexpectedly we want to log it as FAILED, not 500.
  let outcome: { ok: true; note?: string } | { ok: false; error: string };
  try {
    outcome = await executeChannelPointAction({
      userId: streamer.id,
      actionType: reward.actionType,
      payload:
        reward.payloadJson && typeof reward.payloadJson === 'object'
          ? (reward.payloadJson as Record<string, unknown>)
          : null,
      redeemerUsername: input.redeemerUsername,
      redeemerUserInput: input.redeemerUserInput,
    });
  } catch (err) {
    outcome = {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown executor error',
    };
  }

  // ─── Log the result ────────────────────────────────────────
  const row = await prisma.channelPointRedemption.create({
    data: {
      userId: streamer.id,
      rewardId: reward.id,
      twitchRedemptionId: input.redemptionId,
      redeemerUsername: input.redeemerUsername,
      redeemerUserInput: input.redeemerUserInput,
      rewardTitleSnapshot: input.rewardTitle,
      status: outcome.ok ? 'EXECUTED' : 'FAILED',
      errorMessage: outcome.ok ? null : outcome.error,
      executedAt: new Date(),
    },
    select: { id: true },
  });

  // Refresh the reward-title snapshot if it drifted (streamer renamed
  // on Twitch). Fire-and-forget — failure here doesn't matter for the
  // viewer-facing outcome.
  if (reward.rewardTitle !== input.rewardTitle) {
    void prisma.channelPointReward
      .update({
        where: { id: reward.id },
        data: { rewardTitle: input.rewardTitle },
      })
      .catch((err: unknown) => {
        console.warn('[twitch-redemption] title refresh failed:', err);
      });
  }

  return NextResponse.json(
    {
      status: outcome.ok ? 'executed' : 'failed',
      redemptionId: row.id,
      note: outcome.ok ? outcome.note : undefined,
      error: outcome.ok ? undefined : outcome.error,
    },
    { status: 200 },
  );
}
