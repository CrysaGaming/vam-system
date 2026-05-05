import {
  prisma,
  markPilotLive,
  markPilotOffline,
  type LiveStreamContext,
} from '@vam/db';
import { env } from '../env.js';

/**
 * Twitch EventSub WebSocket bridge — Welle 11 commit 11D.
 *
 * Connects the bot to Twitch's real-time event-stream so we can react
 * to channel events (subs, cheers, gift-subs, hype-trains, channel-
 * point-redemptions, stream-online/offline) for every pilot who has
 * linked their Twitch-account. Foundation for the future Twitch-to-
 * Sim integration (Welle 14: channel-points → tickets) and for the
 * "Pilot just went live" discord-notifications.
 *
 * # Architecture
 *
 * Twitch's EventSub-WebSocket protocol works like this:
 *
 *   1. Connect to wss://eventsub.wss.twitch.tv/ws
 *   2. Receive a `session_welcome` message containing a session_id
 *   3. Within 10 seconds, POST subscriptions to /helix/eventsub/
 *      subscriptions with transport={method:'websocket', session_id:...}.
 *      Each subscription needs a user-access-token from the broadcaster
 *      whose events you want to receive.
 *   4. Twitch starts pushing `notification` messages over the WebSocket.
 *   5. Twitch sends `session_keepalive` every 10s — if you miss two,
 *      the connection's dead and you must reconnect.
 *   6. Twitch may send `session_reconnect` with a new URL — switch to
 *      the new URL within 30s, the old session continues until you do.
 *   7. If a token is revoked / scope removed, Twitch sends `revocation`
 *      and the subscription is gone.
 *
 * # Multi-User Strategy
 *
 * Each subscription is per-broadcaster-user, so for N pilots with
 * twitch-tokens we need ~5 subscriptions (events) × N pilots. Twitch
 * caps cost at 300 cost-units per session (~5 cost-units per non-
 * authorization-related subscription), so a single WS-session handles
 * roughly 60 pilots. For now (small VAM-airline scale) this is fine
 * with one shared session. If we scale past that, the right move is
 * to shard pilots across N WS-sessions (one process spawns N
 * connections, partitions pilots by hash). That's out-of-scope for
 * 11D — log a warning if cost-budget is exceeded and skip excess.
 *
 * # Token Refresh
 *
 * User-access-tokens live ~4h. Subscriptions persist across token-
 * refresh as long as the new token has the same scopes. We don't
 * actively refresh tokens in 11D — when a notification arrives for
 * an event that a now-revoked token would deny, twitch sends a
 * `revocation` message and we just log it. A real refresh-flow with
 * lib/twitch-oauth.ts is a Welle 14 prerequisite (when the bot does
 * write-actions on behalf of users).
 *
 * # 11D Scope: Test-Handler Only
 *
 * Per Welle-11 roadmap: notifications are logged to console + the
 * #bot-logs discord-channel for now. No game-impact, no DB-writes.
 * The point is to prove the WebSocket bridge works end-to-end so
 * Welle 14 (twitch-channel-points → tickets) can build on top.
 */

import type { Client, TextChannel } from 'discord.js';

// ─────────────────────────────────────────────────────────────────────
// Type definitions for Twitch EventSub WebSocket protocol
// ─────────────────────────────────────────────────────────────────────

type EventSubMessageType =
  | 'session_welcome'
  | 'session_keepalive'
  | 'session_reconnect'
  | 'notification'
  | 'revocation';

type EventSubMessage = {
  metadata: {
    message_id: string;
    message_type: EventSubMessageType;
    message_timestamp: string;
    subscription_type?: string;
    subscription_version?: string;
  };
  payload: Record<string, unknown> & {
    session?: {
      id: string;
      status: string;
      keepalive_timeout_seconds: number;
      reconnect_url: string | null;
      connected_at: string;
    };
    subscription?: {
      id: string;
      status: string;
      type: string;
      version: string;
      condition: Record<string, string>;
      transport: { method: string; session_id?: string };
      created_at: string;
      cost: number;
    };
    event?: Record<string, unknown>;
  };
};

// Subscription-types we register per pilot. Each entry maps to twitch's
// API names. The `condition` builder takes the broadcaster's user-id
// (the pilot's twitchUserId) and produces the condition-object twitch
// expects. Versioning matters — twitch evolves event-shapes and we
// pin to specific versions to avoid surprise schema-changes.
const SUBSCRIPTION_TEMPLATES: ReadonlyArray<{
  type: string;
  version: string;
  buildCondition: (broadcasterUserId: string) => Record<string, string>;
  description: string;
}> = [
  {
    type: 'stream.online',
    version: '1',
    buildCondition: (id) => ({ broadcaster_user_id: id }),
    description: 'Pilot started streaming on Twitch',
  },
  {
    type: 'stream.offline',
    version: '1',
    buildCondition: (id) => ({ broadcaster_user_id: id }),
    description: 'Pilot stopped streaming',
  },
  {
    type: 'channel.subscribe',
    version: '1',
    buildCondition: (id) => ({ broadcaster_user_id: id }),
    description: 'Someone subscribed to the pilot',
  },
  {
    type: 'channel.subscription.gift',
    version: '1',
    buildCondition: (id) => ({ broadcaster_user_id: id }),
    description: 'Someone gifted subs to the pilot',
  },
  {
    type: 'channel.cheer',
    version: '1',
    buildCondition: (id) => ({ broadcaster_user_id: id }),
    description: 'Someone cheered bits on the pilot',
  },
  {
    // Twitch deprecated hype_train v1 on 2026-01-22 (see
    // discuss.dev.twitch.com/t/legacy-get-hype-train-events-api-and-eventsub-hype-train-v1-subscription-types-deprecation-and-withdrawal-timeline).
    // v2 has the same scope-requirement (channel:read:hype_train) but
    // updated event-payload shape — `level` field still present, so
    // formatEventSummary doesn't need adjusting.
    type: 'channel.hype_train.begin',
    version: '2',
    buildCondition: (id) => ({ broadcaster_user_id: id }),
    description: 'Hype-train started on the pilot channel',
  },
  {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    buildCondition: (id) => ({ broadcaster_user_id: id }),
    description: 'Someone redeemed channel-points for a custom reward',
  },
];

// Per-session cost-budget cap (twitch's documented limit). We budget
// conservatively to leave headroom for re-subscriptions.
const SESSION_COST_BUDGET = 280;

// Twitch sends keepalive every ~10s; we time out after 30s of silence
// (3× the keepalive-cadence) — handles transient network blips.
const KEEPALIVE_TIMEOUT_MS = 30_000;

// After connection-close, wait this long before reconnecting. Avoids
// hammering twitch during outages. Backoff is intentionally constant
// — twitch's status-page is reliable enough that exponential isn't
// necessary, and a 5s loop is responsive enough that humans waiting
// for the next stream-online event don't notice the gap.
const RECONNECT_DELAY_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────
// Module-scoped state — single shared session per process
// ─────────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let sessionId: string | null = null;
let keepaliveTimer: NodeJS.Timeout | null = null;
let shouldReconnect = true;
let discordClient: Client | null = null;
let consumedCost = 0;

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Start the EventSub bridge. Idempotent — calling twice while connected
 * does nothing. Returns immediately; the connection happens async.
 *
 * Pre-conditions:
 *   - env.twitch.clientId must be set; otherwise we log and bail
 *   - At least one user with twitchAccessToken must exist (else we
 *     still connect but subscribe to nothing — saves us the trouble
 *     of restart-on-first-link, the next pilot's connect will resync
 *     via re-running this function — or via a bot-restart, which is
 *     the lazy-but-correct path for 11D)
 */
export function startTwitchEventSub(client: Client): void {
  if (!env.twitch.clientId) {
    console.warn('[twitch-eventsub] TWITCH_CLIENT_ID not set, EventSub disabled');
    return;
  }
  if (ws !== null) {
    console.info('[twitch-eventsub] already running, skipping start');
    return;
  }

  discordClient = client;
  shouldReconnect = true;
  connect(env.twitch.eventsubWsUrl);
}

/**
 * Stop the bridge. Safe to call when not running. Used in tests and
 * could be wired to bot-shutdown if we add graceful-shutdown later.
 */
export function stopTwitchEventSub(): void {
  shouldReconnect = false;
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  sessionId = null;
  consumedCost = 0;
}

// ─────────────────────────────────────────────────────────────────────
// Connection lifecycle
// ─────────────────────────────────────────────────────────────────────

function connect(url: string): void {
  console.info('[twitch-eventsub] connecting to', url);

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    console.info('[twitch-eventsub] websocket open, awaiting session_welcome');
    resetKeepaliveTimer();
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    resetKeepaliveTimer();

    try {
      const data =
        typeof event.data === 'string'
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : '';
      if (!data) return;

      const msg = JSON.parse(data) as EventSubMessage;
      handleMessage(msg);
    } catch (err) {
      console.error('[twitch-eventsub] failed to parse message:', err);
    }
  });

  // CloseEvent + Event sind im Node-22-WebSocket-runtime verfügbar, aber
  // nicht typisiert ohne lib:["DOM"] in tsconfig — und DOM-lib würde
  // den ganzen bot-bundle mit browser-globals (window, document, etc.)
  // verseuchen. Stattdessen duck-typen wir shape-minimal nur was wir
  // tatsächlich nutzen. close-event gibt uns code+reason für diagnostics,
  // error-event hat eh keine nützlichen properties.
  ws.addEventListener('close', (event) => {
    const closeEvent = event as unknown as { code: number; reason: string };
    console.warn(
      `[twitch-eventsub] websocket closed (code=${closeEvent.code}, reason="${closeEvent.reason}")`,
    );
    cleanupAndMaybeReconnect();
  });

  ws.addEventListener('error', (event) => {
    // Browser/Node WebSocket Error events don't carry useful detail
    // beyond "something went wrong"; the close event right after
    // gives the actual diagnosis.
    console.warn('[twitch-eventsub] websocket error event:', event);
  });
}

function cleanupAndMaybeReconnect(): void {
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }
  ws = null;
  sessionId = null;
  consumedCost = 0;

  if (shouldReconnect) {
    setTimeout(() => connect(env.twitch.eventsubWsUrl), RECONNECT_DELAY_MS);
  }
}

function resetKeepaliveTimer(): void {
  if (keepaliveTimer) clearTimeout(keepaliveTimer);
  keepaliveTimer = setTimeout(() => {
    console.warn('[twitch-eventsub] keepalive timeout, forcing reconnect');
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    cleanupAndMaybeReconnect();
  }, KEEPALIVE_TIMEOUT_MS);
}

// ─────────────────────────────────────────────────────────────────────
// Message dispatch
// ─────────────────────────────────────────────────────────────────────

function handleMessage(msg: EventSubMessage): void {
  switch (msg.metadata.message_type) {
    case 'session_welcome':
      void onSessionWelcome(msg);
      break;
    case 'session_keepalive':
      // No-op — the keepalive just resets the inactivity timer (already
      // done by the message-handler before dispatch).
      break;
    case 'session_reconnect':
      onSessionReconnect(msg);
      break;
    case 'notification':
      onNotification(msg);
      break;
    case 'revocation':
      onRevocation(msg);
      break;
    default:
      console.info(
        '[twitch-eventsub] unknown message_type:',
        msg.metadata.message_type,
      );
  }
}

async function onSessionWelcome(msg: EventSubMessage): Promise<void> {
  const session = msg.payload.session;
  if (!session) {
    console.error('[twitch-eventsub] session_welcome missing session payload');
    return;
  }

  sessionId = session.id;
  consumedCost = 0;
  console.info(
    `[twitch-eventsub] session_welcome session_id=${sessionId} keepalive=${session.keepalive_timeout_seconds}s`,
  );

  // Twitch gives us 10 seconds after welcome to subscribe before the
  // session is considered idle and closed. Do this immediately.
  await subscribeAllPilots();
}

function onSessionReconnect(msg: EventSubMessage): void {
  // Twitch instructs us to migrate to a new server. The new URL is in
  // payload.session.reconnect_url; we should connect there and the old
  // session will close after we do.
  const newUrl = msg.payload.session?.reconnect_url;
  if (!newUrl) {
    console.warn('[twitch-eventsub] session_reconnect without reconnect_url, scheduling normal reconnect');
    return;
  }
  console.info('[twitch-eventsub] session_reconnect → migrating to', newUrl);

  // Don't trigger the regular reconnect-loop here — we go straight to
  // the new URL. The old WS will close after we connect to the new
  // one (twitch handles the cutover); we mark shouldReconnect=true so
  // any subsequent failures still trigger reconnect-via-close-handler.
  if (ws) {
    // The close-handler will fire once the old socket closes; suppress
    // its reconnect since we're already starting a fresh connection.
    shouldReconnect = false;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  shouldReconnect = true;
  connect(newUrl);
}

function onNotification(msg: EventSubMessage): void {
  const subType = msg.metadata.subscription_type ?? 'unknown';
  const event = msg.payload.event ?? {};
  const subscription = msg.payload.subscription;

  // Compact log line — the full event-payload can be quite verbose;
  // we log the essentials inline and stash the rest behind a JSON-
  // dump line for grep-friendliness.
  const broadcasterUserName =
    (event.broadcaster_user_name as string | undefined) ??
    (event.broadcaster_user_login as string | undefined) ??
    '<unknown>';
  console.info(
    `[twitch-eventsub] notification type=${subType} broadcaster=${broadcasterUserName}`,
  );
  console.info(`[twitch-eventsub]   event=${JSON.stringify(event)}`);

  // Welle 14B: DB-writes für stream.online/offline. Fire-and-forget —
  // failures werden in den handlern selbst geloggt, der notification-
  // dispatch soll nicht blockiert werden. Ordering:
  //   1. DB-write (markPilotLive/Offline) — quick + idempotent
  //   2. Discord-mirror (postToBotLogs) — current behavior, läuft
  //      immer mit. 14D wird das routing für stream.online auf einen
  //      dedicated #livestreams channel umstellen.
  if (subType === 'stream.online') {
    void handleStreamOnline(event);
  } else if (subType === 'stream.offline') {
    void handleStreamOffline(event);
  }

  // Mirror to discord #bot-logs for visibility during 11D testing.
  // 14+ will route specific event-types to specific channels (livestreams,
  // pireps, etc.); for now everything goes to bot-logs.
  void postToBotLogs(subType, broadcasterUserName, event, subscription?.type);
}

function onRevocation(msg: EventSubMessage): void {
  const sub = msg.payload.subscription;
  console.warn(
    `[twitch-eventsub] subscription revoked: type=${sub?.type} status=${sub?.status} broadcaster_user_id=${sub?.condition?.broadcaster_user_id}`,
  );
  // Future (Welle 14): trigger token-refresh + re-subscribe attempt
  // for this pilot. For 11D we just log — the next bot-restart will
  // attempt a fresh subscribe and will fail with the same revoked
  // token, surfacing the issue.
}

// ─────────────────────────────────────────────────────────────────────
// Welle 14B: stream.online / stream.offline DB-handlers
// ─────────────────────────────────────────────────────────────────────

/**
 * Welle 14B: handler für stream.online events. Fetcht zusätzlichen
 * stream-context (title, game, thumbnail) via Helix /streams API
 * weil das event-payload selbst nur user-IDs enthält, dann updated
 * den User-record via markPilotLive helper.
 *
 * Idempotenz: markPilotLive returnt wasAlreadyLive=true wenn der user
 * schon live markiert war. In dem fall skippen wir den (zukünftigen,
 * 14D) discord-livestreams-embed um spam bei twitch-WS-reconnects zu
 * vermeiden. 14B selbst postet noch keinen embed (das kommt 14D), wir
 * loggen nur den dedup-fall.
 *
 * Helix-fetch ist best-effort: bei fehlern (token expired, twitch-API
 * down) loggen wir und markieren den pilot trotzdem als live mit nur
 * den event-payload-feldern (broadcaster_user_id/name). Default-werte
 * (title=null, game=null, thumbnail=null) werden vom helper akzeptiert.
 */
async function handleStreamOnline(
  event: Record<string, unknown>,
): Promise<void> {
  const broadcasterUserId = event.broadcaster_user_id as string | undefined;
  if (!broadcasterUserId) {
    console.warn(
      '[twitch-eventsub] stream.online event without broadcaster_user_id, skipping DB-write',
    );
    return;
  }

  // VAM-User lookup via twitchUserId — der string-match auf das event-
  // feld. Wir brauchen den User auch für den access-token (für den
  // Helix-context-fetch).
  const user = await prisma.user.findUnique({
    where: { twitchUserId: broadcasterUserId },
    select: {
      id: true,
      twitchUsername: true,
      twitchAccessToken: true,
    },
  });

  if (!user) {
    // Kein VAM-user mit diesem twitch-userId. Sollte praktisch nicht
    // passieren weil wir nur subscriptions für linked-pilots anlegen,
    // aber wenn ein user disconnected nach subscribe (race), kann der
    // event noch ankommen. Just-log und skip.
    console.warn(
      `[twitch-eventsub] stream.online for twitchUserId=${broadcasterUserId} hat keinen matching VAM-user (disconnected mid-flight?)`,
    );
    return;
  }

  // Helix-fetch best-effort. Token ist required für den Helix-call —
  // ohne fallen wir auf "nur status" zurück (kein title/game/thumbnail).
  let context: LiveStreamContext = {
    title: null,
    gameName: null,
    thumbnailUrl: null,
  };

  if (user.twitchAccessToken && env.twitch.clientId) {
    const fetched = await fetchStreamHelixContext(
      broadcasterUserId,
      user.twitchAccessToken,
    );
    if (fetched) {
      context = fetched;
    }
  }

  try {
    const result = await markPilotLive(user.id, context);
    if (result.wasAlreadyLive) {
      console.info(
        `[twitch-eventsub] stream.online dedup: pilot=${user.twitchUsername ?? user.id} war schon live (twitch retry/duplicate event)`,
      );
    } else {
      console.info(
        `[twitch-eventsub] markPilotLive: pilot=${user.twitchUsername ?? user.id} title="${context.title ?? '(none)'}" game="${context.gameName ?? '(none)'}"`,
      );
    }
  } catch (err) {
    console.error(
      `[twitch-eventsub] markPilotLive failed for pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}

/**
 * Welle 14B: handler für stream.offline events. Cleared den live-status
 * via markPilotOffline. Kein Helix-fetch nötig — offline ist self-
 * contained.
 *
 * Idempotenz: wasAlreadyOffline=true → skip log-noise (twitch retry).
 */
async function handleStreamOffline(
  event: Record<string, unknown>,
): Promise<void> {
  const broadcasterUserId = event.broadcaster_user_id as string | undefined;
  if (!broadcasterUserId) {
    console.warn(
      '[twitch-eventsub] stream.offline event without broadcaster_user_id, skipping DB-write',
    );
    return;
  }

  const user = await prisma.user.findUnique({
    where: { twitchUserId: broadcasterUserId },
    select: { id: true, twitchUsername: true },
  });

  if (!user) {
    console.warn(
      `[twitch-eventsub] stream.offline for twitchUserId=${broadcasterUserId} hat keinen matching VAM-user`,
    );
    return;
  }

  try {
    const result = await markPilotOffline(user.id);
    if (result.wasAlreadyOffline) {
      console.info(
        `[twitch-eventsub] stream.offline dedup: pilot=${user.twitchUsername ?? user.id} war schon offline (twitch retry/duplicate event)`,
      );
    } else {
      console.info(
        `[twitch-eventsub] markPilotOffline: pilot=${user.twitchUsername ?? user.id}`,
      );
    }
  } catch (err) {
    console.error(
      `[twitch-eventsub] markPilotOffline failed for pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}

/**
 * Helix /streams?user_id=X fetcher für stream-metadata beim go-live.
 *
 * Twitch-API endpoint dokumentation:
 *   https://dev.twitch.tv/docs/api/reference/#get-streams
 *
 * Response-shape:
 *   {
 *     data: [{
 *       id, user_id, user_login, user_name, game_id, game_name,
 *       type: "live", title, viewer_count, started_at, language,
 *       thumbnail_url, tag_ids, tags, is_mature
 *     }]
 *   }
 *
 * Wenn data leer ist (z.B. zwischen stream.online-event und tatsächlicher
 * stream-aktivierung), returnen wir null. Caller fällt auf empty-context
 * zurück. Stream-status wird trotzdem korrekt auf live gesetzt — wir
 * verlieren nur die metadata.
 *
 * Auth: nutzt user-access-token (channel:* scopes via OAuth-flow). Auch
 * möglich wäre app-access-token für public /streams data, aber wir
 * haben keinen app-token-flow im bot — der user-token ist eh schon da
 * vom subscribe-bootstrap.
 */
async function fetchStreamHelixContext(
  twitchUserId: string,
  accessToken: string,
): Promise<LiveStreamContext | null> {
  if (!env.twitch.clientId) return null;

  try {
    const res = await fetch(
      `${env.twitch.apiBaseUrl}/helix/streams?user_id=${encodeURIComponent(twitchUserId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': env.twitch.clientId,
        },
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable>');
      console.warn(
        `[twitch-eventsub] helix /streams failed user_id=${twitchUserId} status=${res.status}: ${errText}`,
      );
      return null;
    }

    const json = (await res.json()) as {
      data?: Array<{
        title?: string;
        game_name?: string;
        thumbnail_url?: string;
      }>;
    };
    const stream = json.data?.[0];
    if (!stream) {
      // Kein stream-record — kann passieren wenn das event kam aber
      // twitch's /streams API noch nicht synchron ist. Caller fällt
      // auf empty-context zurück.
      return null;
    }

    return {
      title: stream.title ?? null,
      gameName: stream.game_name ?? null,
      thumbnailUrl: stream.thumbnail_url ?? null,
    };
  } catch (err) {
    console.warn(
      `[twitch-eventsub] helix /streams error user_id=${twitchUserId}:`,
      err,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Subscription bootstrap
// ─────────────────────────────────────────────────────────────────────

async function subscribeAllPilots(): Promise<void> {
  if (!sessionId || !env.twitch.clientId) return;

  // Pull all linked pilots. We need: twitchUserId (broadcaster-id for
  // condition) + twitchAccessToken (auth for the subscribe-API call).
  const pilots = await prisma.user.findMany({
    where: {
      twitchUserId: { not: null },
      twitchAccessToken: { not: null },
    },
    select: {
      id: true,
      twitchUserId: true,
      twitchAccessToken: true,
      twitchUsername: true,
    },
  });

  console.info(`[twitch-eventsub] subscribing for ${pilots.length} pilot(s)`);

  let totalSubs = 0;
  let totalSkipped = 0;

  for (const pilot of pilots) {
    if (consumedCost >= SESSION_COST_BUDGET) {
      console.warn(
        `[twitch-eventsub] cost-budget ${SESSION_COST_BUDGET} reached, skipping remaining pilots (sharded sessions are a future-welle TODO)`,
      );
      break;
    }
    if (!pilot.twitchUserId || !pilot.twitchAccessToken) continue;

    for (const tmpl of SUBSCRIPTION_TEMPLATES) {
      const ok = await createSubscription(
        tmpl.type,
        tmpl.version,
        tmpl.buildCondition(pilot.twitchUserId),
        pilot.twitchAccessToken,
        pilot.twitchUsername ?? pilot.id,
      );
      if (ok) {
        totalSubs += 1;
        consumedCost += 1; // cost is 1 for these subscription-types
      } else {
        totalSkipped += 1;
      }
    }
  }

  console.info(
    `[twitch-eventsub] bootstrap complete: ${totalSubs} subscriptions created, ${totalSkipped} skipped, cost-used=${consumedCost}/${SESSION_COST_BUDGET}`,
  );
}

async function createSubscription(
  type: string,
  version: string,
  condition: Record<string, string>,
  accessToken: string,
  pilotLabel: string,
): Promise<boolean> {
  if (!sessionId || !env.twitch.clientId) return false;

  try {
    const res = await fetch(
      `${env.twitch.apiBaseUrl}/helix/eventsub/subscriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': env.twitch.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          version,
          condition,
          transport: { method: 'websocket', session_id: sessionId },
        }),
      },
    );

    if (res.ok) {
      return true;
    }

    // 401 = token expired/revoked; 403 = scope missing for this event.
    // 409 = subscription already exists (twitch dedupes by type+condition+
    // session_id) — counts as success because the subscription IS active.
    if (res.status === 409) {
      return true;
    }

    const errText = await res.text().catch(() => '<unreadable>');
    console.warn(
      `[twitch-eventsub] subscribe failed pilot=${pilotLabel} type=${type} status=${res.status}: ${errText}`,
    );
    return false;
  } catch (err) {
    console.warn(
      `[twitch-eventsub] subscribe error pilot=${pilotLabel} type=${type}:`,
      err,
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Discord-side surface (test-handler only for 11D)
// ─────────────────────────────────────────────────────────────────────

async function postToBotLogs(
  subType: string,
  broadcaster: string,
  event: Record<string, unknown>,
  fullSubType: string | undefined,
): Promise<void> {
  if (!discordClient) return;
  try {
    const channel = await discordClient.channels.fetch(env.channels.botLogs);
    if (!channel || !channel.isTextBased()) return;

    // Render a one-line summary based on event-type. Falls back to a
    // generic JSON-dump if we don't have a specialized formatter yet.
    const summary = formatEventSummary(subType, broadcaster, event);

    await (channel as TextChannel).send({
      embeds: [
        {
          color: 0x9146ff, // Twitch purple
          title: `📺 Twitch Event — ${fullSubType ?? subType}`,
          description: summary,
          timestamp: new Date().toISOString(),
          footer: { text: 'Welle 11D test-handler — log only, no game-impact' },
        },
      ],
    });
  } catch (err) {
    console.warn('[twitch-eventsub] failed to post to bot-logs:', err);
  }
}

function formatEventSummary(
  subType: string,
  broadcaster: string,
  event: Record<string, unknown>,
): string {
  const userName = (event.user_name ?? event.user_login ?? '<anon>') as string;

  switch (subType) {
    case 'stream.online':
      return `**${broadcaster}** ist live gegangen (type: ${event.type ?? 'live'})`;
    case 'stream.offline':
      return `**${broadcaster}** hat den stream beendet`;
    case 'channel.subscribe':
      return `${userName} hat **${broadcaster}** subscribed (tier ${event.tier ?? '?'})`;
    case 'channel.subscription.gift':
      return `${userName} hat ${event.total ?? '?'} sub(s) bei **${broadcaster}** gegiftet`;
    case 'channel.cheer':
      return `${userName} hat ${event.bits ?? '?'} bits bei **${broadcaster}** gecheert`;
    case 'channel.hype_train.begin':
      return `Hype-train bei **${broadcaster}** gestartet (level ${event.level ?? 1})`;
    case 'channel.channel_points_custom_reward_redemption.add':
      return `${userName} hat "${(event.reward as { title?: string } | undefined)?.title ?? '<reward>'}" eingelöst bei **${broadcaster}**`;
    default:
      return `\`\`\`json\n${JSON.stringify(event, null, 2).slice(0, 1500)}\n\`\`\``;
  }
}
