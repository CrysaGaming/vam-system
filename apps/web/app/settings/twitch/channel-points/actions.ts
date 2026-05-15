'use server';

/**
 * Welle O / O4 — Server actions für /settings/twitch/channel-points.
 *
 * Per-user (not airline-scoped): each pilot configures their own
 * Twitch channel-point mappings. Auth via NextAuth session — owner
 * checks (where: { userId }) gate all writes. No airline-manager
 * required.
 *
 * # Why per-user
 *
 * Channel-points belong to a Twitch channel, which is 1:1 with a
 * VAM user (twitchUserId on User). An airline doesn't own its
 * members' Twitch rewards — each streamer configures their own.
 * If two pilots in the same airline both stream, they each get
 * their own /settings/twitch/channel-points page.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/auth';
import {
  prisma,
  ChannelPointActionType,
} from '@vam/db';

type ActionResult =
  | { ok: true; rewardId?: string }
  | { ok: false; error: string };

// ────────────────────────────────────────────────────────────
// PAYLOAD SCHEMAS per action-type
// ────────────────────────────────────────────────────────────
//
// Each action-type takes a different config shape. We validate
// per-type rather than a single union-schema because zod's
// discriminated-union ergonomics get noisy in FormData-land — and
// we'd rather build the validator dynamically based on the user's
// selected actionType than handle a "tagged union mismatch" error
// from zod itself.

const FuelBonusPayload = z.object({
  amountVam: z
    .number()
    .int()
    .min(1, 'Mindestens 1 VAM$')
    .max(1000, 'Maximal 1000 VAM$'),
});

const CallsignShoutPayload = z.object({}); // no config

const GateRequestPayload = z.object({
  label: z
    .string()
    .max(80, 'Label max 80 Zeichen')
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
});

const WeatherNudgePayload = z.object({
  preset: z
    .string()
    .min(1, 'Preset darf nicht leer sein')
    .max(40, 'Preset max 40 Zeichen'),
});

function buildPayloadForActionType(
  actionType: ChannelPointActionType,
  raw: FormData,
): { ok: true; payload: Record<string, unknown> | null } | { ok: false; error: string } {
  switch (actionType) {
    case 'FUEL_BONUS': {
      const amountStr = String(raw.get('payload_amountVam') ?? '');
      const amount = Number.parseInt(amountStr, 10);
      const parsed = FuelBonusPayload.safeParse({ amountVam: amount });
      if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid amount' };
      }
      return { ok: true, payload: parsed.data };
    }
    case 'CALLSIGN_SHOUT': {
      // No payload-fields. Store null to signal "default behavior".
      return { ok: true, payload: null };
    }
    case 'GATE_REQUEST': {
      const label = String(raw.get('payload_label') ?? '');
      const parsed = GateRequestPayload.safeParse({ label });
      if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid label' };
      }
      // GateRequestPayload's transform drops empty strings — payload
      // may end up as {} (no label override). Store as null in that
      // case so the executor falls back to "Gate change request".
      const payload = parsed.data;
      if (payload.label === undefined) return { ok: true, payload: null };
      return { ok: true, payload };
    }
    case 'WEATHER_NUDGE': {
      const preset = String(raw.get('payload_preset') ?? '').trim();
      const parsed = WeatherNudgePayload.safeParse({ preset });
      if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid preset' };
      }
      return { ok: true, payload: parsed.data };
    }
  }
}

// ────────────────────────────────────────────────────────────
// COMMON form schema (top-level fields, regardless of action-type)
// ────────────────────────────────────────────────────────────

const VALID_ACTION_TYPES = [
  'FUEL_BONUS',
  'CALLSIGN_SHOUT',
  'GATE_REQUEST',
  'WEATHER_NUDGE',
] as const satisfies readonly ChannelPointActionType[];

const CommonFields = z.object({
  twitchRewardId: z
    .string()
    .min(1, 'Twitch reward-ID erforderlich')
    .max(64, 'Reward-ID max 64 Zeichen')
    // Twitch reward IDs are UUIDs (36 chars with dashes), but we don't
    // hard-validate the UUID format — a hand-pasted one with stray
    // whitespace would otherwise reject silently. Trust the @unique
    // constraint to surface real duplicates.
    .transform((v) => v.trim()),
  rewardTitle: z
    .string()
    .min(1, 'Titel erforderlich')
    .max(120, 'Titel max 120 Zeichen')
    .transform((v) => v.trim()),
  actionType: z.enum(VALID_ACTION_TYPES, {
    message: 'Action-typ ungültig',
  }),
});

// ────────────────────────────────────────────────────────────
// CREATE
// ────────────────────────────────────────────────────────────

export async function createReward(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const userId = session.user.id;

  const commonParsed = CommonFields.safeParse({
    twitchRewardId: formData.get('twitchRewardId'),
    rewardTitle: formData.get('rewardTitle'),
    actionType: formData.get('actionType'),
  });
  if (!commonParsed.success) {
    return { ok: false, error: commonParsed.error.issues[0]?.message ?? 'Ungültige Eingabe' };
  }

  const payloadResult = buildPayloadForActionType(
    commonParsed.data.actionType,
    formData,
  );
  if (!payloadResult.ok) return payloadResult;

  // Pre-check: existing mapping for this twitchRewardId? Prisma's
  // @@unique would also catch this but the error-shape is ugly; we
  // present a clean message instead.
  const existing = await prisma.channelPointReward.findUnique({
    where: {
      userId_twitchRewardId: {
        userId,
        twitchRewardId: commonParsed.data.twitchRewardId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error: 'Es existiert bereits ein mapping für diese Twitch reward-ID',
    };
  }

  const created = await prisma.channelPointReward.create({
    data: {
      userId,
      twitchRewardId: commonParsed.data.twitchRewardId,
      rewardTitle: commonParsed.data.rewardTitle,
      actionType: commonParsed.data.actionType,
      // Cast: zod gives us Record<string, unknown>, Prisma's Json
      // input expects InputJsonValue (recursive plain-JSON shape).
      // Our payload-validators only produce JSON-safe values
      // (numbers, strings, plain objects), so the cast is sound.
      payloadJson:
        (payloadResult.payload as unknown as object | undefined) ?? undefined,
      // isEnabled defaults true via schema
    },
    select: { id: true },
  });

  revalidatePath('/settings/twitch/channel-points');
  revalidatePath('/settings/twitch');
  return { ok: true, rewardId: created.id };
}

// ────────────────────────────────────────────────────────────
// UPDATE
// ────────────────────────────────────────────────────────────

export async function updateReward(
  rewardId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const userId = session.user.id;

  const commonParsed = CommonFields.safeParse({
    twitchRewardId: formData.get('twitchRewardId'),
    rewardTitle: formData.get('rewardTitle'),
    actionType: formData.get('actionType'),
  });
  if (!commonParsed.success) {
    return { ok: false, error: commonParsed.error.issues[0]?.message ?? 'Ungültige Eingabe' };
  }

  const payloadResult = buildPayloadForActionType(
    commonParsed.data.actionType,
    formData,
  );
  if (!payloadResult.ok) return payloadResult;

  // Owner-check via findFirst with userId — Prisma's update() would
  // throw P2025 if the row didn't exist, but we want to distinguish
  // "row doesn't exist" from "row belongs to someone else" without
  // leaking that fact. Both return the same "not found" message.
  const existing = await prisma.channelPointReward.findFirst({
    where: { id: rewardId, userId },
    select: { id: true, twitchRewardId: true },
  });
  if (!existing) {
    return { ok: false, error: 'Mapping nicht gefunden' };
  }

  // If the user changed the twitchRewardId to one they already use
  // for another mapping, the @@unique would throw. Check first for
  // a friendly error.
  if (existing.twitchRewardId !== commonParsed.data.twitchRewardId) {
    const conflict = await prisma.channelPointReward.findUnique({
      where: {
        userId_twitchRewardId: {
          userId,
          twitchRewardId: commonParsed.data.twitchRewardId,
        },
      },
      select: { id: true },
    });
    if (conflict && conflict.id !== rewardId) {
      return {
        ok: false,
        error: 'Es existiert bereits ein anderes mapping für diese Twitch reward-ID',
      };
    }
  }

  await prisma.channelPointReward.update({
    where: { id: rewardId },
    data: {
      twitchRewardId: commonParsed.data.twitchRewardId,
      rewardTitle: commonParsed.data.rewardTitle,
      actionType: commonParsed.data.actionType,
      // Same Json-input cast as createReward — see comment there.
      payloadJson:
        (payloadResult.payload as unknown as object | undefined) ?? undefined,
    },
  });

  // If the user set payload to null we want to clear, not "skip". The
  // line above writes undefined which Prisma interprets as "don't touch".
  // For null clears we need a separate write — only when the new value
  // is null AND the existing payload was non-null.
  if (payloadResult.payload === null) {
    await prisma.channelPointReward.update({
      where: { id: rewardId },
      data: { payloadJson: { set: null } as never },
    });
  }

  revalidatePath('/settings/twitch/channel-points');
  return { ok: true, rewardId };
}

// ────────────────────────────────────────────────────────────
// TOGGLE isEnabled
// ────────────────────────────────────────────────────────────

export async function toggleReward(rewardId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const userId = session.user.id;

  const existing = await prisma.channelPointReward.findFirst({
    where: { id: rewardId, userId },
    select: { isEnabled: true },
  });
  if (!existing) {
    return { ok: false, error: 'Mapping nicht gefunden' };
  }

  await prisma.channelPointReward.update({
    where: { id: rewardId },
    data: { isEnabled: !existing.isEnabled },
  });

  revalidatePath('/settings/twitch/channel-points');
  return { ok: true, rewardId };
}

// ────────────────────────────────────────────────────────────
// DELETE
// ────────────────────────────────────────────────────────────

export async function deleteReward(rewardId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Nicht angemeldet' };
  const userId = session.user.id;

  const existing = await prisma.channelPointReward.findFirst({
    where: { id: rewardId, userId },
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, error: 'Mapping nicht gefunden' };
  }

  // Cascade-on-delete: schema declares onDelete: SetNull for
  // ChannelPointRedemption.rewardId, so historical log rows stay
  // intact (rewardId becomes null) and the streamer can still see
  // "Viewer X redeemed Y (mapping deleted)" in the redemptions table.
  await prisma.channelPointReward.delete({
    where: { id: rewardId },
  });

  revalidatePath('/settings/twitch/channel-points');
  revalidatePath('/settings/twitch');
  return { ok: true, rewardId };
}
