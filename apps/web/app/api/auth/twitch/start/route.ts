import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  generateState,
  STATE_COOKIE_PREFIX,
  STATE_COOKIE_MAX_AGE,
} from '@/lib/oauth-state';

/**
 * GET /api/auth/twitch/start — Welle 11 commit 11B.
 *
 * Initiates the Twitch-OAuth Authorization-Code-flow for the currently
 * logged-in pilot. Mirrors VATSIM/IVAO start-flow:
 *   1. Verify NextAuth-session (must be logged in to link an account).
 *   2. Generate CSRF-state, store in HTTP-only cookie, send same value
 *      to Twitch as `state` param. Callback verifies cookie==response.
 *   3. Build authorize-URL with client_id, redirect_uri, scopes, state.
 *   4. 302 redirect to Twitch's authorize-page.
 *
 * Twitch-OAuth-endpoint differs from VATSIM/IVAO:
 *   - Path is /oauth2/authorize (not /oauth/authorize) — note the "2".
 *   - `force_verify=true` optional param (we don't use it; lets users
 *     re-confirm scopes on re-link, but can be added later if pilots
 *     get confused).
 *
 * Env-vars (read at request-time, not module-init, so server can be
 * configured without a restart):
 *   TWITCH_OAUTH_BASE_URL — defaults to https://id.twitch.tv if unset
 *   TWITCH_CLIENT_ID
 *   TWITCH_REDIRECT_URI
 *   TWITCH_OAUTH_SCOPES — space-separated. See env-doc for default-set.
 *
 * If any required var is missing, return 500 with a clear message —
 * easier to diagnose than a silent redirect to a broken twitch URL.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const baseUrl = process.env.TWITCH_OAUTH_BASE_URL ?? 'https://id.twitch.tv';
  const clientId = process.env.TWITCH_CLIENT_ID;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;
  const scopes =
    process.env.TWITCH_OAUTH_SCOPES ??
    // Welle O / O5 — added `clips:edit` so /lib/twitch/clips.ts can
    // create clips via Helix POST /clips on milestone events. Existing
    // tokens without this scope continue to work for everything else;
    // the clip-helper detects the missing-scope 403 and degrades to
    // "re-auth required" instead of throwing.
    'user:read:email channel:read:subscriptions bits:read channel:read:redemptions channel:read:hype_train clips:edit';

  if (!clientId || !redirectUri) {
    return new Response('Twitch OAuth not configured', { status: 500 });
  }

  // CSRF-state. 32-byte hex (256-bit entropy) — same approach as
  // VATSIM/IVAO. Stored as HTTP-only cookie that the callback reads
  // and compares to the `state` param Twitch echoes back.
  const state = generateState();
  const cookieStore = await cookies();
  cookieStore.set(`${STATE_COOKIE_PREFIX}twitch`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE,
    path: '/',
  });

  const authUrl = new URL(`${baseUrl}/oauth2/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  redirect(authUrl.toString());
}
