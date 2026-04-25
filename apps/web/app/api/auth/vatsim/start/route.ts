import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  generateState,
  STATE_COOKIE_PREFIX,
  STATE_COOKIE_MAX_AGE,
} from '@/lib/oauth-state';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const baseUrl = process.env.VATSIM_OAUTH_BASE_URL;
  const clientId = process.env.VATSIM_CLIENT_ID;
  const redirectUri = process.env.VATSIM_REDIRECT_URI;
  const scopes = process.env.VATSIM_OAUTH_SCOPES ?? 'full_name email vatsim_details country';

  if (!baseUrl || !clientId || !redirectUri) {
    return new Response('VATSIM OAuth not configured', { status: 500 });
  }

  // CSRF-State generieren und in Cookie speichern
  const state = generateState();
  const cookieStore = await cookies();
  cookieStore.set(`${STATE_COOKIE_PREFIX}vatsim`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE,
    path: '/',
  });

  const authUrl = new URL(`${baseUrl}/oauth/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  redirect(authUrl.toString());
}