import { getAlternates } from '@vam/db';
import {
  fetchMetarsForIcaos,
  type CachedMetar,
} from '@/lib/metars/fetch-from-bot';

/**
 * Track 5 #18 (Section D) — Alternate-Picker.
 *
 * Server-component die für ein booking die nächsten N commercially-
 * served airports rund um arrival listet, mit weather-info pro
 * alternate. Direkt nach dem WeatherBriefing eingebunden — der
 * pilot sieht: "EDDM ist VFR, falls nicht: hier 6 nearby options".
 *
 * # Data sources
 *
 * Zwei aggregator-calls in einem parallel-Promise.all:
 *   1. getAlternates({arrivalIcao, excludeIcaos: [departureIcao]})
 *      → top-6 airports by distance, mit lat/lon/bearing
 *   2. fetchMetarsForIcaos([alternates...icaos]) → METAR per ICAO
 *      (cached 60s via bot, selber pattern wie WeatherBriefing #16)
 *
 * Beide calls sind cheap genug für serial-Promise.all — der zweite
 * braucht die ICAOs vom ersten. Wir bauen das deshalb sequential
 * (await getAlternates, dann await fetchMetarsForIcaos).
 *
 * # Conditional rendering
 *
 *   - getAlternates returns [] → section hidden (z.B. arrival ist
 *     ein remote outpost ohne nearby commercial airfields)
 *   - METAR-cache leer → cards trotzdem rendern, nur ohne weather-
 *     badges (distance-only info ist immer noch nützlich)
 *
 * # Why excludeIcaos: [departureIcao]?
 *
 * Departure als alternate vorzuschlagen ist trivial-circular. Echte
 * "return-to-origin"-flüge sind selten und der pilot weiß eh dass das
 * eine option ist — kein UI-noise.
 *
 * # Display-rationale
 *
 *   - Distance + bearing: "78nm SE" gibt at-a-glance räumlichen
 *     kontext (kein zwischen-tabs-springen zu maps)
 *   - Flight-category badge: identisch zum WeatherBriefing für
 *     visuelle konsistenz (VFR🟢 / MVFR🔵 / IFR🟠 / LIFR🔴)
 *   - City + country: hilft bei unbekannten ICAOs ("LOWS = Salzburg")
 *   - Type-pill (large/medium): hint auf airport-größe
 */

const FLIGHT_CATEGORY_STYLES: Record<
  'VFR' | 'MVFR' | 'IFR' | 'LIFR',
  string
> = {
  VFR: 'bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300',
  MVFR: 'bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300',
  IFR: 'bg-orange-500/10 border-orange-500/40 text-orange-700 dark:text-orange-300',
  LIFR: 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300',
};

const FLIGHT_CATEGORY_LABELS: Record<'VFR' | 'MVFR' | 'IFR' | 'LIFR', string> =
  {
    VFR: 'VFR',
    MVFR: 'MVFR',
    IFR: 'IFR',
    LIFR: 'LIFR',
  };

const AIRPORT_TYPE_LABELS: Record<string, string> = {
  large_airport: 'Major',
  medium_airport: 'Regional',
  small_airport: 'Klein',
};

export async function AlternatePicker({
  arrivalIcao,
  departureIcao,
}: {
  arrivalIcao: string;
  departureIcao: string;
}) {
  const alternates = await getAlternates({
    arrivalIcao,
    excludeIcaos: [departureIcao],
    limit: 6,
  });
  if (alternates.length === 0) return null;

  const metarCache = await fetchMetarsForIcaos(alternates.map((a) => a.icao));

  return (
    <section className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
          🛬 Alternates für {arrivalIcao}
        </h2>
        <p className="text-[10px] text-gray-400">
          Top {alternates.length}, 30–200 nm
        </p>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {alternates.map((a) => {
          const metar: CachedMetar | null =
            metarCache[a.icao.toUpperCase()] ?? null;
          const category = metar?.decoded?.flightCategory ?? null;
          return (
            <li
              key={a.icao}
              className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-md p-3"
            >
              {/* Header: ICAO + IATA + flight-category badge */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-base font-bold text-gray-900 dark:text-gray-100">
                      {a.icao}
                    </span>
                    {a.iata && (
                      <span className="text-[10px] font-mono text-gray-400">
                        / {a.iata}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                    {a.name}
                  </p>
                  {a.city && (
                    <p className="text-[10px] text-gray-500 truncate">
                      {a.city}
                      {a.country && ` · ${a.country}`}
                    </p>
                  )}
                </div>
                {category && (
                  <span
                    className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${FLIGHT_CATEGORY_STYLES[category]}`}
                    title="Flight Category (FAA) — aktueller METAR"
                  >
                    {FLIGHT_CATEGORY_LABELS[category]}
                  </span>
                )}
              </div>

              {/* Sub-line: distance · bearing · type */}
              <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px] text-gray-600 dark:text-gray-400">
                <span className="font-mono tabular-nums font-semibold">
                  {a.distanceNm} nm
                </span>
                <span className="text-gray-400">·</span>
                <span
                  className="font-mono font-semibold"
                  title={`Bearing ${a.bearingDeg}°`}
                >
                  {a.bearing8}
                </span>
                {a.type && AIRPORT_TYPE_LABELS[a.type] && (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="text-[10px]">
                      {AIRPORT_TYPE_LABELS[a.type]}
                    </span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-gray-400 mt-3">
        Operationelle Auswahl basierend auf <code>scheduledService=true</code>.
        Endgültige alternate-wahl bleibt pilot-decision — verifiziere immer
        TAF + NOTAMs.
      </p>
    </section>
  );
}
