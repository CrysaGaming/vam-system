import {
  prisma,
  markPilotLive,
  markPilotOffline,
  substituteThumbnailDimensions,
  awardStreamReward,
  type LiveStreamContext,
  type StreamRewardEvent,
  type StreamRewardResult,
} from '@vam/db';
import { env } from '../env.js';
import { ensureFreshToken, refreshUserToken } from './twitch-oauth.js';

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
 * User-access-tokens leben ~4h. Subscriptions persistieren über token-
 * refresh hinweg solange der neue token die selben scopes hat. Welle 14E
 * implementiert den proaktiven refresh-flow:
 *
 *   - subscribeAllPilots() ruft ensureFreshToken() vor jedem subscribe-
 *     bootstrap. Bot-prozesse die mehrere stunden alte tokens haben
 *     kriegen automatisch refreshs.
 *   - handleStreamOnline() ruft ensureFreshToken() vor dem Helix-fetch
 *     für stream-context.
 *   - onRevocation() versucht refresh + re-subscribe wenn twitch eine
 *     subscription revoked (typisch: token-rotation, scope-removal).
 *
 * Refresh-flow ist in services/twitch-oauth.ts gekapselt. Bei
 * dauerhafter refresh-failure (pilot hat app deauthorisiert) werden
 * die token-felder genullt und der pilot wird beim nächsten bootstrap
 * übersprungen.
 *
 * # 11D Scope: Test-Handler Only
 *
 * Per Welle-11 roadmap: notifications werden initial geloggt + zum
 * #bot-logs discord-channel mirrored. Welle 14B-D haben das routing
 * für stream.online/offline event-types umgestellt — DB-writes,
 * dedicated #livestreams embeds. Andere events (subs, cheers, gifts)
 * bleiben weiterhin log-only bis sie ihre eigene welle kriegen.
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
  // dispatch soll nicht blockiert werden.
  // Welle 14D: routing umgestellt — stream.online geht NICHT mehr nach
  // #bot-logs, sondern (innerhalb des handlers, nach successful first-
  // time-mark) zu #livestreams als rich embed. stream.offline bleibt
  // console-only — kein discord-noise wenn pilot offline geht (das ist
  // kein "newsworthy" event und würde den channel mit gegen-posts
  // überfluten).
  // Welle 14F: subs/cheers/gifts → wallet-rewards für streamer-pilots.
  // Routing: handler selbst macht den DB-write (awardStreamReward) PLUS
  // einen reward-embed nach #livestreams (visibility für die community).
  // Skip postToBotLogs damit kein doppelter post.
  // Welle 14G: hype-train-begin → community-recognition + bonus-reward.
  // Selbe routing wie 14F (handler macht alles).
  // Channel-points (10.2.4 future) bleiben weiter log-only in #bot-logs
  // bis Track 4 ACARS-write-side bereitsteht.
  if (subType === 'stream.online') {
    void handleStreamOnline(event);
    return; // Skip postToBotLogs — handler routes selbst nach #livestreams
  }
  if (subType === 'stream.offline') {
    void handleStreamOffline(event);
    return; // Skip postToBotLogs — offline ist console-only
  }
  if (subType === 'channel.subscribe') {
    void handleChannelSubscribe(event);
    return; // Skip postToBotLogs — handler routes selbst nach #livestreams
  }
  if (subType === 'channel.cheer') {
    void handleChannelCheer(event);
    return;
  }
  if (subType === 'channel.subscription.gift') {
    void handleChannelGift(event);
    return;
  }
  if (subType === 'channel.hype_train.begin') {
    void handleHypeTrainBegin(event);
    return;
  }

  // Mirror to discord #bot-logs für die übrigen event-types (channel-
  // points-redemptions). Diese sind weiterhin "log-only" in der
  // ursprünglichen 11D-art bis ihre jeweilige welle (10.2.4) sie
  // verarbeitet.
  void postToBotLogs(subType, broadcasterUserName, event, subscription?.type);
}

function onRevocation(msg: EventSubMessage): void {
  const sub = msg.payload.subscription;
  console.warn(
    `[twitch-eventsub] subscription revoked: type=${sub?.type} status=${sub?.status} broadcaster_user_id=${sub?.condition?.broadcaster_user_id}`,
  );
  // Welle 14E: token-refresh + re-subscribe attempt. Twitch revoked
  // subscriptions wenn ein token ungültig wurde (typisch: scope-removal,
  // user hat die app deautorisiert, oder token-rotation hat den alten
  // verworfen). Wir versuchen einen refresh + re-create der subscription
  // — wenn der refresh fehlschlägt (= pilot hat die app komplett
  // entfernt), nullt refreshUserToken die token-felder und der pilot
  // wird beim nächsten subscribeAllPilots übersprungen.
  void handleRevocation(sub);
}

/**
 * Welle 14E: revocation-recovery flow.
 *
 * Wenn twitch eine subscription revoked, ist der ursprüngliche
 * token-state inkonsistent geworden (status=user_removed/authorization_
 * revoked typisch). Wir versuchen die situation zu retten:
 *
 *   1. Lookup VAM-user via broadcaster_user_id im subscription condition
 *   2. Refresh den token (force, nicht via ensureFreshToken — der prüft
 *      expires_at, aber bei revocation kann der token zwar "frisch" laut
 *      timestamp aber trotzdem invalid sein)
 *   3. Wenn refresh erfolgreich: re-create die EINE betroffene
 *      subscription für die EINE event-type. Andere subscriptions des
 *      gleichen pilots sind unaffected (twitch revoked per-subscription).
 *   4. Wenn refresh fehlschlägt: refreshUserToken hat schon die token-
 *      felder genullt — pilot ist effektiv unlinked bis OAuth-re-flow.
 *      Wir loggen das prominently.
 *
 * Fail-mode: wenn re-subscribe nach erfolgreichem refresh trotzdem
 * fehlschlägt (z.B. scope wirklich entfernt), loggen wir und geben auf.
 * Der pilot wird beim nächsten bot-restart durch subscribeAllPilots
 * wieder versucht.
 */
async function handleRevocation(
  sub: EventSubMessage['payload']['subscription'],
): Promise<void> {
  if (!sub) return;
  const broadcasterUserId = sub.condition?.broadcaster_user_id;
  if (!broadcasterUserId) {
    console.warn(
      '[twitch-eventsub] revocation without broadcaster_user_id, cannot recover',
    );
    return;
  }

  const user = await prisma.user.findUnique({
    where: { twitchUserId: broadcasterUserId },
    select: {
      id: true,
      twitchUsername: true,
      twitchUserId: true,
      twitchRefreshToken: true,
    },
  });

  if (!user || !user.twitchRefreshToken) {
    console.warn(
      `[twitch-eventsub] revocation: pilot=${broadcasterUserId} hat keinen refresh-token, cannot recover`,
    );
    return;
  }

  // Force-refresh: ignoriert expires_at, nimmt direkt den refresh-call.
  // Hintergrund: bei revocation kann der token zwar laut timestamp noch
  // valid sein aber trotzdem von twitch's seite invalidiert. Force-
  // refresh ersetzt ihn durch einen frischen.
  const refreshResult = await refreshUserToken(user.id, user.twitchRefreshToken);
  if (!refreshResult.ok) {
    if (refreshResult.unlinked) {
      console.warn(
        `[twitch-eventsub] revocation-recovery: pilot=${user.twitchUsername ?? user.id} unlinked (refresh-token rejected), token-fields cleared`,
      );
    } else {
      console.warn(
        `[twitch-eventsub] revocation-recovery: pilot=${user.twitchUsername ?? user.id} refresh failed (${refreshResult.reason}), giving up`,
      );
    }
    return;
  }

  // Re-create die EINE betroffene subscription. Lookup die template-
  // version aus unserem master-table — wir wollen die selbe version
  // benutzen die wir initial gewählt haben (z.B. hype_train.begin v2).
  const tmpl = SUBSCRIPTION_TEMPLATES.find((t) => t.type === sub.type);
  if (!tmpl) {
    console.warn(
      `[twitch-eventsub] revocation-recovery: type=${sub.type} ist nicht in SUBSCRIPTION_TEMPLATES, skip re-subscribe`,
    );
    return;
  }

  if (!user.twitchUserId) {
    // Kann eigentlich nicht passieren wenn wir hier ankommen (we found
    // user via twitchUserId), aber defensiv für TS.
    return;
  }

  const ok = await createSubscription(
    tmpl.type,
    tmpl.version,
    tmpl.buildCondition(user.twitchUserId),
    refreshResult.accessToken,
    user.twitchUsername ?? user.id,
  );
  if (ok) {
    console.info(
      `[twitch-eventsub] revocation-recovery: pilot=${user.twitchUsername ?? user.id} type=${tmpl.type} re-subscribed nach token-refresh`,
    );
  } else {
    console.warn(
      `[twitch-eventsub] revocation-recovery: pilot=${user.twitchUsername ?? user.id} type=${tmpl.type} re-subscribe failed nach token-refresh — scope wirklich entfernt?`,
    );
  }
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
  // feld. Welle 14D: zusätzlich name + airlineId für den #livestreams-
  // embed (display-name + airline-context). Welle 14E: twitchAccessToken
  // wird NICHT mehr direkt selektiert — der Helix-fetch unten nutzt
  // ensureFreshToken() das den token aktuell + valid garantiert.
  const user = await prisma.user.findUnique({
    where: { twitchUserId: broadcasterUserId },
    select: {
      id: true,
      name: true,
      airlineId: true,
      twitchUsername: true,
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

  // Helix-fetch best-effort. Welle 14E: ensureFreshToken refreshed wenn
  // der token in den letzten 60s vor ablauf ist — bot-prozesse die
  // mehrere stunden alte tokens haben kriegen einen frischen zurück.
  // Wenn null (refresh-fail oder pilot unlinked), überspringen wir den
  // Helix-fetch und fallen auf "kein context"-pfad zurück. Stream-status
  // wird trotzdem korrekt auf live gesetzt — wir verlieren nur title/
  // game/thumbnail.
  let context: LiveStreamContext = {
    title: null,
    gameName: null,
    thumbnailUrl: null,
  };

  if (env.twitch.clientId) {
    const accessToken = await ensureFreshToken(user.id);
    if (accessToken) {
      const fetched = await fetchStreamHelixContext(
        broadcasterUserId,
        accessToken,
      );
      if (fetched) {
        context = fetched;
      }
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
      // Welle 14D: rich embed nach #livestreams. NUR beim first-time go-
      // live (idempotency-skip bei twitch-WS-reconnect-duplicates) damit
      // der channel keine doppel-posts kriegt. Fire-and-forget — embed-
      // failures sollen den DB-write nicht zurücknehmen oder den event-
      // dispatch blockieren.
      void postLivestreamEmbed(user, context);
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

    // Welle 14E: token-refresh-flow. Bot-prozesse die mehrere stunden
    // laufen (z.B. nach einem reconnect von session_reconnect-event)
    // haben tokens die längst über die ~4h twitch-lifetime hinaus sind.
    // ensureFreshToken refreshed präventiv wenn nötig — wenn der pilot
    // seinen access-revoked hat (ungültiger refresh-token), returnt
    // null und wir skippen den pilot statt mit 401-failures alle 5
    // subscription-types durchzubrechen.
    const freshToken = await ensureFreshToken(pilot.id);
    if (!freshToken) {
      console.warn(
        `[twitch-eventsub] subscribeAllPilots: skip pilot=${pilot.twitchUsername ?? pilot.id} — kein valid token (refresh-fail oder unlinked)`,
      );
      totalSkipped += SUBSCRIPTION_TEMPLATES.length;
      continue;
    }

    for (const tmpl of SUBSCRIPTION_TEMPLATES) {
      const ok = await createSubscription(
        tmpl.type,
        tmpl.version,
        tmpl.buildCondition(pilot.twitchUserId),
        freshToken,
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

// ─────────────────────────────────────────────────────────────────────
// Welle 14D: #livestreams rich embed
// ─────────────────────────────────────────────────────────────────────

/**
 * Welle 14D: Postet einen rich embed in den dedicated #livestreams discord-
 * channel wenn ein pilot grade live geht. Ersetzt für stream.online events
 * den (in 14B noch parallel laufenden) #bot-logs-mirror — siehe
 * onNotification routing-comment.
 *
 * Embed-design:
 *   - **Title**: stream-title vom streamer (clickable → twitch-URL)
 *   - **Description**: pilot-name als haupt-zeile, optional airline
 *   - **Game-field**: inline, falls vorhanden
 *   - **Large image**: thumbnail in 1280x720 (substituiert via @vam/db
 *     helper aus der twitch-template-URL). Discord rendert das als
 *     großes preview-image — der hauptliche blickfang.
 *   - **Color**: 0x9146ff (twitch purple)
 *   - **Footer**: airline-name oder "VAM Pilot · Twitch" als context
 *
 * Plus content-line **außerhalb** des embeds: "🔴 **{name}** ist live: {URL}"
 * — das gibt discord eine raw-URL die für mobile-clients besser klickbar
 * ist und auch für screen-reader sauber den go-live-event ankündigt.
 *
 * Idempotency-property: caller (handleStreamOnline) ruft nur bei
 * !wasAlreadyLive — duplicate stream.online events von twitch retries/
 * reconnects führen nicht zu mehrfach-posts.
 *
 * Fail-mode: alle errors werden geloggt aber NICHT propagiert. Der
 * DB-write (markPilotLive) ist dann schon durch — der pilot-status
 * stimmt, nur der discord-post fehlt. Akzeptabel: bei späteren
 * status-checks (UI, /live page) funktioniert alles, der user hat
 * nur die discord-notification verpasst.
 */
async function postLivestreamEmbed(
  user: {
    id: string;
    name: string | null;
    airlineId: string | null;
    twitchUsername: string | null;
  },
  context: LiveStreamContext,
): Promise<void> {
  if (!discordClient) {
    console.warn('[twitch-eventsub] postLivestreamEmbed: kein discordClient');
    return;
  }

  // Wenn der pilot keinen twitchUsername hat, können wir keinen sinnvollen
  // link bauen. Sollte praktisch nicht vorkommen weil OAuth den username
  // immer mit-syncs, aber defensiv: skip silently.
  if (!user.twitchUsername) {
    console.warn(
      `[twitch-eventsub] postLivestreamEmbed: pilot=${user.id} hat keinen twitchUsername, skip`,
    );
    return;
  }

  try {
    // Airline-name lookup für footer-context. Separater query weil wir
    // ihn nur beim first-time go-live brauchen — den ständig im handler-
    // user-fetch zu joinen wäre overhead für die häufigeren duplicate-
    // events die eh früh skippen.
    let airlineName: string | null = null;
    if (user.airlineId) {
      const airline = await prisma.airline.findUnique({
        where: { id: user.airlineId },
        select: { name: true },
      });
      airlineName = airline?.name ?? null;
    }

    const channel = await discordClient.channels.fetch(env.channels.livestreams);
    if (!channel || !channel.isTextBased()) {
      console.warn(
        '[twitch-eventsub] postLivestreamEmbed: livestreams channel nicht text-based oder nicht gefunden',
      );
      return;
    }

    const twitchUrl = `https://twitch.tv/${user.twitchUsername}`;
    const displayName = user.name ?? user.twitchUsername;

    // Thumbnail substituiert auf 1280x720 — discord rendert embed-images
    // bis ungefähr 800px breite, größer wird downsampled. 1280x720 ist
    // ein guter kompromiss: scharf auf hi-DPI displays, aber URL-länge
    // bleibt unter discord's embed-limit. Twitch CDN cached die varianten
    // pre-rendered.
    const thumbnailUrl = substituteThumbnailDimensions(
      context.thumbnailUrl,
      1280,
      720,
    );

    // Embed-title fallback chain: stream-title → "Streamt live" generic.
    // Twitch erlaubt empty titles — manche streamer löschen das vor
    // dem go-live um es später zu setzen.
    const embedTitle =
      context.title?.trim() ?? `${displayName} streamt grade live`;

    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    if (context.gameName) {
      fields.push({ name: 'Spielt', value: context.gameName, inline: true });
    }

    await (channel as TextChannel).send({
      // Plain content-line vor dem embed: macht den go-live im channel-
      // sidebar/notification-preview sichtbar (manche discord-clients
      // zeigen embed-titles in notifications nicht). Plus die raw-URL
      // wird automatisch zu einem zweiten link-preview wenn discord's
      // embed-rendering mal hakt.
      content: `🔴 **${displayName}** ist live: ${twitchUrl}`,
      embeds: [
        {
          color: 0x9146ff, // Twitch purple
          title: embedTitle,
          url: twitchUrl,
          description: airlineName
            ? `Pilot bei **${airlineName}**`
            : 'VAM Pilot',
          fields: fields.length > 0 ? fields : undefined,
          image: thumbnailUrl ? { url: thumbnailUrl } : undefined,
          timestamp: new Date().toISOString(),
          footer: {
            text: airlineName
              ? `${airlineName} · Twitch`
              : 'VAM · Twitch',
          },
        },
      ],
    });

    console.info(
      `[twitch-eventsub] postLivestreamEmbed posted: pilot=${user.twitchUsername} airline=${airlineName ?? '<none>'} title="${embedTitle}"`,
    );
  } catch (err) {
    console.warn(
      `[twitch-eventsub] postLivestreamEmbed failed for pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Welle 14F+G: stream-reward handlers (subs/cheers/gifts/hype-train)
// ─────────────────────────────────────────────────────────────────────

/**
 * Welle 14F+G: shared shape für reward-handler context. Pilot-lookup
 * passiert am anfang jedes handlers — wir cachen nicht weil events
 * sehr selten sind (im verhältnis zur uptime des bots) und der lookup
 * < 5ms kostet. DRY-helper extrahiert es.
 */
type RewardPilotContext = {
  id: string;
  name: string | null;
  airlineId: string | null;
  twitchUsername: string | null;
};

/**
 * Lookup helper für stream-reward handlers. Findet den VAM-pilot
 * anhand des broadcaster_user_id (=twitchUserId). Loggt + returnt null
 * wenn kein pilot gefunden — kann happen bei race conditions (pilot
 * unverlinkt zwischen subscription-creation und event-arrival), oder
 * wenn jemand fremder zur subscription gehört (sollte bei pro-pilot-
 * subscriptions praktisch nie passieren, aber defensiv).
 */
async function lookupRewardPilot(
  broadcasterUserId: string | undefined,
  eventLabel: string,
): Promise<RewardPilotContext | null> {
  if (!broadcasterUserId) {
    console.warn(
      `[twitch-eventsub] ${eventLabel} ohne broadcaster_user_id, skip`,
    );
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { twitchUserId: broadcasterUserId },
    select: {
      id: true,
      name: true,
      airlineId: true,
      twitchUsername: true,
    },
  });
  if (!user) {
    console.warn(
      `[twitch-eventsub] ${eventLabel} broadcaster=${broadcasterUserId} hat keinen matching VAM-user`,
    );
    return null;
  }
  return user;
}

/**
 * Welle 14F: handler für channel.subscribe events.
 *
 * Twitch payload-fields:
 *   - broadcaster_user_id, broadcaster_user_name, broadcaster_user_login
 *   - user_id, user_name, user_login (subscriber)
 *   - tier ("1000" | "2000" | "3000" — als string!)
 *   - is_gift (boolean — true wenn diese sub aus einem gift kam)
 *
 * Reward-policy:
 *   - is_gift=true → SKIP (gift-batch-event handled die zahlung schon)
 *   - is_gift=false → reward gemäss tier
 */
async function handleChannelSubscribe(
  event: Record<string, unknown>,
): Promise<void> {
  const broadcasterUserId = event.broadcaster_user_id as string | undefined;
  const user = await lookupRewardPilot(broadcasterUserId, 'channel.subscribe');
  if (!user) return;

  const tier = parseTwitchTier(event.tier as string | undefined);
  if (!tier) {
    console.warn(
      `[twitch-eventsub] channel.subscribe pilot=${user.twitchUsername ?? user.id} unknown tier=${String(event.tier)}, skip`,
    );
    return;
  }

  const subscriberLogin = (event.user_login as string | undefined) ?? null;
  const isGift = Boolean(event.is_gift);

  const rewardEvent: StreamRewardEvent = {
    kind: 'twitch-subscribe',
    tier,
    subscriberLogin,
    isGift,
  };

  try {
    const result = await awardStreamReward(user.id, rewardEvent);
    if (result.skipped) {
      console.info(
        `[twitch-eventsub] channel.subscribe skipped: pilot=${user.twitchUsername ?? user.id} reason=${result.reason}`,
      );
      return;
    }
    console.info(
      `[twitch-eventsub] channel.subscribe reward: pilot=${user.twitchUsername ?? user.id} tier=${tier} amount=${result.amount} VAM$ from=${subscriberLogin ?? '<anonym>'}`,
    );
    void postRewardEmbed(user, result, {
      icon: '⭐',
      eventLabel: `Tier ${tier} Sub`,
      sourceLabel: subscriberLogin ?? '<anonym>',
    });
  } catch (err) {
    console.error(
      `[twitch-eventsub] handleChannelSubscribe failed pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}

/**
 * Welle 14F: handler für channel.cheer events.
 *
 * Twitch payload-fields:
 *   - broadcaster_user_id (etc.)
 *   - user_id, user_name, user_login (cheerer — kann anonymous sein,
 *     dann sind die felder null und is_anonymous=true)
 *   - is_anonymous (boolean)
 *   - bits (number — anzahl der bits)
 *   - message (string — chat-message vom cheerer)
 */
async function handleChannelCheer(
  event: Record<string, unknown>,
): Promise<void> {
  const broadcasterUserId = event.broadcaster_user_id as string | undefined;
  const user = await lookupRewardPilot(broadcasterUserId, 'channel.cheer');
  if (!user) return;

  const bits =
    typeof event.bits === 'number' ? event.bits : Number(event.bits ?? 0);
  if (!Number.isFinite(bits) || bits <= 0) {
    console.warn(
      `[twitch-eventsub] channel.cheer pilot=${user.twitchUsername ?? user.id} invalid bits=${String(event.bits)}, skip`,
    );
    return;
  }

  const isAnonymous = Boolean(event.is_anonymous);
  const cheererLogin = isAnonymous
    ? null
    : ((event.user_login as string | undefined) ?? null);

  const rewardEvent: StreamRewardEvent = {
    kind: 'twitch-cheer',
    bits,
    cheererLogin,
    isAnonymous,
  };

  try {
    const result = await awardStreamReward(user.id, rewardEvent);
    if (result.skipped) {
      console.info(
        `[twitch-eventsub] channel.cheer skipped: pilot=${user.twitchUsername ?? user.id} bits=${bits} reason=${result.reason} (< 100 bits → kein reward)`,
      );
      return;
    }
    console.info(
      `[twitch-eventsub] channel.cheer reward: pilot=${user.twitchUsername ?? user.id} bits=${bits} amount=${result.amount} VAM$ from=${cheererLogin ?? '<anonym>'}`,
    );
    void postRewardEmbed(user, result, {
      icon: '💎',
      eventLabel: `${bits} Bits`,
      sourceLabel: cheererLogin ?? '<anonym>',
    });
  } catch (err) {
    console.error(
      `[twitch-eventsub] handleChannelCheer failed pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}

/**
 * Welle 14F: handler für channel.subscription.gift events.
 *
 * Twitch payload-fields:
 *   - broadcaster_user_id (etc.)
 *   - user_id, user_name, user_login (gifter — null wenn anonymous)
 *   - is_anonymous (boolean)
 *   - total (number — anzahl der gegifteten subs in diesem batch)
 *   - tier ("1000" | "2000" | "3000")
 *   - cumulative_total (lifetime-count, optional, brauchen wir nicht)
 */
async function handleChannelGift(
  event: Record<string, unknown>,
): Promise<void> {
  const broadcasterUserId = event.broadcaster_user_id as string | undefined;
  const user = await lookupRewardPilot(broadcasterUserId, 'channel.subscription.gift');
  if (!user) return;

  const tier = parseTwitchTier(event.tier as string | undefined);
  if (!tier) {
    console.warn(
      `[twitch-eventsub] channel.subscription.gift pilot=${user.twitchUsername ?? user.id} unknown tier=${String(event.tier)}, skip`,
    );
    return;
  }

  const total =
    typeof event.total === 'number' ? event.total : Number(event.total ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    console.warn(
      `[twitch-eventsub] channel.subscription.gift pilot=${user.twitchUsername ?? user.id} invalid total=${String(event.total)}, skip`,
    );
    return;
  }

  const isAnonymous = Boolean(event.is_anonymous);
  const gifterLogin = isAnonymous
    ? null
    : ((event.user_login as string | undefined) ?? null);

  const rewardEvent: StreamRewardEvent = {
    kind: 'twitch-gift',
    total,
    tier,
    gifterLogin,
    isAnonymous,
  };

  try {
    const result = await awardStreamReward(user.id, rewardEvent);
    if (result.skipped) {
      console.info(
        `[twitch-eventsub] channel.subscription.gift skipped: pilot=${user.twitchUsername ?? user.id} reason=${result.reason}`,
      );
      return;
    }
    console.info(
      `[twitch-eventsub] channel.subscription.gift reward: pilot=${user.twitchUsername ?? user.id} ${total}× tier ${tier} amount=${result.amount} VAM$ from=${gifterLogin ?? '<anonym>'}`,
    );
    void postRewardEmbed(user, result, {
      icon: '🎁',
      eventLabel: `${total}× Tier ${tier} Gift-Subs`,
      sourceLabel: gifterLogin ?? '<anonym>',
    });
  } catch (err) {
    console.error(
      `[twitch-eventsub] handleChannelGift failed pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}

/**
 * Welle 14G: handler für channel.hype_train.begin events.
 *
 * Twitch payload-fields (v2):
 *   - broadcaster_user_id (etc.)
 *   - level (number — train level 1-5)
 *   - total (cumulative points im train)
 *   - progress (points-progress current level)
 *   - goal (next-level threshold)
 *   - top_contributions (array)
 *   - last_contribution (object)
 *   - started_at, expires_at
 *
 * Reward-policy: pure level × HYPE_TRAIN_BASE_BONUS. Top-contributors
 * werden NICHT individuell rewarded — das wäre over-coupling auf hype-
 * train-payload-shape und ist eh schon (in den meisten fällen) durch
 * die individuellen sub/cheer/gift events handled die den hype-train
 * ja erst ausgelöst haben. Hype-train-bonus ist die *zusätzliche*
 * community-recognition obendrauf.
 */
async function handleHypeTrainBegin(
  event: Record<string, unknown>,
): Promise<void> {
  const broadcasterUserId = event.broadcaster_user_id as string | undefined;
  const user = await lookupRewardPilot(broadcasterUserId, 'channel.hype_train.begin');
  if (!user) return;

  const level =
    typeof event.level === 'number' ? event.level : Number(event.level ?? 1);
  const safeLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;

  const rewardEvent: StreamRewardEvent = {
    kind: 'twitch-hype-train-begin',
    level: safeLevel,
  };

  try {
    const result = await awardStreamReward(user.id, rewardEvent);
    if (result.skipped) {
      console.info(
        `[twitch-eventsub] channel.hype_train.begin skipped: pilot=${user.twitchUsername ?? user.id} reason=${result.reason}`,
      );
      return;
    }
    console.info(
      `[twitch-eventsub] channel.hype_train.begin reward: pilot=${user.twitchUsername ?? user.id} level=${safeLevel} amount=${result.amount} VAM$`,
    );
    void postRewardEmbed(user, result, {
      icon: '🚂',
      eventLabel: `Hype-Train Level ${safeLevel}`,
      sourceLabel: 'der community',
    });
  } catch (err) {
    console.error(
      `[twitch-eventsub] handleHypeTrainBegin failed pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}

/**
 * Hilfsfunktion: parsed twitch's tier-string ("1000"/"2000"/"3000") in
 * unsere domain-tier-zahlen (1/2/3). Returnt null bei unbekannten werten.
 *
 * Twitch verwendet diese strings weil ihre legacy-API teilweise auch
 * 4-digit-prefixes für andere produkte hatte — wir mappen das auf saubere
 * domain-zahlen damit der rest des codes mit `1 | 2 | 3` arbeiten kann.
 */
function parseTwitchTier(twitchTier: string | undefined): 1 | 2 | 3 | null {
  switch (twitchTier) {
    case '1000':
      return 1;
    case '2000':
      return 2;
    case '3000':
      return 3;
    default:
      return null;
  }
}

/**
 * Welle 14F+G: postet einen embed nach #livestreams für jeden reward.
 *
 * Visibility-rationale: streamer-pilots sollen sehen wenn ihre community
 * sie unterstützt + der rest der VA sieht es auch (gemeinsamer channel
 * für stream-events). Kanal-wahl: #livestreams (nicht #bot-logs) weil
 * das semantisch passt — go-live-events leben da auch.
 *
 * Embed-style: kompakter als der go-live-embed (kein thumbnail). Pilot-
 * name + reward-icon + amount + source. Twitch-purple farbe für
 * konsistenz.
 *
 * Fail-mode: alle errors werden geloggt aber nicht propagiert. Der
 * wallet-write ist schon durch — embed ist optional.
 */
async function postRewardEmbed(
  user: RewardPilotContext,
  result: Extract<StreamRewardResult, { skipped: false }>,
  options: {
    icon: string;
    eventLabel: string;
    sourceLabel: string;
  },
): Promise<void> {
  if (!discordClient) return;
  if (!user.twitchUsername) return; // siehe postLivestreamEmbed-rationale

  try {
    const channel = await discordClient.channels.fetch(env.channels.livestreams);
    if (!channel || !channel.isTextBased()) {
      console.warn(
        '[twitch-eventsub] postRewardEmbed: livestreams channel nicht text-based / nicht gefunden',
      );
      return;
    }

    const displayName = user.name ?? user.twitchUsername;
    const twitchUrl = `https://twitch.tv/${user.twitchUsername}`;

    // Optional airline-name lookup für footer. Cheap-enough query —
    // events sind nicht hot-path, ein extra read ist ok.
    let airlineName: string | null = null;
    if (user.airlineId) {
      const airline = await prisma.airline.findUnique({
        where: { id: user.airlineId },
        select: { name: true },
      });
      airlineName = airline?.name ?? null;
    }

    await (channel as TextChannel).send({
      embeds: [
        {
          color: 0x9146ff, // Twitch purple
          title: `${options.icon} ${options.eventLabel} für ${displayName}`,
          url: twitchUrl,
          description: `**${options.sourceLabel}** → \`+${result.amount} VAM$\``,
          timestamp: new Date().toISOString(),
          footer: {
            text: airlineName
              ? `${airlineName} · Twitch-Reward`
              : 'VAM · Twitch-Reward',
          },
        },
      ],
    });

    console.info(
      `[twitch-eventsub] postRewardEmbed posted: pilot=${user.twitchUsername} event="${options.eventLabel}" amount=${result.amount}`,
    );
  } catch (err) {
    console.warn(
      `[twitch-eventsub] postRewardEmbed failed pilot=${user.twitchUsername ?? user.id}:`,
      err,
    );
  }
}
