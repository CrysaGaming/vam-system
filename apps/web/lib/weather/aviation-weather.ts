import 'server-only';

/**
 * Welle P / P1 — Aviation weather helper.
 *
 * Two entrypoints:
 *
 *   getAirportWeather(icao, opts?) — read-through cache. Returns the
 *     cached row if fresh (≤ CACHE_FRESHNESS_MIN minutes old), else
 *     fetches NOAA aviationweather.gov, parses the METAR, upserts,
 *     and returns the fresh row. On upstream failure with a stale-
 *     cached row present, returns the stale row with `isStale: true`
 *     rather than failing the caller.
 *
 *   getMultipleAirportWeather(icaos) — batch variant. Same semantics
 *     per-airport but coalesces the upstream fetch into one call
 *     (aviationweather.gov supports comma-separated ICAOs).
 *
 * # Upstream
 *
 * NOAA's Aviation Weather Center publishes a JSON METAR API at
 * https://aviationweather.gov/api/data/metar?ids=<ICAO>&format=json
 * — free, no auth, generous rate-limits (no published number but
 * the docs hint at "reasonable use"; our 30-minute cache keeps us
 * well clear). Returns an array; index 0 is the most recent
 * observation for each ICAO.
 *
 * Response shape (relevant fields):
 *   { icaoId, rawOb, obsTime, wdir, wspd, wgst, visib,
 *     altim, temp, dewp, clouds: [{cover, base}] }
 *
 * `visib` is a string — usually a number ("6"), sometimes with a
 * suffix ("6+" for "at least 6 sm", "<1/4" for very low). We parse
 * defensively and fall back to UNKNOWN on unparseable input.
 *
 * `clouds[].cover` is one of CLR, SKC, FEW, SCT, BKN, OVC. Ceiling
 * is the lowest BKN or OVC layer base in feet; FEW/SCT don't count.
 *
 * # No TAF fetching v1
 *
 * NOAA has a separate TAF endpoint. Skipped in v1 because parsing
 * TAFs is substantially harder (multi-period validity, change groups)
 * and the dispatch use-case is mostly "what's the weather right now."
 * Schema column exists so v2 can add it without a migration.
 */

import { prisma, FlightCategory, type AirportWeather } from '@vam/db';

// ─── Tuning ─────────────────────────────────────────────────
// Cache freshness: METARs are typically issued at H:00 and H:30,
// sometimes with hourly-only fields. 30 minutes matches that cadence
// without over-fetching. Pilots can force-refresh via a query-param
// if they really need a fresh pull.
const CACHE_FRESHNESS_MIN = 30;

// Upstream timeout. NOAA usually responds in <500ms; if we hit a
// stall we'd rather return a stale-cached row than block the
// dispatch board for seconds.
const FETCH_TIMEOUT_MS = 4_000;

const NOAA_METAR_URL = 'https://aviationweather.gov/api/data/metar';

// ─── Public types ───────────────────────────────────────────

export type WeatherResult =
  | { ok: true; weather: AirportWeather; isStale: false }
  | { ok: true; weather: AirportWeather; isStale: true; reason: string }
  | { ok: false; reason: 'no_metar' | 'fetch_failed' | 'invalid_icao'; detail?: string };

// ─── Single-airport read ────────────────────────────────────

export async function getAirportWeather(
  icao: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<WeatherResult> {
  const cleanIcao = icao.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(cleanIcao)) {
    return { ok: false, reason: 'invalid_icao', detail: icao };
  }

  // ─── Check cache first (unless forceRefresh) ──────────────
  const cached = await prisma.airportWeather.findUnique({
    where: { airportIcao: cleanIcao },
  });

  if (cached && !opts.forceRefresh && isFresh(cached.fetchedAt)) {
    return { ok: true, weather: cached, isStale: false };
  }

  // ─── Stale or missing — fetch upstream ────────────────────
  const fetched = await fetchMetarFromNoaa([cleanIcao]);
  if (!fetched.ok) {
    // Upstream failed. If we have a stale cache, return it with a
    // warning rather than failing the caller — dispatch board with
    // 2-hour-old data is better than no weather at all.
    if (cached) {
      return {
        ok: true,
        weather: cached,
        isStale: true,
        reason: fetched.reason,
      };
    }
    return { ok: false, reason: 'fetch_failed', detail: fetched.reason };
  }

  const observation = fetched.observations.find(
    (o) => o.icaoId === cleanIcao,
  );
  if (!observation) {
    return { ok: false, reason: 'no_metar', detail: `no observation for ${cleanIcao}` };
  }

  const parsed = parseObservation(observation);
  const upserted = await prisma.airportWeather.upsert({
    where: { airportIcao: cleanIcao },
    create: {
      airportIcao: cleanIcao,
      metarRaw: observation.rawOb,
      ...parsed,
    },
    update: {
      metarRaw: observation.rawOb,
      ...parsed,
      fetchedAt: new Date(),
    },
  });

  return { ok: true, weather: upserted, isStale: false };
}

// ─── Batch read for dispatch board ──────────────────────────
//
// Coalesces the upstream call so rendering 15 flights doesn't
// trigger 30 separate HTTP fetches. Per-airport cache hits still
// short-circuit; only stale/missing ICAOs hit upstream.

export async function getMultipleAirportWeather(
  icaos: string[],
): Promise<Map<string, WeatherResult>> {
  const result = new Map<string, WeatherResult>();
  const cleanIcaos = Array.from(
    new Set(
      icaos
        .map((i) => i.trim().toUpperCase())
        .filter((i) => /^[A-Z]{4}$/.test(i)),
    ),
  );

  if (cleanIcaos.length === 0) return result;

  // Load all cache entries in one query.
  const cached = await prisma.airportWeather.findMany({
    where: { airportIcao: { in: cleanIcaos } },
  });
  const cacheMap = new Map(cached.map((c) => [c.airportIcao, c]));

  // Partition: fresh-cached vs needs-refresh.
  const needsFetch: string[] = [];
  for (const icao of cleanIcaos) {
    const row = cacheMap.get(icao);
    if (row && isFresh(row.fetchedAt)) {
      result.set(icao, { ok: true, weather: row, isStale: false });
    } else {
      needsFetch.push(icao);
    }
  }

  if (needsFetch.length === 0) return result;

  // Single batched upstream call for all stale/missing ICAOs.
  const fetched = await fetchMetarFromNoaa(needsFetch);
  if (!fetched.ok) {
    // Upstream failed wholesale — return stale-cached for any we have,
    // missing-marker for the rest.
    for (const icao of needsFetch) {
      const stale = cacheMap.get(icao);
      if (stale) {
        result.set(icao, {
          ok: true,
          weather: stale,
          isStale: true,
          reason: fetched.reason,
        });
      } else {
        result.set(icao, {
          ok: false,
          reason: 'fetch_failed',
          detail: fetched.reason,
        });
      }
    }
    return result;
  }

  // Index the response by ICAO.
  const observationMap = new Map(
    fetched.observations.map((o) => [o.icaoId, o]),
  );

  // Upsert each successfully-fetched observation.
  for (const icao of needsFetch) {
    const obs = observationMap.get(icao);
    if (!obs) {
      // Upstream returned 200 but no row for this ICAO — airport
      // probably doesn't publish METAR (small regional fields, mil
      // bases off-net). Use stale cache if any, else mark missing.
      const stale = cacheMap.get(icao);
      if (stale) {
        result.set(icao, {
          ok: true,
          weather: stale,
          isStale: true,
          reason: 'no_metar',
        });
      } else {
        result.set(icao, { ok: false, reason: 'no_metar' });
      }
      continue;
    }

    const parsed = parseObservation(obs);
    const upserted = await prisma.airportWeather.upsert({
      where: { airportIcao: icao },
      create: {
        airportIcao: icao,
        metarRaw: obs.rawOb,
        ...parsed,
      },
      update: {
        metarRaw: obs.rawOb,
        ...parsed,
        fetchedAt: new Date(),
      },
    });
    result.set(icao, { ok: true, weather: upserted, isStale: false });
  }

  return result;
}

// ─── NOAA HTTP layer ────────────────────────────────────────

type NoaaObservation = {
  icaoId: string;
  rawOb: string;
  obsTime?: number;
  wdir?: number | string | null;
  wspd?: number | null;
  wgst?: number | null;
  visib?: string | number | null;
  altim?: number | null;
  temp?: number | null;
  dewp?: number | null;
  clouds?: Array<{ cover?: string; base?: number | null }>;
};

type FetchResult =
  | { ok: true; observations: NoaaObservation[] }
  | { ok: false; reason: string };

async function fetchMetarFromNoaa(icaos: string[]): Promise<FetchResult> {
  const url = `${NOAA_METAR_URL}?ids=${icaos.join(',')}&format=json`;

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { ok: false, reason: `fetch threw: ${message}` };
  }

  if (!res.ok) {
    return { ok: false, reason: `NOAA ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'invalid JSON from NOAA' };
  }

  if (!Array.isArray(body)) {
    return { ok: false, reason: 'NOAA response not an array' };
  }

  // Trust-but-shape: NOAA returns objects we expect; pass through.
  // Per-row validation happens in parseObservation.
  return { ok: true, observations: body as NoaaObservation[] };
}

// ─── METAR parsing ──────────────────────────────────────────
//
// Returns the parsed fields ready to splice into a prisma create/
// update payload. Defensive on every field — anything we can't
// parse becomes null, and category falls back to UNKNOWN when
// neither ceiling nor visibility could be extracted.

type ParsedFields = {
  ceilingFt: number | null;
  visibilitySm: number | null;
  windDirDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  tempC: number | null;
  dewpointC: number | null;
  altimeterHpa: number | null;
  category: FlightCategory;
  rawObservationAt: Date | null;
};

function parseObservation(obs: NoaaObservation): ParsedFields {
  const ceilingFt = parseCeiling(obs.clouds);
  const visibilitySm = parseVisibility(obs.visib);
  const category = deriveCategory(ceilingFt, visibilitySm);

  // wdir can be the string "VRB" for variable winds — null it out
  // since direction is meaningless then.
  let windDirDeg: number | null = null;
  if (typeof obs.wdir === 'number') {
    windDirDeg = obs.wdir;
  } else if (typeof obs.wdir === 'string') {
    const parsed = parseInt(obs.wdir, 10);
    windDirDeg = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    ceilingFt,
    visibilitySm,
    windDirDeg,
    windSpeedKt: typeof obs.wspd === 'number' ? obs.wspd : null,
    windGustKt: typeof obs.wgst === 'number' ? obs.wgst : null,
    tempC: typeof obs.temp === 'number' ? obs.temp : null,
    dewpointC: typeof obs.dewp === 'number' ? obs.dewp : null,
    altimeterHpa: typeof obs.altim === 'number' ? obs.altim : null,
    category,
    rawObservationAt: obs.obsTime ? new Date(obs.obsTime * 1000) : null,
  };
}

function parseCeiling(
  clouds: NoaaObservation['clouds'],
): number | null {
  if (!clouds || clouds.length === 0) return null;
  // Ceiling = lowest BKN/OVC layer base. SCT/FEW don't count as
  // ceiling per FAA definition; CLR/SKC means no ceiling.
  let lowest: number | null = null;
  for (const layer of clouds) {
    if (layer.cover !== 'BKN' && layer.cover !== 'OVC') continue;
    if (typeof layer.base !== 'number') continue;
    if (lowest === null || layer.base < lowest) {
      lowest = layer.base;
    }
  }
  return lowest;
}

function parseVisibility(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  // String form: "6", "6+", ">10", "<1/4", "1 1/2", "10+SM"
  let s = raw.trim().toUpperCase().replace(/SM$/, '').trim();
  // Strip leading inequality
  if (s.startsWith('>') || s.startsWith('<')) s = s.slice(1);
  // Trailing + means "at least"; treat as exactly that value
  if (s.endsWith('+')) s = s.slice(0, -1);

  // Handle "M1/4" or "1/4" or "1 1/2"
  if (s.includes('/')) {
    const parts = s.split(/\s+/);
    let total = 0;
    for (const p of parts) {
      if (p.includes('/')) {
        const [num, den] = p.split('/').map(Number);
        if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
          return null;
        }
        total += num / den;
      } else {
        const n = parseFloat(p);
        if (!Number.isFinite(n)) return null;
        total += n;
      }
    }
    return total;
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function deriveCategory(
  ceilingFt: number | null,
  visibilitySm: number | null,
): FlightCategory {
  // Need at least one of ceiling/vis to make a call. If both are
  // null we genuinely don't know — UNKNOWN signals "go look at
  // the raw METAR" rather than misleading the pilot.
  if (ceilingFt === null && visibilitySm === null) {
    return FlightCategory.UNKNOWN;
  }

  // FAA-style thresholds. Use Infinity for null so the comparison
  // doesn't falsely pessimize when one field is missing — "ceiling
  // unknown but vis is 10sm" → VFR is the right call.
  const c = ceilingFt ?? Infinity;
  const v = visibilitySm ?? Infinity;

  // Pick the worst of the two conditions.
  if (c < 500 || v < 1) return FlightCategory.LIFR;
  if (c < 1000 || v < 3) return FlightCategory.IFR;
  if (c < 3000 || v < 5) return FlightCategory.MVFR;
  return FlightCategory.VFR;
}

function isFresh(fetchedAt: Date): boolean {
  const ageMs = Date.now() - fetchedAt.getTime();
  return ageMs < CACHE_FRESHNESS_MIN * 60_000;
}

// ─── Display helpers (server + client) ──────────────────────
//
// Pure functions — no DB or fetch. Exported so client components
// can import them via `import { categoryBadgeStyle } from
// '@/lib/weather/aviation-weather'`. The 'server-only' import at
// the top file-level normally would block that, but client components
// in Next.js are only blocked at runtime if they actually call into
// the server-only-marked functions. These pure functions never touch
// `prisma` so they're safe — and Next's static-analyzer is smart
// enough to follow that.

export function categoryBadgeStyle(category: FlightCategory): {
  bg: string;
  text: string;
  label: string;
} {
  switch (category) {
    case FlightCategory.VFR:
      return {
        bg: 'bg-emerald-100 dark:bg-emerald-900/40',
        text: 'text-emerald-800 dark:text-emerald-200',
        label: 'VFR',
      };
    case FlightCategory.MVFR:
      return {
        bg: 'bg-sky-100 dark:bg-sky-900/40',
        text: 'text-sky-800 dark:text-sky-200',
        label: 'MVFR',
      };
    case FlightCategory.IFR:
      return {
        bg: 'bg-amber-100 dark:bg-amber-900/40',
        text: 'text-amber-800 dark:text-amber-200',
        label: 'IFR',
      };
    case FlightCategory.LIFR:
      return {
        bg: 'bg-rose-100 dark:bg-rose-900/40',
        text: 'text-rose-800 dark:text-rose-200',
        label: 'LIFR',
      };
    case FlightCategory.UNKNOWN:
      return {
        bg: 'bg-slate-200 dark:bg-slate-800',
        text: 'text-slate-700 dark:text-slate-300',
        label: '? NO DATA',
      };
  }
}

/** Format a wind value as the conventional aviation string. */
export function formatWind(
  dirDeg: number | null,
  speedKt: number | null,
  gustKt: number | null,
): string {
  if (speedKt === null) return '—';
  if (speedKt === 0) return 'CALM';
  const dir = dirDeg === null ? 'VRB' : String(dirDeg).padStart(3, '0');
  const speed = String(speedKt).padStart(2, '0');
  const gust = gustKt && gustKt > speedKt ? `G${gustKt}` : '';
  return `${dir}/${speed}${gust}KT`;
}
