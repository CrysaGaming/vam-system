import 'server-only';

/**
 * Welle B — B2 phase 2B. Bot ATC controllers fetcher.
 *
 * Architecture mirror of lib/metars/fetch-from-bot.ts: bot polls VATSIM
 * for online controllers every 30s and caches them in RAM; this helper
 * fetches the cached snapshot with 60s revalidation so the matcher
 * doesn't hammer the bot on every heartbeat.
 *
 * # Caching
 *
 * fetch() with revalidate=60 — Next.js caches the response for 60s.
 * The bot's poll-interval is 30s, so we never serve data older than
 * ~90s end-to-end (bot poll-cycle + our cache TTL). For ATC matching
 * that's plenty: controllers typically stay on a position 30+ minutes,
 * and a brand-new controller logon takes a heartbeat or two to
 * propagate anyway because the pilot has to be in range and tuned.
 *
 * Why not poll directly from the matcher: a single heartbeat-handler
 * invocation typically triggers one matcher call. At 30 ACARS-pilots
 * × 1 heartbeat/2s × 1 matcher call/heartbeat = 15 matcher calls/sec.
 * Without caching, that's 15 bot-fetches/sec — pointless because the
 * underlying VATSIM data only refreshes every 30s. The shared 60s
 * Next.js cache deduplicates all this into one bot-fetch/minute.
 *
 * # Failure-handling
 *
 * Bot down OR BOT_EVENTS_SECRET not set → returns null. Matcher's
 * caller treats null as "no controllers known right now"; doesn't
 * persist any AtcSession changes this heartbeat. The next heartbeat
 * after bot recovery picks up where things left off.
 */

const BOT_URL = process.env.BOT_HTTP_URL ?? 'http://localhost:3001';
const BOT_SECRET = process.env.BOT_EVENTS_SECRET ?? '';

/**
 * Public controller shape exposed by the bot at GET /atc/online. Mirror
 * of vatsim-tracker's PublicController type — kept duplicated here
 * (rather than imported across packages) for the same reason as the
 * DecodedMetar duplication in metars/fetch-from-bot.ts: pulling a type
 * from the bot package into the web package creates a cross-package
 * dep that doesn't play nicely with pnpm workspace builds.
 *
 * Field semantics: see vatsim-tracker.ts's VatsimController and
 * PublicController docstrings. The bot pre-parses frequency→
 * frequencyMhz and facility→facilityType so we don't have to.
 */
export type PublicController = {
  cid: number;
  callsign: string;
  frequency: string;
  frequencyMhz: number;
  facility: number;
  facilityType: string;
  visualRange: number;
  textAtis: string | null;
  logonTime: string;
};

type BotAtcResponse = {
  vatsim: {
    count: number;
    updatedAt: string | null;
    controllers: PublicController[];
  };
};

/**
 * Returns the current snapshot of online VATSIM controllers from the
 * bot's cache. Returns null when the bot is unreachable, returns 4xx/5xx,
 * or when BOT_EVENTS_SECRET isn't configured (dev environment without
 * bot integration).
 *
 * Empty array (zero controllers online) is a valid non-null result —
 * it means the bot is up and reachable but there are genuinely no
 * controllers online right now (overnight in Europe, network maintenance
 * window). Callers should distinguish null (bot-down) from [] (no ATC).
 */
export async function fetchAtcControllers(): Promise<
  PublicController[] | null
> {
  if (!BOT_SECRET) {
    console.warn('[atc/fetch-from-bot] BOT_EVENTS_SECRET not set');
    return null;
  }

  try {
    const res = await fetch(`${BOT_URL}/atc/online`, {
      headers: { Authorization: `Bearer ${BOT_SECRET}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      console.error(`[atc/fetch-from-bot] Bot returned ${res.status}`);
      return null;
    }
    const data = (await res.json()) as BotAtcResponse;
    return data.vatsim.controllers;
  } catch (err) {
    console.error('[atc/fetch-from-bot] Fetch failed:', err);
    return null;
  }
}
