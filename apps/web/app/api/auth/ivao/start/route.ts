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

  const authorizeUrl = process.env.IVAO_OAUTH_AUTHORIZE_URL;
  const clientId = process.env.IVAO_CLIENT_ID;
  const redirectUri = process.env.IVAO_REDIRECT_URI;
  const scopes = process.env.IVAO_OAUTH_SCOPES ?? 'openid profile email';

  if (!authorizeUrl || !clientId || !redirectUri) {
    return new Response('IVAO OAuth not configured', { status: 500 });
  }

  const state = generateState();
  const cookieStore = await cookies();
  cookieStore.set(`${STATE_COOKIE_PREFIX}ivao`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_COOKIE_MAX_AGE,
    path: '/',
  });

  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', state);

  redirect(url.toString());
}