import { prisma } from '@vam/db';

const VATSIM_METAR_BASE = 'https://metar.vatsim.net';
const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 Minuten
const USER_AGENT = 'VAM-System/1.0 (https://vam.kevindrack.de)';

type CachedMetar = {
  icao: string;
  raw: string;
  decoded: DecodedMetar | null;
  fetchedAt: Date;
};

type DecodedMetar = {
  station: string;
  observedAt: string | null; // Day-time string from METAR (e.g. "151220Z")
  wind: {
    direction: number | null; // degrees, null = variable
    speed: number; // knots
    gust: number | null;
    variableFrom: number | null;
    variableTo: number | null;
  } | null;
  visibility: string | null; // "10000", "CAVOK", "9999", "1/2SM"
  weather: string[]; // e.g. ["RA", "FG", "TS"]
  clouds: Array<{
    coverage: string; // FEW, SCT, BKN, OVC
    base: number; // ft
    type: string | null; // CB, TCU
  }>;
  temperature: number | null;
  dewpoint: number | null;
  pressure: {
    qnhHpa: number | null;
    altimeterInHg: number | null;
  };
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' | null;
};

let metarCache: Map<string, CachedMetar> = new Map();

export function getCachedMetars(): Record<string, CachedMetar> {
  const result: Record<string, CachedMetar> = {};
  for (const [icao, metar] of metarCache) {
    result[icao] = metar;
  }
  return result;
}

export function getCachedMetar(icao: string): CachedMetar | null {
  return metarCache.get(icao.toUpperCase()) ?? null;
}

async function fetchMetar(icao: string): Promise<string | null> {
  try {
    const res = await fetch(`${VATSIM_METAR_BASE}/${icao}`, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    // VATSIM kann mehrere Zeilen zurückgeben - nur die erste passende
    const firstLine = trimmed.split('\n').find((l) => l.includes(icao.toUpperCase()));
    return firstLine?.trim() ?? trimmed.split('\n')[0]?.trim() ?? null;
  } catch (err) {
    console.error(`[METAR-Tracker] Fetch failed for ${icao}:`, err);
    return null;
  }
}

async function pollMetars(): Promise<void> {
  try {
    // Sammle alle Airports die wir tracken sollen:
    // 1. Alle Airports in unserer DB
    // 2. Plus alle Departure/Arrival aus aktiven Member-LiveSessions
    const dbAirports = await prisma.airport.findMany({
      select: { icao: true },
    });

    const sessionAirports = await prisma.liveSession.findMany({
      where: { isActive: true },
      select: { departureIcao: true, arrivalIcao: true, alternateIcao: true },
    });

    const icaoSet = new Set<string>();
    for (const a of dbAirports) {
      icaoSet.add(a.icao.toUpperCase());
    }
    for (const s of sessionAirports) {
      if (s.departureIcao) icaoSet.add(s.departureIcao.toUpperCase());
      if (s.arrivalIcao) icaoSet.add(s.arrivalIcao.toUpperCase());
      if (s.alternateIcao) icaoSet.add(s.alternateIcao.toUpperCase());
    }

    if (icaoSet.size === 0) return;

    const icaos = Array.from(icaoSet);
    const newCache = new Map<string, CachedMetar>();

    // Sequenziell mit kleinem Delay um VATSIM nicht zu hämmern
    for (const icao of icaos) {
      const raw = await fetchMetar(icao);
      if (raw) {
        const decoded = decodeMetar(raw);
        newCache.set(icao, {
          icao,
          raw,
          decoded,
          fetchedAt: new Date(),
        });
      }
      // 100ms Pause zwischen Requests
      await new Promise((r) => setTimeout(r, 100));
    }

    metarCache = newCache;

    console.log(
      `[METAR-Tracker] Polled ${icaos.length} airports, got ${newCache.size} METARs`,
    );
  } catch (err) {
    console.error('[METAR-Tracker] Poll error:', err);
  }
}

/**
 * Parse a raw METAR string into structured fields.
 * Best-effort decoder - covers the most common formats.
 */
function decodeMetar(raw: string): DecodedMetar | null {
  try {
    // Strip leading "METAR " or "SPECI "
    let s = raw.replace(/^(METAR|SPECI)\s+/i, '').trim();
    const parts = s.split(/\s+/);
    if (parts.length < 3) return null;

    const station = parts[0];
    const observedAt = parts[1]?.match(/^\d{6}Z$/) ? parts[1] : null;

    // Find wind: NNN(VRB)KT or NNNN with optional gust GNN
    let wind: DecodedMetar['wind'] = null;
    const windMatch = s.match(/(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT/);
    if (windMatch) {
      const direction = windMatch[1] === 'VRB' ? null : parseInt(windMatch[1], 10);
      const speed = parseInt(windMatch[2], 10);
      const gust = windMatch[4] ? parseInt(windMatch[4], 10) : null;
      wind = { direction, speed, gust, variableFrom: null, variableTo: null };

      // Variable wind range: 220V280 (nur wenn standalone, nicht innerhalb anderer Codes wie RVR)
      const varMatch = s.match(/\s(\d{3})V(\d{3})\s/);
      if (varMatch && wind) {
        wind.variableFrom = parseInt(varMatch[1], 10);
        wind.variableTo = parseInt(varMatch[2], 10);
      }
    }

    // Visibility
    let visibility: string | null = null;
    if (s.includes('CAVOK')) {
      visibility = 'CAVOK';
    } else {
      const visMatch = s.match(/\s(\d{4})\s/) || s.match(/\s(\d+(\/\d+)?SM)\s/);
      if (visMatch) visibility = visMatch[1];
    }

    // Weather phenomena (RA, SN, FG, TS, etc.)
    const weatherCodes = [
      '+TSRA', '-TSRA', 'TSRA', '+RA', '-RA', 'RA', '+SN', '-SN', 'SN',
      'FG', 'BR', 'HZ', 'TS', 'GR', 'GS', 'DZ', 'IC', 'PL', 'SHRA', 'SHSN',
      'BCFG', 'MIFG', 'VCFG', 'VCSH', 'VCTS',
    ];
    const weather: string[] = [];
    for (const code of weatherCodes) {
      const re = new RegExp(`\\s${code.replace(/[+]/g, '\\+')}\\s`);
      if (re.test(' ' + s + ' ') && !weather.includes(code)) {
        weather.push(code);
      }
    }

    // Clouds: FEW040, SCT080, BKN200CB, OVC100TCU
    const clouds: DecodedMetar['clouds'] = [];
    const cloudRegex = /(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?/g;
    let cm: RegExpExecArray | null;
    while ((cm = cloudRegex.exec(s)) !== null) {
      clouds.push({
        coverage: cm[1],
        base: parseInt(cm[2], 10) * 100,
        type: cm[3] ?? null,
      });
    }
    // NSC / NCD = no clouds
    if (s.match(/\s(NSC|NCD|SKC|CLR)\s/)) {
      // leave clouds empty
    }

    // Temperature/Dewpoint: M01/M07 or 15/12
    let temperature: number | null = null;
    let dewpoint: number | null = null;
    const tempMatch = s.match(/\s(M?\d{2})\/(M?\d{2})\s/);
    if (tempMatch) {
      temperature = parseInt(tempMatch[1].replace('M', '-'), 10);
      dewpoint = parseInt(tempMatch[2].replace('M', '-'), 10);
    }

    // Pressure: Q1015 (hPa) or A2992 (inHg×100)
    let qnhHpa: number | null = null;
    let altimeterInHg: number | null = null;
    const qMatch = s.match(/Q(\d{4})/);
    if (qMatch) qnhHpa = parseInt(qMatch[1], 10);
    const aMatch = s.match(/A(\d{4})/);
    if (aMatch) altimeterInHg = parseInt(aMatch[1], 10) / 100;

    // Flight Category aus Visibility + Cloud-Base ableiten
    const flightCategory = computeFlightCategory(visibility, clouds);

    return {
      station,
      observedAt,
      wind,
      visibility,
      weather,
      clouds,
      temperature,
      dewpoint,
      pressure: { qnhHpa, altimeterInHg },
      flightCategory,
    };
  } catch (err) {
    console.error('[METAR-Tracker] Decode error:', err);
    return null;
  }
}

function computeFlightCategory(
  visibility: string | null,
  clouds: DecodedMetar['clouds'],
): DecodedMetar['flightCategory'] {
  // Lowest ceiling (BKN/OVC bases)
  const ceilings = clouds
    .filter((c) => c.coverage === 'BKN' || c.coverage === 'OVC')
    .map((c) => c.base);
  const lowestCeiling = ceilings.length > 0 ? Math.min(...ceilings) : Infinity;

  // Visibility in statute miles (FAA standard)
  let visMiles = Infinity;
  if (visibility === 'CAVOK') visMiles = 6.5;
  else if (visibility?.endsWith('SM')) {
    const num = parseFloat(visibility.replace('SM', ''));
    if (!isNaN(num)) visMiles = num;
  } else if (visibility) {
    const meters = parseInt(visibility, 10);
    if (!isNaN(meters)) visMiles = meters / 1609.344;
  }

  // FAA Flight Category rules
  if (lowestCeiling < 500 || visMiles < 1) return 'LIFR';
  if (lowestCeiling < 1000 || visMiles < 3) return 'IFR';
  if (lowestCeiling <= 3000 || visMiles <= 5) return 'MVFR';
  return 'VFR';
}

export function startMetarTracker(): void {
  console.log(`[METAR-Tracker] Starting (poll interval: ${POLL_INTERVAL_MS / 1000 / 60}min)`);
  // Erste Abfrage nach 5 Sekunden Delay (damit andere Tracker erst Sessions haben)
  setTimeout(() => {
    void pollMetars();
  }, 5000);
  // Dann alle 10 Min
  setInterval(() => {
    void pollMetars();
  }, POLL_INTERVAL_MS);
}