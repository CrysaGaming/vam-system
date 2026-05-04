import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma } from '@vam/db';
import { STATE_COOKIE_PREFIX } from '@/lib/oauth-state';
import type { NextRequest } from 'next/server';

/**
 * GET /api/auth/twitch/callback — Welle 11 commit 11B.
 *
 * OAuth callback after the pilot approved (or denied) the Twitch
 * authorize-page. Mirrors VATSIM/IVAO-callback pattern but with
 * twitch-specific quirks:
 *
 *   1. Verify pilot is still logged in (NextAuth-session)
 *   2. Verify CSRF-state cookie matches `state` param (one-time-use)
 *   3. POST code → Twitch /oauth2/token → access/refresh/expires_in
 *   4. GET Twitch /helix/users → user-id + display_name + email
 *   5. Collision-check: Twitch user-id already linked to another VAM-user?
 *   6. Update User-row with all twitch-fields
 *   7. Redirect to /settings#connections with success/error status
 *
 * Twitch-quirks worth knowing:
 *   - Token-endpoint: /oauth2/token (with "2"), not /oauth/token.
 *   - User-endpoint: api.twitch.tv/helix/users — separate API host
 *     from the auth-host (id.twitch.tv).
 *   - Helix requires BOTH headers: `Authorization: Bearer <token>`
 *     AND `Client-Id: <client_id>`. Without the Client-Id header
 *     you get a 401 even with a valid bearer token. VATSIM/IVAO
 *     don't have this requirement.
 *   - User-id is a string (numeric-looking but lexical) — keep it
 *     as `String` in our schema, don't parseInt.
 *   - Response shape is `{ data: [<user>] }` — array of one. Other
 *     APIs (vatsim) return single-object.
 *
 * Token-lifetime considerations:
 *   - User-access tokens live ~4h (much shorter than VATSIM ~1h or
 *     IVAO ~30d). Refresh-token strategy lives in lib/twitch-oauth.ts
 *     (not implemented in 11B — added when 11D bot needs it).
 *   - We store `expiresAt` as absolute datetime; refresh-flow checks
 *     `expiresAt < now() + 60s` to refresh proactively.
 *
 * Error-handling philosophy: redirect back to /settings with a
 * `reason=...` query-param the UI surfaces. Don't try to recover
 * automatically — the pilot can re-click "Connect Twitch" and start
 * over (a fresh state-cookie gets generated).
 */

type TwitchTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
  token_type: 'bearer';
};

type TwitchHelixUser = {
  id: string;
  login: string;
  display_name: string;
  type: string;
  broadcaster_type: string;
  description: string;
  profile_image_url: string;
  offline_image_url: string;
  view_count?: number;
  email?: string;
  created_at: string;
};

type TwitchHelixUsersResponse = {
  data: TwitchHelixUser[];
};

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // OAuth-provider error (user denied, scope rejected, etc.)
  if (error) {
    redirect(
      `/settings?status=error&provider=twitch&reason=${encodeURIComponent(error)}#connections`,
    );
  }

  if (!code || !state) {
    redirect('/settings?status=error&provider=twitch&reason=missing_params#connections');
  }

  // CSRF: state-cookie verification. The cookie is HTTP-only, so even
  // if the redirect URL is logged or shared, the cookie isn't.
  const cookieStore = await cookies();
  const storedState = cookieStore.get(`${STATE_COOKIE_PREFIX}twitch`)?.value;

  if (!storedState || storedState !== state) {
    redirect('/settings?status=error&provider=twitch&reason=state_mismatch#connections');
  }

  // One-time-use: clear the cookie immediately. If the pilot navigates
  // back and re-submits the callback URL, it'll fail state-check.
  cookieStore.delete(`${STATE_COOKIE_PREFIX}twitch`);

  const baseUrl = process.env.TWITCH_OAUTH_BASE_URL ?? 'https://id.twitch.tv';
  const apiBaseUrl = process.env.TWITCH_API_BASE_URL ?? 'https://api.twitch.tv';
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    redirect('/settings?status=error&provider=twitch&reason=server_misconfigured#connections');
  }

  // ─── 1. Token-Exchange ─────────────────────────────────────────
  let tokenData: TwitchTokenResponse;
  try {
    const tokenRes = await fetch(`${baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri!,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text().catch(() => '<unreadable>');
      console.error('[twitch-callback] token-exchange failed:', tokenRes.status, errorText);
      redirect('/settings?status=error&provider=twitch&reason=token_exchange_failed#connections');
    }

    tokenData = (await tokenRes.json()) as TwitchTokenResponse;
  } catch (err) {
    // Don't catch the redirect-throw — Next.js's redirect() throws
    // a `NEXT_REDIRECT` error that must propagate. Only log and
    // redirect for non-redirect errors.
    if (err && typeof err === 'object' && 'digest' in err && String(err.digest).startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    console.error('[twitch-callback] token-exchange error:', err);
    redirect('/settings?status=error&provider=twitch&reason=token_exchange_error#connections');
  }

  // ─── 2. User-Info via Helix ─────────────────────────────────────
  // Helix requires BOTH headers — Authorization with the bearer token
  // AND Client-Id. Without Client-Id you get 401 even with a valid
  // token. This is twitch-specific.
  let userInfo: TwitchHelixUsersResponse;
  try {
    const userRes = await fetch(`${apiBaseUrl}/helix/users`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId!,
        Accept: 'application/json',
      },
    });

    if (!userRes.ok) {
      const errorText = await userRes.text().catch(() => '<unreadable>');
      console.error('[twitch-callback] /helix/users failed:', userRes.status, errorText);
      redirect('/settings?status=error&provider=twitch&reason=userinfo_failed#connections');
    }

    userInfo = (await userRes.json()) as TwitchHelixUsersResponse;
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err && String(err.digest).startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    console.error('[twitch-callback] userinfo error:', err);
    redirect('/settings?status=error&provider=twitch&reason=userinfo_error#connections');
  }

  // Helix returns array; we expect exactly one entry (the authenticated
  // user). Empty array = the access-token doesn't grant /users access,
  // which would mean a misconfigured scope set.
  const twitchUser = userInfo.data[0];
  if (!twitchUser || !twitchUser.id) {
    redirect('/settings?status=error&provider=twitch&reason=userinfo_empty#connections');
  }

  // ─── 3. Collision-Check ─────────────────────────────────────────
  // Is this Twitch-user already linked to a different VAM-account?
  // The schema's @unique on twitchUserId would reject the write at
  // DB-level too, but a clean check + redirect gives a better UX
  // than a 500 from a constraint-violation.
  const existingLink = await prisma.user.findUnique({
    where: { twitchUserId: twitchUser.id },
    select: { id: true },
  });

  if (existingLink && existingLink.id !== session.user.id) {
    redirect('/settings?status=error&provider=twitch&reason=already_linked#connections');
  }

  // ─── 4. Persist ─────────────────────────────────────────────────
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      twitchUserId: twitchUser.id,
      twitchUsername: twitchUser.display_name,
      twitchVerifiedAt: new Date(),
      twitchAccessToken: tokenData.access_token,
      twitchRefreshToken: tokenData.refresh_token,
      twitchTokenExpiresAt: expiresAt,
    },
  });

  redirect('/settings?status=success&provider=twitch#connections');
}
