import 'server-only';

/**
 * Welle O / O5 — Twitch auto-clip helper.
 *
 * Single entrypoint: `createTwitchClip({userId, trigger, pirepId?})`.
 * Loads the streamer's broadcaster-id + access-token, calls Helix
 * `POST /helix/clips`, and persists the resulting clip-id + edit-url
 * to a `TwitchClip` row. Fire-and-forget from the caller's perspective:
 * any failure (token expired, offline, missing scope) results in a
 * clean `{ ok: false, reason }` return rather than a thrown exception.
 *
 * # Why fire-and-forget
 *
 * Callers are milestone triggers in approvePirep / award-grant flows.
 * Those flows must NOT fail because Twitch's clip-endpoint had a
 * hiccup — a flight gets credited regardless of whether a clip lands
 * on the streamer's channel. So we always return a Result, never throw.
 *
 * # Failure modes
 *
 * - `not_connected`: user has no twitchUserId on their User row.
 * - `no_token`: connected but twitchAccessToken is null (rare — should
 *    only happen mid-OAuth-flow or after a token-revoke).
 * - `offline`: Twitch returns 404 — broadcaster isn't live, can't clip.
 * - `reauth_required`: Twitch returns 401 (expired token) or 403
 *    (missing `clips:edit` scope). The streamer needs to reconnect.
 *    Existing tokens minted before Welle O / O5 don't have this scope.
 * - `rate_limited`: Twitch returns 429. We don't retry; the milestone
 *    is one-shot.
 * - `unknown`: anything else (5xx, network error, malformed JSON).
 *
 * # No retries
 *
 * Twitch clips capture roughly the last ~30s of live stream. A retry
 * 5 seconds later would clip a different (later) moment — defeating
 * the point of "auto-clip THE landing." If the first POST fails, the
 * moment is gone.
 */

import { prisma, type TwitchClipTrigger } from '@vam/db';

export type CreateClipInput = {
  userId: string;
  trigger: TwitchClipTrigger;
  /** Source PIREP for landing-triggered clips. Optional for non-PIREP
   *  triggers (award grants etc.). Stored on the TwitchClip row. */
  pirepId?: string;
  /** Source Award for award-triggered clips. Reserved for future use. */
  awardId?: string;
};

export type CreateClipResult =
  | { ok: true; clipId: string; editUrl: string }
  | {
      ok: false;
      reason:
        | 'not_connected'
        | 'no_token'
        | 'offline'
        | 'reauth_required'
        | 'rate_limited'
        | 'unknown';
      detail?: string;
    };

// Twitch Helix endpoint + the env vars we need.
const HELIX_CREATE_CLIP = 'https://api.twitch.tv/helix/clips';

export async function createTwitchClip(
  input: CreateClipInput,
): Promise<CreateClipResult> {
  // ─── Env-config-check ─────────────────────────────────────
  // Without TWITCH_CLIENT_ID the Helix call lacks the required
  // `Client-Id` header and will 400. We treat this as a server-
  // misconfiguration but don't throw — the milestone flow continues.
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    console.warn('[twitch-clip] TWITCH_CLIENT_ID missing — skipping clip');
    return { ok: false, reason: 'unknown', detail: 'TWITCH_CLIENT_ID not set' };
  }

  // ─── Load streamer credentials ────────────────────────────
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { twitchUserId: true, twitchAccessToken: true },
  });
  if (!user?.twitchUserId) {
    return { ok: false, reason: 'not_connected' };
  }
  if (!user.twitchAccessToken) {
    return { ok: false, reason: 'no_token' };
  }

  // ─── Call Helix POST /clips ───────────────────────────────
  // Query-param `broadcaster_id` identifies whose channel to clip.
  // `has_delay=false` (default) clips the most recent stream-frame
  // available; `true` would add a 90s delay (gives the streamer time
  // to react before the clip is created, useful for surprise events
  // but we want immediate capture for landings).
  const url = `${HELIX_CREATE_CLIP}?broadcaster_id=${encodeURIComponent(
    user.twitchUserId,
  )}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.twitchAccessToken}`,
        'Client-Id': clientId,
      },
      // No body — broadcaster_id is in the query string per Twitch's
      // API design. Sending an empty body is fine; Helix accepts it.
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'unknown',
      detail: err instanceof Error ? err.message : 'network error',
    };
  }

  // ─── Handle non-2xx responses ─────────────────────────────
  if (!res.ok) {
    switch (res.status) {
      case 401:
        return { ok: false, reason: 'reauth_required', detail: 'token expired (401)' };
      case 403:
        // 403 from /clips typically = missing clips:edit scope. Twitch's
        // error-body has `{ status, message }` with details but we don't
        // surface them — "reauth_required" is the actionable message.
        return { ok: false, reason: 'reauth_required', detail: 'missing scope (403)' };
      case 404:
        // 404 from /clips = broadcaster offline. Twitch's docs phrase
        // this as "no stream is currently airing" — same outcome.
        return { ok: false, reason: 'offline' };
      case 429:
        return { ok: false, reason: 'rate_limited' };
      default:
        return {
          ok: false,
          reason: 'unknown',
          detail: `Helix ${res.status}`,
        };
    }
  }

  // ─── Parse success response ───────────────────────────────
  // Shape per Twitch docs:
  //   { "data": [ { "id": "AbC...", "edit_url": "https://..." } ] }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      reason: 'unknown',
      detail: 'invalid JSON in clip response',
    };
  }
  const data = (body as { data?: Array<{ id?: string; edit_url?: string }> })
    ?.data?.[0];
  if (!data?.id || !data?.edit_url) {
    return {
      ok: false,
      reason: 'unknown',
      detail: 'missing id/edit_url in response',
    };
  }

  // ─── Persist row ───────────────────────────────────────────
  // We do this AFTER the Helix call succeeds so failed attempts don't
  // pollute the table. The UI's "recent auto-clips" section thus only
  // ever shows actually-created clips.
  try {
    await prisma.twitchClip.create({
      data: {
        userId: input.userId,
        twitchClipId: data.id,
        editUrl: data.edit_url,
        trigger: input.trigger,
        pirepId: input.pirepId ?? null,
        awardId: input.awardId ?? null,
      },
    });
  } catch (err) {
    // DB write failed — extremely unlikely (the clip already exists on
    // Twitch). Return success anyway because the streamer can still
    // find the clip in their Twitch dashboard; the local DB row would
    // just have been a convenience.
    console.warn('[twitch-clip] DB write failed:', err);
  }

  return { ok: true, clipId: data.id, editUrl: data.edit_url };
}
