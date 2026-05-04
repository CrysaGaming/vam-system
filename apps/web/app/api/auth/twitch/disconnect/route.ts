import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@vam/db';

/**
 * POST /api/auth/twitch/disconnect — Welle 11 commit 11B.
 *
 * Unlinks the pilot's Twitch-account from their VAM-account. Revokes
 * the access-token at twitch's revoke-endpoint (best-effort) so the
 * token can't be used even if it leaked elsewhere, then clears the
 * twitch-fields on the User row.
 *
 * Why revoke at twitch in addition to clearing locally:
 *   - Tokens we no longer use shouldn't continue counting against
 *     the pilot's twitch active-token limit.
 *   - If the access-token leaked via logs/env-snapshot, revoking
 *     ensures it can't be used to read the pilot's twitch data.
 *   - The DB-clear alone would let an attacker who got our DB-row
 *     keep using the token until natural expiry (4h).
 *
 * Why best-effort (don't fail if revoke errors): twitch's revoke-
 * endpoint can return 400 if the token is already invalid (e.g.,
 * naturally expired or revoked elsewhere). That's fine — the local
 * unlink should still succeed. We log and continue.
 *
 * 11D follow-up: when the bot starts EventSub-subscribing on behalf
 * of users, disconnecting must ALSO unsubscribe their event-set so
 * we don't keep getting (and silently dropping) events for an unlinked
 * pilot. That logic lives in the bot's eventsub-manager, not here —
 * this route just emits a `twitch.disconnected` internal event the
 * bot picks up. For 11B we skip that integration; bot-side handling
 * comes with 11D.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  // Pull the current token before we delete it — we need it to
  // call twitch's revoke-endpoint.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { twitchAccessToken: true },
  });

  // Best-effort revoke at twitch. The endpoint accepts a POST with
  // client_id + token in the form-body and returns 200 on success
  // or 400 if the token's already invalid. We don't await any
  // throwing path — local unlink should run regardless.
  if (user?.twitchAccessToken) {
    const baseUrl = process.env.TWITCH_OAUTH_BASE_URL ?? 'https://id.twitch.tv';
    const clientId = process.env.TWITCH_CLIENT_ID;
    if (clientId) {
      try {
        const res = await fetch(`${baseUrl}/oauth2/revoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            token: user.twitchAccessToken,
          }).toString(),
        });
        if (!res.ok) {
          // 400 here is normal for already-invalid tokens — log at
          // info-level, not error.
          console.info('[twitch-disconnect] revoke returned non-2xx (token may be stale):', res.status);
        }
      } catch (err) {
        console.warn('[twitch-disconnect] revoke request failed (proceeding with local unlink):', err);
      }
    }
  }

  // Clear all twitch-fields on the User row. Sets matching
  // 11A's schema additions, plus username and verifiedAt.
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      twitchUserId: null,
      twitchUsername: null,
      twitchVerifiedAt: null,
      twitchAccessToken: null,
      twitchRefreshToken: null,
      twitchTokenExpiresAt: null,
    },
  });

  redirect('/settings?status=disconnected&provider=twitch#connections');
}
