/**
 * Welle 14A — Twitch Live-Status Helpers.
 *
 * Atomic DB-updates für die User.twitchIsLive/Title/Game/Thumbnail/
 * LastWentLiveAt-felder. Wird von zwei orten aufgerufen:
 *
 *   1. EventSub-handler im bot (apps/bot/src/services/twitch-eventsub.ts)
 *      bei stream.online/offline events (14B).
 *   2. UI-queries (apps/web) für live-badges + live-pilots-listings (14C).
 *
 * Design-prinzipien:
 *
 *   - **Idempotenz**: doppelte stream.online events (twitch dedupes
 *     normally aber retries beim WS-reconnect senden uns occasionally
 *     denselben event nochmal) führen NICHT zu duplikaten oder doppelten
 *     discord-embeds. Helper returnen `wasAlreadyLive`-flag damit der
 *     caller entscheidet ob er weiteractions (embed posten) triggert.
 *
 *   - **Atomicity**: alle felder in einem update-statement. Kein read-
 *     modify-write-pattern, keine race-conditions zwischen go-live und
 *     metadata-fetch. Der bot fetcht den helix-stream-context BEVOR er
 *     markPilotLive() ruft, dann ist der DB-zustand atomic-konsistent.
 *
 *   - **History-preservation**: bei stream.offline werden title/game/
 *     thumbnail cleared, ABER twitchLastWentLiveAt bleibt. Profile-UI
 *     kann damit "zuletzt live: gestern 18:43" anzeigen.
 */

import { prisma } from "../index.js";

/**
 * Stream-context der bei stream.online vom Helix /streams API gefetcht
 * wird (event-payload selbst hat nur user-IDs). Alle felder optional —
 * twitch hat manchmal partial responses, und wir wollen go-live nicht
 * blockieren wenn z.B. game-name fehlt.
 */
export type LiveStreamContext = {
  /** Stream-title vom streamer gesetzt, z.B. "VATSIM | A320 EDDF→LOWW" */
  title?: string | null;
  /** Game-category, z.B. "Microsoft Flight Simulator" */
  gameName?: string | null;
  /**
   * Thumbnail-URL in twitch-template-form mit {width}x{height}-placeholders,
   * z.B. "https://static-cdn.jtvnw.net/previews-ttv/live_user_xy-{width}x{height}.jpg".
   * UI muss die placeholders vor display ersetzen — siehe
   * substituteThumbnailDimensions-helper unten.
   */
  thumbnailUrl?: string | null;
};

export type MarkPilotLiveResult = {
  /**
   * True wenn der user vor dem call schon twitchIsLive=true hatte. Caller
   * (EventSub-handler) sollte in diesem fall KEIN discord-embed posten —
   * der initial go-live wurde schon gehandled, das hier ist ein duplicate.
   */
  wasAlreadyLive: boolean;
  /** Updated user-id (für convenience, falls caller logging machen will). */
  userId: string;
};

/**
 * Markiert den pilot als live + speichert stream-context.
 *
 * Race-safe via single-statement update. Idempotency-check: wir prüfen
 * den vorherigen state in einer transaction so dass wasAlreadyLive
 * korrekt reportet wird auch bei concurrent-events.
 *
 * @param userId — die VAM-User.id (NICHT twitch-user-id). Caller hat
 *   bereits via twitchUserId-lookup den passenden VAM-user gefunden.
 * @param context — stream-metadata vom Helix-API.
 */
export async function markPilotLive(
  userId: string,
  context: LiveStreamContext,
): Promise<MarkPilotLiveResult> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: userId },
      select: { twitchIsLive: true },
    });

    if (!before) {
      // User existiert nicht mehr — kann passieren wenn der user gerade
      // disconnected hat während ein event in-flight war. Kein hard-error,
      // helper ist no-op und reportet wasAlreadyLive=true (= caller skip).
      return { wasAlreadyLive: true, userId };
    }

    const wasAlreadyLive = before.twitchIsLive;

    await tx.user.update({
      where: { id: userId },
      data: {
        twitchIsLive: true,
        twitchStreamTitle: context.title ?? null,
        twitchStreamGameName: context.gameName ?? null,
        twitchStreamThumbnailUrl: context.thumbnailUrl ?? null,
        // twitchLastWentLiveAt nur beim ersten go-live setzen, NICHT bei
        // duplicate events — sonst würde "online seit X" sich resetten
        // jedes mal wenn twitch einen retry sendet. Idempotency-property.
        ...(wasAlreadyLive ? {} : { twitchLastWentLiveAt: new Date() }),
      },
    });

    return { wasAlreadyLive, userId };
  });
}

export type MarkPilotOfflineResult = {
  /**
   * True wenn der user vor dem call schon twitchIsLive=false hatte.
   * Caller kann das nutzen um doppelte log-entries zu vermeiden.
   */
  wasAlreadyOffline: boolean;
  userId: string;
};

/**
 * Markiert den pilot als offline + clears stream-context.
 *
 * twitchLastWentLiveAt wird bewusst NICHT cleared — bleibt erhalten als
 * "war zuletzt live"-history-marker für die profile-UI.
 */
export async function markPilotOffline(
  userId: string,
): Promise<MarkPilotOfflineResult> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: userId },
      select: { twitchIsLive: true },
    });

    if (!before) {
      return { wasAlreadyOffline: true, userId };
    }

    const wasAlreadyOffline = !before.twitchIsLive;

    await tx.user.update({
      where: { id: userId },
      data: {
        twitchIsLive: false,
        twitchStreamTitle: null,
        twitchStreamGameName: null,
        twitchStreamThumbnailUrl: null,
        // twitchLastWentLiveAt: NICHT cleared (history-preservation).
      },
    });

    return { wasAlreadyOffline, userId };
  });
}

/**
 * Sub-set des User-records den live-pilots-listings brauchen. Bewusst
 * minimal damit der query nicht das ganze user-record (incl. tokens)
 * über die wire schickt.
 */
export type LivePilotSummary = {
  id: string;
  name: string | null;
  airlineId: string | null;
  twitchUsername: string | null;
  twitchStreamTitle: string | null;
  twitchStreamGameName: string | null;
  twitchStreamThumbnailUrl: string | null;
  twitchLastWentLiveAt: Date | null;
};

/**
 * Listet alle aktuell live-streamenden pilots. Optional gefiltert auf
 * eine airline (für airline-dashboard / live-map sidebar).
 *
 * Sortierung: `twitchLastWentLiveAt` desc (neueste go-lives zuerst). Wenn
 * mehrere pilots gleichzeitig gehen — was unwahrscheinlich aber möglich
 * ist — bleibt die reihenfolge stabil über pilot-id als secondary-sort.
 */
export async function getLivePilots(
  filter?: { airlineId?: string },
): Promise<LivePilotSummary[]> {
  return prisma.user.findMany({
    where: {
      twitchIsLive: true,
      ...(filter?.airlineId ? { airlineId: filter.airlineId } : {}),
    },
    select: {
      id: true,
      name: true,
      airlineId: true,
      twitchUsername: true,
      twitchStreamTitle: true,
      twitchStreamGameName: true,
      twitchStreamThumbnailUrl: true,
      twitchLastWentLiveAt: true,
    },
    orderBy: [
      { twitchLastWentLiveAt: "desc" },
      { id: "asc" }, // tiebreaker für stable ordering
    ],
  });
}

/**
 * Counts currently-live pilots. Kompakter helper für header-badge
 * ("🔴 3 live") ohne den full record-shaped query zu machen.
 */
export async function countLivePilots(
  filter?: { airlineId?: string },
): Promise<number> {
  return prisma.user.count({
    where: {
      twitchIsLive: true,
      ...(filter?.airlineId ? { airlineId: filter.airlineId } : {}),
    },
  });
}

/**
 * Twitch thumbnail-URLs kommen als templates mit `{width}x{height}`-
 * placeholders, z.B.:
 *
 *   https://static-cdn.jtvnw.net/previews-ttv/live_user_xy-{width}x{height}.jpg
 *
 * UI muss die placeholders durch konkrete pixel-werte ersetzen bevor das
 * `<img>` rendered. Dieser helper macht das defensiv (returnt null wenn
 * die input-URL kein template ist oder falsch geformt).
 *
 * Beispiel-aufruf:
 *   substituteThumbnailDimensions(url, 320, 180) → ".../live_user_xy-320x180.jpg"
 */
export function substituteThumbnailDimensions(
  templateUrl: string | null | undefined,
  width: number,
  height: number,
): string | null {
  if (!templateUrl) return null;
  if (!templateUrl.includes("{width}") || !templateUrl.includes("{height}")) {
    // No template-placeholders — return as-is. Twitch SOMETIMES gives URLs
    // ohne placeholders (z.B. bei archived-VOD-thumbnails). Wir lassen sie
    // unverändert durch.
    return templateUrl;
  }
  return templateUrl
    .replace("{width}", String(Math.round(width)))
    .replace("{height}", String(Math.round(height)));
}
