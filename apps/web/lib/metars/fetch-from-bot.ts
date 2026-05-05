import 'server-only';

/**
 * Track 1 #8 Phase 5 — Shared METAR-fetcher für überall wo der bot's
 * METAR-cache angefragt werden muss.
 *
 * Architektur: Der bot pollt VATSIM's METAR-server alle 10min, parsed
 * via lib/metar-parser.ts und cached die decoded-shape im RAM.
 * /api/live/metars (für die live-map) und /api/overlay/[token]/data
 * (für das OBS-overlay) brauchen beide diese daten — diese helper
 * konsolidiert die fetch-logik damit beide call-sites konsistent
 * sind und änderungen am bot-protokoll an einer stelle gepatched
 * werden.
 *
 * # Caching
 *
 * fetch() mit revalidate=60 — Next.js cached die response 60s. Das
 * macht /api/live/metars und das overlay-data effektiv batched: bei
 * 100 overlay-pollers in der gleichen minute wird der bot nur 1x
 * gefragt. Bot's eigener METAR-poll-interval ist eh 10min, also
 * ist 60s fresh-genug.
 *
 * # Failure-handling
 *
 * Bot down → returns null. Caller (overlay/data, live/metars) decided
 * was zu tun ist:
 *   - overlay/data: weather-block null → UI rendert weather-section nicht
 *   - live/metars: 502-error → live-map zeigt notification
 *
 * # Subset vs full
 *
 * fetchSingleMetar(icao) für single-icao queries (wie overlay departure/
 * arrival): nutzt bot's full-cache + filter danach im memory. Bot hat
 * keinen "fetch by icao"-endpoint weil der cache eh klein ist (~50-200
 * airports). Cleaner als ein zweiter endpoint.
 */

const BOT_URL = process.env.BOT_HTTP_URL ?? 'http://localhost:3001';
const BOT_SECRET = process.env.BOT_EVENTS_SECRET ?? '';

/**
 * Bot's decoded METAR shape (mirror of metar-tracker DecodedMetar).
 * Wir definieren das hier separat statt aus @vam/db zu importieren weil
 * der bot's metar-tracker im bot-package liegt — das wäre ein cross-
 * package dep. Die shape ist stabil seit Welle 10.
 */
export type DecodedMetar = {
  station: string;
  observedAt: string | null;
  wind: {
    direction: number | null;
    speed: number;
    gust: number | null;
    variableFrom: number | null;
    variableTo: number | null;
  } | null;
  visibility: string | null;
  weather: string[];
  clouds: Array<{ coverage: string; base: number; type: string | null }>;
  temperature: number | null;
  dewpoint: number | null;
  pressure: {
    qnhHpa: number | null;
    altimeterInHg: number | null;
  };
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
};

export type CachedMetar = {
  icao: string;
  raw: string;
  decoded: DecodedMetar | null;
  fetchedAt: string;
};

type BotMetarResponse = {
  count: number;
  metars: Record<string, CachedMetar>;
};

/**
 * Fetched alle METARs aus dem bot-cache. Returns null wenn bot down
 * oder secret nicht konfiguriert.
 */
export async function fetchAllMetarsFromBot(): Promise<Record<
  string,
  CachedMetar
> | null> {
  if (!BOT_SECRET) {
    console.warn('[metars/fetch-from-bot] BOT_EVENTS_SECRET not set');
    return null;
  }

  try {
    const res = await fetch(`${BOT_URL}/metars`, {
      headers: { Authorization: `Bearer ${BOT_SECRET}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      console.error(
        `[metars/fetch-from-bot] Bot returned ${res.status}`,
      );
      return null;
    }
    const data = (await res.json()) as BotMetarResponse;
    return data.metars;
  } catch (err) {
    console.error('[metars/fetch-from-bot] Fetch failed:', err);
    return null;
  }
}

/**
 * Convenience für single-airport-lookup. Ruft fetchAllMetarsFromBot
 * (cached) und filtert danach. Returns null wenn bot down ODER ICAO
 * nicht im cache (z.B. unbekannte airfields, oder VATSIM hat keinen
 * METAR für die station).
 *
 * ICAO ist case-insensitive — wir uppercasen.
 */
export async function fetchSingleMetar(
  icao: string,
): Promise<CachedMetar | null> {
  const all = await fetchAllMetarsFromBot();
  if (!all) return null;
  return all[icao.toUpperCase()] ?? null;
}

/**
 * Mehrere ICAOs auf einmal — z.B. departure + arrival für ein overlay.
 * Returns ein dict mit nur den gefundenen einträgen. Ein null-result
 * vom bot bedeutet "bot down" → leeres dict (caller-side conditional).
 */
export async function fetchMetarsForIcaos(
  icaos: readonly string[],
): Promise<Record<string, CachedMetar>> {
  const all = await fetchAllMetarsFromBot();
  if (!all) return {};
  const result: Record<string, CachedMetar> = {};
  for (const icao of icaos) {
    const upper = icao.toUpperCase();
    if (all[upper]) {
      result[upper] = all[upper];
    }
  }
  return result;
}
