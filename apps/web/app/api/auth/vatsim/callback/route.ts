import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma } from '@vam/db';
import { STATE_COOKIE_PREFIX } from '@/lib/oauth-state';
import type { NextRequest } from 'next/server';

type VatsimUserResponse = {
  data: {
    cid: string;
    personal: {
      name_first: string;
      name_last: string;
      name_full: string;
      email: string;
    };
    vatsim: {
      rating: { id: number; short: string; long: string };
      pilotrating: { id: number; short: string; long: string };
      division: { id: string | null; name: string | null };
    };
  };
};

type VatsimTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
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

  // Error vom OAuth-Provider
  if (error) {
    redirect(`/settings?status=error&provider=vatsim&reason=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    redirect('/settings?status=error&provider=vatsim&reason=missing_params');
  }

  // CSRF: State aus Cookie verifizieren
  const cookieStore = await cookies();
  const storedState = cookieStore.get(`${STATE_COOKIE_PREFIX}vatsim`)?.value;

  if (!storedState || storedState !== state) {
    redirect('/settings?status=error&provider=vatsim&reason=state_mismatch');
  }

  // State-Cookie löschen (one-time-use)
  cookieStore.delete(`${STATE_COOKIE_PREFIX}vatsim`);

  const baseUrl = process.env.VATSIM_OAUTH_BASE_URL!;
  const clientId = process.env.VATSIM_CLIENT_ID!;
  const clientSecret = process.env.VATSIM_CLIENT_SECRET!;
  const redirectUri = process.env.VATSIM_REDIRECT_URI!;

  // 1. Code gegen Token tauschen
  let tokenData: VatsimTokenResponse;
  try {
    console.log('[VATSIM] Token-Exchange starting');
    console.log('[VATSIM] baseUrl:', baseUrl);
    console.log('[VATSIM] clientId:', clientId);
    console.log('[VATSIM] clientSecret length:', clientSecret?.length, 'first 4:', clientSecret?.substring(0, 4));
    console.log('[VATSIM] redirectUri:', redirectUri);
    console.log('[VATSIM] code length:', code.length);

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
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

    console.log('[VATSIM] Token response status:', tokenRes.status);

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error('[VATSIM] Token exchange failed:', errorText);
      redirect('/settings?status=error&provider=vatsim&reason=token_exchange_failed');
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('VATSIM token exchange error:', err);
    redirect('/settings?status=error&provider=vatsim&reason=token_exchange_error');
  }

  // 2. User-Info abrufen
  let userInfo: VatsimUserResponse;
  try {
    const userRes = await fetch(`${baseUrl}/api/user`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json',
      },
    });

    if (!userRes.ok) {
      console.error('VATSIM user info failed:', await userRes.text());
      redirect('/settings?status=error&provider=vatsim&reason=userinfo_failed');
    }

    userInfo = await userRes.json();
  } catch (err) {
    console.error('VATSIM user info error:', err);
    redirect('/settings?status=error&provider=vatsim&reason=userinfo_error');
  }

  // 3. CID parsen
  const cid = parseInt(userInfo.data.cid, 10);
  if (isNaN(cid)) {
    redirect('/settings?status=error&provider=vatsim&reason=invalid_cid');
  }

  // 4. Check: ist diese CID bereits einem ANDEREN User zugeordnet?
  const existingLink = await prisma.user.findUnique({
    where: { vatsimCid: cid },
    select: { id: true },
  });

  if (existingLink && existingLink.id !== session.user.id) {
    redirect('/settings?status=error&provider=vatsim&reason=cid_already_linked');
  }

  // 5. Token-Expiry berechnen
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  // 6. User updaten
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      vatsimCid: cid,
      vatsimVerifiedAt: new Date(),
      vatsimAccessToken: tokenData.access_token,
      vatsimRefreshToken: tokenData.refresh_token ?? null,
      vatsimTokenExpiresAt: expiresAt,
    },
  });

  redirect('/settings?status=success&provider=vatsim');
}