import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma } from '@vam/db';
import { STATE_COOKIE_PREFIX } from '@/lib/oauth-state';
import type { NextRequest } from 'next/server';

type IvaoTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
};

type IvaoUserResponse = {
  id: number;
  publicId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  rating?: number;
  divisionId?: string;
  countryId?: string;
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

  if (error) {
    redirect(`/settings?status=error&provider=ivao&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    redirect('/settings?status=error&provider=ivao&reason=missing_params');
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get(`${STATE_COOKIE_PREFIX}ivao`)?.value;

  if (!storedState || storedState !== state) {
    redirect('/settings?status=error&provider=ivao&reason=state_mismatch');
  }

  cookieStore.delete(`${STATE_COOKIE_PREFIX}ivao`);

  const tokenUrl = process.env.IVAO_OAUTH_TOKEN_URL!;
  const userInfoUrl = process.env.IVAO_OAUTH_USERINFO_URL!;
  const clientId = process.env.IVAO_CLIENT_ID!;
  const clientSecret = process.env.IVAO_CLIENT_SECRET!;
  const redirectUri = process.env.IVAO_REDIRECT_URI!;

  // 1. Token-Exchange
  let tokenData: IvaoTokenResponse;
  try {
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error('[IVAO] Token exchange failed:', errorText);
      redirect('/settings?status=error&provider=ivao&reason=token_exchange_failed');
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('[IVAO] Token exchange error:', err);
    redirect('/settings?status=error&provider=ivao&reason=token_exchange_error');
  }

  // 2. User-Info abrufen
  let userInfo: IvaoUserResponse;
  try {
    const userRes = await fetch(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!userRes.ok) {
      const errorText = await userRes.text();
      console.error('[IVAO] User info failed:', errorText);
      redirect('/settings?status=error&provider=ivao&reason=userinfo_failed');
    }

    userInfo = await userRes.json();
  } catch (err) {
    console.error('[IVAO] User info error:', err);
    redirect('/settings?status=error&provider=ivao&reason=userinfo_error');
  }

  // 3. VID parsen
  const vid = userInfo.id;
  if (!vid || typeof vid !== 'number') {
    console.error('[IVAO] Invalid VID:', userInfo);
    redirect('/settings?status=error&provider=ivao&reason=invalid_vid');
  }

  // 4. Check: VID schon einem ANDEREN User zugeordnet?
  const existingLink = await prisma.user.findUnique({
    where: { ivaoVid: vid },
    select: { id: true },
  });

  if (existingLink && existingLink.id !== session.user.id) {
    redirect('/settings?status=error&provider=ivao&reason=vid_already_linked');
  }

  // 5. Token-Expiry
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  // 6. User updaten
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ivaoVid: vid,
      ivaoVerifiedAt: new Date(),
      ivaoAccessToken: tokenData.access_token,
      ivaoRefreshToken: tokenData.refresh_token ?? null,
      ivaoTokenExpiresAt: expiresAt,
    },
  });

  redirect('/settings?status=success&provider=ivao');
}