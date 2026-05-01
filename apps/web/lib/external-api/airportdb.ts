/**
 * AirportDB.io API Client (Pfad C — Fallback-Enrichment)
 * =======================================================
 *
 * VAMs primärer airport-katalog kommt aus dem OurAirports.com bulk-import
 * (~85k airports + 47k runways + 30k freqs + 11k navaids). AirportDB.io
 * wird NUR als fallback genutzt für AirportRequests die NICHT in OurAirports
 * waren — z.B. private/military airports, neu eröffnete oder sehr seltene
 * fields die in OurAirports fehlen.
 *
 * Erwarteter call-frequency: 0-5 calls/monat (admin-approval von rare ICAOs).
 * Daher kein bottleneck/queue nötig — einzelner timeout-gated fetch reicht.
 *
 * Datenquelle: https://airportdb.io (single-dev hobby project von epranka,
 * basierend auf OurAirports). Daten-format ist analog zu OurAirports — wir
 * mappen nur die felder die wir in unseren detail-tables (Runway,
 * AirportFrequency, Navaid) brauchen.
 *
 * Auth: API-token via query-param `apiToken=...`. Token kommt aus env-var
 * AIRPORTDB_API_TOKEN. Wenn unset → enrichment ist disabled, alle calls
 * geben null zurück (graceful degradation).
 *
 * Endpoint format: GET https://airportdb.io/api/v1/airport/{ICAO}?apiToken={TOKEN}
 *   Returns: 200 mit airport-detail-json oder 404 wenn ICAO unbekannt.
 *   Response shape ist locker basierend auf OurAirports — wir parsen
 *   defensiv und tolerieren fehlende felder.
 */

const AIRPORTDB_BASE_URL = 'https://airportdb.io/api/v1/airport';
const FETCH_TIMEOUT_MS = 8000; // 8s — generous für hobby-service

// ────────────────────────────────────────────────────────────────────────
// Response-typen (defensive, alle felder optional)
// ────────────────────────────────────────────────────────────────────────

/**
 * Roh-response von AirportDB.io. Felder analog zu OurAirports CSV-spalten,
 * aber als nested JSON. Alle felder optional weil das hobby-service kein
 * formelles schema-contract hat — wir validieren defensiv.
 */
export interface AirportDbResponse {
  ident?: string;
  type?: string;
  name?: string;
  latitude_deg?: number | string;
  longitude_deg?: number | string;
  elevation_ft?: number | string | null;
  continent?: string;
  iso_country?: string;
  iso_region?: string;
  municipality?: string;
  scheduled_service?: string;
  icao_code?: string;
  iata_code?: string;
  gps_code?: string;
  local_code?: string;
  home_link?: string;
  wikipedia_link?: string;

  runways?: AirportDbRunway[];
  freqs?: AirportDbFrequency[];
  // Falls AirportDB.io einen anderen key nutzt:
  frequencies?: AirportDbFrequency[];
  navaids?: AirportDbNavaid[];

  // Nested country/region info — wir nutzen das nicht, aber lassen es zu
  country?: unknown;
  region?: unknown;
}

export interface AirportDbRunway {
  id?: number | string;
  length_ft?: number | string | null;
  width_ft?: number | string | null;
  surface?: string;
  lighted?: boolean | number | string;
  closed?: boolean | number | string;

  le_ident?: string;
  le_latitude_deg?: number | string | null;
  le_longitude_deg?: number | string | null;
  le_elevation_ft?: number | string | null;
  le_heading_degT?: number | string | null;
  le_displaced_threshold_ft?: number | string | null;

  he_ident?: string;
  he_latitude_deg?: number | string | null;
  he_longitude_deg?: number | string | null;
  he_elevation_ft?: number | string | null;
  he_heading_degT?: number | string | null;
  he_displaced_threshold_ft?: number | string | null;
}

export interface AirportDbFrequency {
  id?: number | string;
  type?: string;
  description?: string;
  frequency_mhz?: number | string;
}

export interface AirportDbNavaid {
  id?: number | string;
  filename?: string;
  ident?: string;
  name?: string;
  type?: string;
  frequency_khz?: number | string | null;
  latitude_deg?: number | string;
  longitude_deg?: number | string;
  elevation_ft?: number | string | null;
  iso_country?: string;
  dme_frequency_khz?: number | string | null;
  dme_channel?: string;
  dme_latitude_deg?: number | string | null;
  dme_longitude_deg?: number | string | null;
  dme_elevation_ft?: number | string | null;
  slaved_variation_deg?: number | string | null;
  magnetic_variation_deg?: number | string | null;
  usageType?: string;
  power?: string;
  associated_airport?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Whether the fallback is configured. Used to decide if an enrichment
 * attempt is worth making — without a token, we'd just hit 401.
 */
export function isAirportDbEnabled(): boolean {
  return !!process.env.AIRPORTDB_API_TOKEN?.trim();
}

/**
 * Fetcht airport-detail-data von AirportDB.io für einen ICAO-code.
 * Returns null wenn:
 *   - Kein token konfiguriert ist (graceful degradation)
 *   - HTTP non-2xx (404 = unknown ICAO ist erwartet, kein error)
 *   - Network-fehler oder timeout
 *   - Response ist nicht valides JSON
 *
 * Throws nie — der caller (approveAirportRequest) soll bei null einfach
 * weitermachen ohne enrichment.
 */
export async function fetchAirportDb(
  icao: string,
): Promise<AirportDbResponse | null> {
  const token = process.env.AIRPORTDB_API_TOKEN?.trim();
  if (!token) {
    console.info(
      `[airportdb] AIRPORTDB_API_TOKEN unset, skipping enrichment for ${icao}`,
    );
    return null;
  }

  // Sanitize: ICAO codes sind 4-letter-uppercase (oder mit ziffern für US locals)
  const safe = icao.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,7}$/.test(safe)) {
    console.warn(`[airportdb] Skipping invalid ICAO format: ${icao}`);
    return null;
  }

  const url = `${AIRPORTDB_BASE_URL}/${encodeURIComponent(safe)}?apiToken=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      // Cache-control: NO. Approval-flow ist write-path, kein caching nötig.
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      // 404 ist erwartet für rare/unknown ICAOs — kein logging
      if (response.status !== 404) {
        console.warn(
          `[airportdb] HTTP ${response.status} for ${safe}: ${response.statusText}`,
        );
      }
      return null;
    }

    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null) {
      console.warn(`[airportdb] Non-object response for ${safe}`);
      return null;
    }

    return data as AirportDbResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted')) {
      console.warn(`[airportdb] Timeout (${FETCH_TIMEOUT_MS}ms) for ${safe}`);
    } else {
      console.warn(`[airportdb] Fetch failed for ${safe}: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Mapping-helper: AirportDB-response → Prisma-create-shapes
// ────────────────────────────────────────────────────────────────────────

/**
 * Defensive number-parser: akzeptiert number, string-number, oder null/undefined.
 * Returns null wenn nicht parsebar — wir wollen NICHT abstürzen wenn das
 * hobby-service mal einen edge-case schickt.
 */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  return Math.trunc(n);
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed || null;
}

/**
 * Mappt AirportDb runways → Prisma Runway.create shapes (ohne id/airportIcao,
 * die der caller hinzufügt). Filtert null/invalid rows raus.
 */
export function mapAirportDbRunways(
  runways: AirportDbRunway[] | undefined,
): Array<{
  lengthFt: number | null;
  widthFt: number | null;
  surface: string | null;
  lighted: boolean;
  closed: boolean;
  leIdent: string | null;
  leLatitude: number | null;
  leLongitude: number | null;
  leElevationFt: number | null;
  leHeadingDegT: number | null;
  leDisplacedFt: number | null;
  heIdent: string | null;
  heLatitude: number | null;
  heLongitude: number | null;
  heElevationFt: number | null;
  heHeadingDegT: number | null;
  heDisplacedFt: number | null;
}> {
  if (!Array.isArray(runways)) return [];
  return runways.map((r) => ({
    lengthFt: int(r.length_ft),
    widthFt: int(r.width_ft),
    surface: str(r.surface),
    lighted: bool(r.lighted),
    closed: bool(r.closed),
    leIdent: str(r.le_ident),
    leLatitude: num(r.le_latitude_deg),
    leLongitude: num(r.le_longitude_deg),
    leElevationFt: int(r.le_elevation_ft),
    leHeadingDegT: num(r.le_heading_degT),
    leDisplacedFt: int(r.le_displaced_threshold_ft),
    heIdent: str(r.he_ident),
    heLatitude: num(r.he_latitude_deg),
    heLongitude: num(r.he_longitude_deg),
    heElevationFt: int(r.he_elevation_ft),
    heHeadingDegT: num(r.he_heading_degT),
    heDisplacedFt: int(r.he_displaced_threshold_ft),
  }));
}

/**
 * Mappt AirportDb frequencies → Prisma AirportFrequency.create shapes.
 * Filtert rows ohne type oder frequency raus (beide required).
 */
export function mapAirportDbFrequencies(
  freqs: AirportDbFrequency[] | undefined,
): Array<{
  type: string;
  description: string | null;
  frequencyMhz: number;
}> {
  if (!Array.isArray(freqs)) return [];
  return freqs
    .map((f) => {
      const type = str(f.type);
      const frequencyMhz = num(f.frequency_mhz);
      if (!type || frequencyMhz === null) return null;
      return {
        type,
        description: str(f.description),
        frequencyMhz,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Mappt AirportDb navaids → Prisma Navaid.create shapes (ohne id, mit
 * associatedAirportIcao das der caller setzt). Filtert rows ohne ident/
 * type/coordinates raus.
 */
export function mapAirportDbNavaids(
  navaids: AirportDbNavaid[] | undefined,
): Array<{
  ident: string;
  name: string;
  type: string;
  frequencyKhz: number | null;
  latitude: number;
  longitude: number;
  elevationFt: number | null;
  isoCountry: string;
  dmeFrequencyKhz: number | null;
  dmeChannel: string | null;
  dmeLatitude: number | null;
  dmeLongitude: number | null;
  dmeElevationFt: number | null;
  slavedVariationDeg: number | null;
  magneticVariationDeg: number | null;
  usageType: string | null;
  power: string | null;
}> {
  if (!Array.isArray(navaids)) return [];
  return navaids
    .map((n) => {
      const ident = str(n.ident);
      const type = str(n.type);
      const latitude = num(n.latitude_deg);
      const longitude = num(n.longitude_deg);
      if (!ident || !type || latitude === null || longitude === null) {
        return null;
      }
      return {
        ident,
        name: str(n.name) ?? ident,
        type,
        frequencyKhz: int(n.frequency_khz),
        latitude,
        longitude,
        elevationFt: int(n.elevation_ft),
        isoCountry: str(n.iso_country) ?? 'XX',
        dmeFrequencyKhz: int(n.dme_frequency_khz),
        dmeChannel: str(n.dme_channel),
        dmeLatitude: num(n.dme_latitude_deg),
        dmeLongitude: num(n.dme_longitude_deg),
        dmeElevationFt: int(n.dme_elevation_ft),
        slavedVariationDeg: num(n.slaved_variation_deg),
        magneticVariationDeg: num(n.magnetic_variation_deg),
        usageType: str(n.usageType),
        power: str(n.power),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
