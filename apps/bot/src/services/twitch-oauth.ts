import { prisma } from '@vam/db';
import { env } from '../env.js';

/**
 * Welle 14E — Twitch OAuth token-refresh-flow.
 *
 * Twitch user-access-tokens leben nur ~4 Stunden (typisch
 * `expires_in: 14400` sekunden). Subscriptions persistieren über
 * token-refreshs hinweg WENN der neue token die selben scopes hat,
 * aber NEUE subscriptions / Helix-API-calls brauchen einen valid
 * access-token. Bot-prozesse die mehrere stunden laufen treffen das
 * unweigerlich.
 *
 * # Workflow
 *
 *   1. **ensureFreshToken(userId)** — checkt ob `twitchTokenExpiresAt`
 *      bald abläuft (< 60s puffer). Wenn ja: refresh. Returnt einen
 *      garantiert-valid access-token.
 *
 *   2. **refreshUserToken(userId, refreshToken)** — POST an twitch's
 *      `/oauth2/token` endpoint mit `grant_type=refresh_token`. Persistiert
 *      neue tokens (access, refresh, expires-at) zurück in DB.
 *
 * # Caller-Strategy
 *
 *   - `subscribeAllPilots()` in twitch-eventsub.ts: ruft `ensureFreshToken`
 *     vor dem subscribe-bootstrap, weil der bot bei einem reconnect nach
 *     stunden alte tokens hat die twitch nicht mehr akzeptiert.
 *   - `handleStreamOnline` in twitch-eventsub.ts: ruft `ensureFreshToken`
 *     vor dem Helix-context-fetch — wenn der bot lange läuft und ein
 *     pilot lange nicht aktiv war, ist der token stale.
 *   - `revocation`-handler: bei revoked subscription versucht refresh +
 *     re-subscribe. Wenn der refresh fehlschlägt (= user hat die app
 *     in twitch's settings entfernt), nullen wir die token-felder und
 *     der pilot wird beim nächsten subscribe-bootstrap übersprungen.
 *
 * # Refresh-Failure-Modes
 *
 *   - **400 "Invalid refresh token"**: pilot hat die app in twitch's
 *     account-settings entfernt → token-felder NULLEN, pilot ist
 *     "unlinked" bis er den OAuth-flow erneut durchläuft.
 *   - **401**: client_id/secret falsch konfiguriert → log fatal, return
 *     null (bot läuft weiter, alle refreshs schlagen fehl, ops müssen
 *     env reparieren).
 *   - **5xx / network**: twitch transient down → log warning, return
 *     null. Caller fällt auf "kein context"-pfad zurück; nächster
 *     event-cycle versucht's nochmal.
 */

/**
 * Twitch's /oauth2/token response-shape bei grant_type=refresh_token.
 *
 * Reference:
 *   https://dev.twitch.tv/docs/authentication/refresh-tokens/
 */
type TwitchRefreshResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
  token_type: 'bearer';
};

/**
 * Result-shape für den token-refresh. Bei erfolg gibt's den neuen
 * access-token zurück (caller kann ihn direkt für API-calls nutzen
 * ohne re-fetch from DB). Bei failure ist `accessToken` null und
 * `unlinked=true` signalisiert dass der refresh-token kaputt war —
 * der pilot muss durch OAuth-re-flow.
 */
export type RefreshResult =
  | {
      ok: true;
      accessToken: string;
      expiresAt: Date;
    }
  | {
      ok: false;
      unlinked: boolean; // true = refresh_token invalid, pilot disconnected; false = transient error
      reason: string;
    };

/**
 * Refreshed den access-token für einen pilot via twitch's oauth2/token
 * endpoint. Persistiert die neuen token-felder atomisch in der DB.
 *
 * Sicherheits-property: der refresh_token wird AUCH ersetzt. Twitch
 * rotated refresh-tokens bei jedem refresh — der alte ist invalid
 * sobald der neue zurückkommt. Wir müssen also IMMER beide zurück-
 * schreiben, nicht nur access_token.
 *
 * Token-rotation-race: wenn zwei concurrent calls für den selben user
 * gleichzeitig refreshen würden (z.B. subscribeAllPilots + ein
 * handleStreamOnline während-bootstrap), könnte einer den anderen
 * invalidieren. Mitigation: caller sollten ensureFreshToken() nutzen,
 * der hat ein in-memory-locking-pattern (TODO: 14E erste version macht
 * naive non-locked refreshs — race ist theoretisch aber in der praxis
 * harmlos weil bot-events sequentiell pro user ankommen).
 */
export async function refreshUserToken(
  userId: string,
  refreshToken: string,
): Promise<RefreshResult> {
  if (!env.twitch.clientId || !env.twitch.clientSecret) {
    return {
      ok: false,
      unlinked: false,
      reason: 'TWITCH_CLIENT_ID/SECRET not configured',
    };
  }

  // Twitch erwartet form-encoded body, NICHT json. Das ist OAuth2-spec-
  // konformes verhalten — Authorization-Server nehmen application/x-www-
  // form-urlencoded für token-endpoints. URLSearchParams baut den string
  // korrekt mit URL-encoding der values.
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: env.twitch.clientId,
    client_secret: env.twitch.clientSecret,
  });

  let res: Response;
  try {
    res = await fetch(`${env.twitch.oauthBaseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    console.warn(
      `[twitch-oauth] refresh network-error for userId=${userId}:`,
      err,
    );
    return {
      ok: false,
      unlinked: false,
      reason: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '<unreadable>');
    // 400 mit "Invalid refresh token" → user hat die app entfernt oder
    // der refresh-token wurde anderweitig invalidated. Nullen wir alle
    // token-felder so dass subscribeAllPilots den user übergeht. Der
    // pilot kriegt beim nächsten OAuth-flow neue tokens.
    if (res.status === 400) {
      console.warn(
        `[twitch-oauth] refresh_token invalid for userId=${userId} (status=400): ${errText} — clearing token fields`,
      );
      await prisma.user
        .update({
          where: { id: userId },
          data: {
            twitchAccessToken: null,
            twitchRefreshToken: null,
            twitchTokenExpiresAt: null,
          },
        })
        .catch((dbErr) => {
          console.error(
            `[twitch-oauth] failed to null token-fields for userId=${userId}:`,
            dbErr,
          );
        });
      return {
        ok: false,
        unlinked: true,
        reason: `refresh_token invalid (status=400): ${errText}`,
      };
    }

    // 401 = bot's client_id/secret stimmen nicht mit twitch's app-record.
    // Das ist ein ops-problem (env-vars falsch), nicht user-spezifisch.
    // Log loud, return ohne DB-mutation.
    if (res.status === 401) {
      console.error(
        `[twitch-oauth] FATAL: client credentials rejected (status=401): ${errText}. Check TWITCH_CLIENT_ID/SECRET env-vars.`,
      );
      return {
        ok: false,
        unlinked: false,
        reason: `client credentials rejected: ${errText}`,
      };
    }

    // 5xx oder andere — transient, kein DB-mutation, caller retry's
    // beim nächsten cycle.
    console.warn(
      `[twitch-oauth] refresh failed for userId=${userId} status=${res.status}: ${errText}`,
    );
    return {
      ok: false,
      unlinked: false,
      reason: `status=${res.status}: ${errText}`,
    };
  }

  const json = (await res.json()) as TwitchRefreshResponse;
  if (!json.access_token || !json.refresh_token || !json.expires_in) {
    console.warn(
      `[twitch-oauth] refresh returned incomplete payload for userId=${userId}:`,
      json,
    );
    return {
      ok: false,
      unlinked: false,
      reason: 'incomplete refresh response',
    };
  }

  // expires_in ist sekunden bis ablauf — auf einen absoluten Date
  // umrechnen für DB-persistence. Wir ziehen 30s puffer ab um
  // edge-cases beim grenznah-check zu vermeiden ("token expires in 1s,
  // grade noch valid → API-call → 401").
  const expiresAt = new Date(Date.now() + (json.expires_in - 30) * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      twitchAccessToken: json.access_token,
      twitchRefreshToken: json.refresh_token,
      twitchTokenExpiresAt: expiresAt,
    },
  });

  console.info(
    `[twitch-oauth] token refreshed for userId=${userId} (expires_in=${json.expires_in}s)`,
  );

  return {
    ok: true,
    accessToken: json.access_token,
    expiresAt,
  };
}

/**
 * Wie lange im voraus wir tokens "stale" nennen — wenn der token in
 * weniger als dieser zeit abläuft, refreshen wir präventiv. 60s puffer
 * ist großzügig genug um 2-3 retries für transient-failures zu erlauben
 * bevor der token tatsächlich abläuft.
 */
const TOKEN_FRESHNESS_BUFFER_MS = 60_000;

/**
 * Stellt sicher dass der user einen valid (nicht-bald-ablaufenden) access-
 * token hat. Refreshed präventiv wenn nötig.
 *
 * @returns valid access-token, oder null wenn der user keinen refresh-
 *   token hat oder der refresh fehlschlug.
 *
 * Caller-pattern:
 *   const token = await ensureFreshToken(userId);
 *   if (!token) return; // skip — pilot hat keine valid credentials
 *   const res = await fetch(..., { Authorization: `Bearer ${token}` });
 *
 * Optimierung: wenn der existing token noch frisch ist (> buffer-zeit
 * vor ablauf), kein refresh — wir geben ihn direkt zurück. Nur ein
 * read-query auf User. Das ist der hot-path für die meisten calls
 * (token wurde grade refreshed, valid für 4h).
 */
export async function ensureFreshToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      twitchAccessToken: true,
      twitchRefreshToken: true,
      twitchTokenExpiresAt: true,
    },
  });

  if (!user) {
    console.warn(
      `[twitch-oauth] ensureFreshToken: user ${userId} not found`,
    );
    return null;
  }

  if (!user.twitchAccessToken || !user.twitchRefreshToken) {
    // Pilot hat keine token-credentials (entweder nie verlinkt oder von
    // einem früheren refresh-fail genullt). Nichts zu refreshen.
    return null;
  }

  // Wenn expires-at fehlt (z.B. von einem older bootstrap-flow der das
  // feld nicht setzt), behandeln wir den token als stale — sicherer als
  // sorry. Der refresh überschreibt das feld dann korrekt.
  const expiresAt = user.twitchTokenExpiresAt;
  if (expiresAt && expiresAt.getTime() - Date.now() > TOKEN_FRESHNESS_BUFFER_MS) {
    // Token noch frisch genug — direkt zurückgeben, kein refresh nötig.
    return user.twitchAccessToken;
  }

  // Stale oder unbekannt → refresh.
  const result = await refreshUserToken(userId, user.twitchRefreshToken);
  if (!result.ok) {
    console.warn(
      `[twitch-oauth] ensureFreshToken: refresh failed for userId=${userId} unlinked=${result.unlinked} reason=${result.reason}`,
    );
    return null;
  }
  return result.accessToken;
}
