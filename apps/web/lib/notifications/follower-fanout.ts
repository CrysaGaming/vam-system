/**
 * Welle G / G4 — Follower-fanout für live-notifications.
 *
 * Wenn ein pilot etwas tut (PIREP approve, LiveSession start, Award
 * earn), pushen wir das an ALLE seine follower (Follow-table) als
 * web-push-notification — natürlich nur an die, die diesen
 * notification-channel explizit nicht deaktiviert haben.
 *
 * # Architecture
 *
 * Drei dispatcher-funktionen, eine pro event-typ:
 *
 *   - notifyFollowersOfPirep(actorId, pirepId)
 *   - notifyFollowersOfLiveStart(actorId, sessionId)
 *   - notifyFollowersOfAward(actorId, awardId)
 *
 * Jede macht:
 *   1. Load actor's name (für notification-title)
 *   2. Load alle followers via `Follow.findMany({followeeId: actorId})`
 *      mit eager-load von User.notificationPrefs
 *   3. Filter followers: getPref(prefs, category, 'inApp') === true
 *   4. Promise.allSettled über sendPushToUser für jeden eligible follower
 *   5. Log aggregate stats
 *
 * # Fire-and-forget pattern
 *
 * Alle call-sites rufen diese funktionen mit `void ...catch(...)`.
 * Kein await im hot-path. Fehler werden geloggt aber nicht propagiert
 * — die source-action (PIREP-approve, etc.) ist schon committed
 * bevor wir hier sind.
 *
 * # Silent-no-op wenn push nicht configured
 *
 * Wenn VAPID env-vars fehlen, returnt `sendPushToUser` einfach 0-counts
 * ohne side-effects. Das ganze follower-fanout passiert dann trotzdem
 * (load + filter + dispatch), aber bringt nichts an die clients. Das
 * ist gewollt — wir wollen ein konsistentes pattern für dev + prod
 * deployments. In dev ohne VAPID einfach noop.
 *
 * # Future extensions
 *
 *   - Email-channel: getPref(prefs, category, 'email') triggert
 *     email-dispatcher (resend) zusätzlich zum push.
 *   - Inbox-row: AdminNotification-ähnliche user-facing inbox-table
 *     für persistent in-app-notifications. V1 macht push-only.
 *   - Batching: wenn ein pilot 100 follower hat und 5 PIREPs in 5 min
 *     approved, kriegt jeder follower 5 notifications. V2 könnte das
 *     coalescen via tag-deduplication.
 */

import { prisma } from '@vam/db';
import { sendPushToUser, type PushPayload } from '@/lib/push/vapid';
import {
  parsePrefs,
  getPref,
  type NotificationCategory,
} from '@/lib/notification-prefs';

/**
 * Internal helper: load followers eines actors + filter nach prefs.
 *
 * Returnt nur die userIds die in-app push wirklich wollen — das
 * spart sendPushToUser-aufrufe für users die die category deaktiviert
 * haben (zwar tut sendPushToUser dann auch nichts wenn keine
 * subscriptions vorhanden sind, aber dieser pre-filter ist günstiger
 * als ein DB-roundtrip).
 *
 * Performance: bei einem pilot mit 50 followers ist das eine query
 * mit `.follow.findMany` + join auf user. Index covered.
 */
async function loadEligibleFollowers(
  actorId: string,
  category: NotificationCategory,
): Promise<string[]> {
  const followers = await prisma.follow.findMany({
    where: { followeeId: actorId },
    select: {
      followerId: true,
      follower: { select: { notificationPrefs: true } },
    },
  });

  return followers
    .filter((f) => {
      const prefs = parsePrefs(f.follower.notificationPrefs);
      return getPref(prefs, category, 'inApp');
    })
    .map((f) => f.followerId);
}

/**
 * Internal helper: fan-out push-notification an eine liste von users.
 *
 * Promise.allSettled damit ein einzelner failed-push die anderen nicht
 * blockt. Returnt aggregate-counts für logging.
 */
async function fanOutPush(
  userIds: string[],
  payload: PushPayload,
): Promise<{ delivered: number; failed: number }> {
  if (userIds.length === 0) {
    return { delivered: 0, failed: 0 };
  }

  const results = await Promise.allSettled(
    userIds.map((uid) => sendPushToUser(uid, payload)),
  );

  let delivered = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      delivered += r.value.succeeded;
      failed += r.value.failed;
    } else {
      failed++;
    }
  }
  return { delivered, failed };
}

// ─────────────────────────────────────────────────────────────────────
// Dispatcher: PIREP approved
// ─────────────────────────────────────────────────────────────────────

/**
 * Benachrichtige alle follower eines pilots dass dieser einen PIREP
 * approved bekommen hat.
 *
 * Wird gefeuert vom approvePirep-flow (apps/web/app/pireps/actions.ts)
 * nachdem die DB-transaction committed ist. Fire-and-forget.
 *
 * Notification-text: "Max hat einen PIREP submitted: EDDF → EDDM"
 */
export async function notifyFollowersOfPirep(
  actorId: string,
  pirepId: string,
): Promise<void> {
  // Resolve actor name + pirep details. Ein roundtrip via include.
  const pirep = await prisma.pirep.findUnique({
    where: { id: pirepId },
    select: {
      id: true,
      user: { select: { name: true } },
      departure: { select: { icao: true } },
      arrival: { select: { icao: true } },
      route: { select: { flightNumber: true } },
    },
  });
  if (!pirep) {
    console.warn(`[follower-fanout] pirep ${pirepId} not found, skip`);
    return;
  }

  const followerIds = await loadEligibleFollowers(actorId, 'followedPilotPirep');
  if (followerIds.length === 0) return;

  const actorName = pirep.user.name ?? 'Ein Pilot';
  const flightLabel = pirep.route?.flightNumber ?? 'PIREP';
  const payload: PushPayload = {
    title: `✈️ ${actorName} — Flug eingereicht`,
    body: `${flightLabel}: ${pirep.departure.icao} → ${pirep.arrival.icao}`,
    url: `/pireps/${pirepId}`,
    tag: `follow-pirep-${pirepId}`,
  };

  const { delivered, failed } = await fanOutPush(followerIds, payload);
  console.info(
    `[follower-fanout] pirep ${pirepId} by ${actorId}: ${followerIds.length} followers, ${delivered} delivered, ${failed} failed`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Dispatcher: LiveSession started
// ─────────────────────────────────────────────────────────────────────

/**
 * Benachrichtige alle follower eines pilots dass dieser eine neue
 * LiveSession gestartet hat (= ACARS-flight begonnen).
 *
 * Wird gefeuert vom acars-heartbeat-route nachdem eine BRAND-NEW
 * session in der DB erstellt wurde (nicht bei jedem heartbeat — nur
 * beim allerersten der eine session-zeile created). Fire-and-forget.
 *
 * Notification-text: "Max ist jetzt live geflogen"
 */
export async function notifyFollowersOfLiveStart(
  actorId: string,
  sessionId: string,
): Promise<void> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });
  if (!actor) {
    console.warn(`[follower-fanout] user ${actorId} not found, skip`);
    return;
  }

  const followerIds = await loadEligibleFollowers(
    actorId,
    'followedPilotLiveStart',
  );
  if (followerIds.length === 0) return;

  const actorName = actor.name ?? 'Ein Pilot';
  const payload: PushPayload = {
    title: `🟢 ${actorName} fliegt jetzt`,
    body: `Neue Live-Session gestartet — schau auf die Live-Map.`,
    url: `/live`,
    // Tag pro actor → mehrere "live"-events vom gleichen pilot
    // coalescen (z.B. wenn er disconnect/reconnect macht). Different
    // sessionIds → different notifications, aber gleicher tag-prefix
    // erlaubt browser-deduplication beim notification-tray.
    tag: `follow-live-${sessionId}`,
  };

  const { delivered, failed } = await fanOutPush(followerIds, payload);
  console.info(
    `[follower-fanout] live-start ${sessionId} by ${actorId}: ${followerIds.length} followers, ${delivered} delivered, ${failed} failed`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Dispatcher: Award earned
// ─────────────────────────────────────────────────────────────────────

/**
 * Benachrichtige alle follower eines pilots dass dieser einen neuen
 * Award erhalten hat.
 *
 * Call-sites:
 *   - apps/web/app/pireps/actions.ts (auto-grant nach PIREP-approve)
 *   - apps/web/app/admin/awards/actions.ts (manual admin-grant)
 *
 * Notification-text: "Max hat einen Award erhalten: <Award-Name>"
 */
export async function notifyFollowersOfAward(
  actorId: string,
  awardId: string,
): Promise<void> {
  const [actor, award] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    }),
    prisma.award.findUnique({
      where: { id: awardId },
      select: { name: true },
    }),
  ]);
  if (!actor || !award) {
    console.warn(
      `[follower-fanout] actor ${actorId} or award ${awardId} not found, skip`,
    );
    return;
  }

  const followerIds = await loadEligibleFollowers(actorId, 'followedPilotAward');
  if (followerIds.length === 0) return;

  const actorName = actor.name ?? 'Ein Pilot';
  const payload: PushPayload = {
    title: `🏆 ${actorName} — neuer Award`,
    body: `${award.name}`,
    url: `/p/${actorId}`,
    tag: `follow-award-${awardId}-${actorId}`,
  };

  const { delivered, failed } = await fanOutPush(followerIds, payload);
  console.info(
    `[follower-fanout] award ${awardId} for ${actorId}: ${followerIds.length} followers, ${delivered} delivered, ${failed} failed`,
  );
}
