import {
  fetchMetarsForIcaos,
  type CachedMetar,
  type DecodedMetar,
} from '@/lib/metars/fetch-from-bot';

/**
 * Track 5 #16 (Section D) — Weather Briefing.
 *
 * Server-component, rendert METAR-cards für departure + arrival eines
 * bookings. Direkt unter dem RoutePreviewMap eingebunden — räumlicher
 * kontext "wo flieg ich hin" + meteorologischer kontext "wie sieht's
 * dort aus" gehören zusammen.
 *
 * # Data-source
 *
 * Reuse vom existierenden bot-METAR-cache (lib/metars/fetch-from-bot.ts,
 * Track 1 #8 Phase 5). Der bot pollt VATSIM's METAR-feed alle 10min und
 * decoded via metar-parser inkl. flight-category. Web macht hier nur
 * einen cached HTTP-call zum bot (revalidate 60s).
 *
 *   - Bot down → fetchMetarsForIcaos returnt {} → wir zeigen einen
 *     dezenten "Wetter aktuell nicht abrufbar"-hint statt die ganze
 *     section zu verstecken (UX-prinzip: feature-discovery > clean-empty)
 *   - ICAO nicht im cache (kleines airfield ohne METAR-feed) →
 *     placeholder-card "Keine Wetterdaten verfügbar"
 *
 * # Forecast (TAF)?
 *
 * V1 zeigt nur current METAR. TAF (terminal forecast) wäre für
 * "weather-aware booking" theoretisch besser weil der pilot oft für
 * später bucht — aber TAF parsing ist deutlich komplexer (BECMG/TEMPO/
 * PROB-gruppen), und der bot cached aktuell keine TAF-daten. V2-feature.
 *
 * # Display-rationale
 *
 * Vier infos pro airport in einer kompakt-card:
 *   1. Flight-category-badge — at-a-glance "kann ich fliegen?"
 *      VFR🟢 / MVFR🔵 / IFR🟠 / LIFR🔴
 *   2. Wind — meistens flugentscheidend (crosswind-limits, gusty)
 *   3. Ceiling + visibility — sichtweite und wolkenuntergrenze
 *   4. Temp/dewpoint + QNH — vereisungsgefahr, druckanzeige
 *
 * Raw METAR ist im <details> versteckt für die pilots die's pur lesen
 * wollen.
 */

const FLIGHT_CATEGORY_STYLES: Record<
  'VFR' | 'MVFR' | 'IFR' | 'LIFR',
  string
> = {
  // VFR = "kann ich fliegen ohne instruments" → green
  VFR: 'bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300',
  // MVFR = marginal VFR, brauche aufmerksamkeit → blue
  MVFR: 'bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300',
  // IFR = instruments needed, anspruchsvoll → orange
  IFR: 'bg-orange-500/10 border-orange-500/40 text-orange-700 dark:text-orange-300',
  // LIFR = low IFR, an der grenze des fliegbaren → red
  LIFR: 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300',
};

const FLIGHT_CATEGORY_LABELS: Record<'VFR' | 'MVFR' | 'IFR' | 'LIFR', string> =
  {
    VFR: 'VFR · klar',
    MVFR: 'MVFR · marginal',
    IFR: 'IFR · instrumente',
    LIFR: 'LIFR · grenzwertig',
  };

export async function WeatherBriefing({
  departureIcao,
  arrivalIcao,
}: {
  departureIcao: string;
  arrivalIcao: string;
}) {
  // Beide ICAOs in einem call. fetchMetarsForIcaos cached 60s im
  // Next-fetch-layer, also auch wenn die page hot-reloaded wird oder
  // mehrere user gleichzeitig die selbe booking-page öffnen kommt nur
  // 1x request beim bot an.
  const cache = await fetchMetarsForIcaos([departureIcao, arrivalIcao]);

  const depMetar = cache[departureIcao.toUpperCase()] ?? null;
  const arrMetar = cache[arrivalIcao.toUpperCase()] ?? null;

  // Wenn der bot komplett unreachable ist returns fetchMetarsForIcaos
  // ein leeres dict. Sieht für uns aus wie "weder DEP noch ARR im cache".
  // Wir zeigen dann statt 2 placeholder-cards einen einzigen dezenten
  // hint — weniger visuelles rauschen, klarere ursache.
  const bothMissing = depMetar === null && arrMetar === null;

  return (
    <section className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
          🌦️ Wetter (METAR)
        </h2>
        {!bothMissing && (
          <p className="text-[10px] text-gray-400 tabular-nums">
            Aktuelle Bedingungen — automatisch aktualisiert
          </p>
        )}
      </div>

      {bothMissing ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
          Wetterdaten sind aktuell nicht abrufbar. Versuche es in ein paar
          Minuten erneut, oder schau direkt bei{' '}
          <a
            href={`https://aviationweather.gov/metar?ids=${departureIcao},${arrivalIcao}&hours=0&taf=true`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            aviationweather.gov ↗
          </a>
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MetarCard label="Departure" icao={departureIcao} metar={depMetar} />
          <MetarCard label="Arrival" icao={arrivalIcao} metar={arrMetar} />
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Single airport METAR card
// ─────────────────────────────────────────────────────────────────────

function MetarCard({
  label,
  icao,
  metar,
}: {
  label: string;
  icao: string;
  metar: CachedMetar | null;
}) {
  if (!metar || !metar.decoded) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800/40 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            {label}
          </p>
          <p className="font-mono text-sm font-bold text-gray-400">{icao}</p>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          Keine Wetterdaten verfügbar
        </p>
        <p className="text-[10px] text-gray-400 mt-1">
          Dieser Flughafen sendet keinen METAR oder ist nicht im Cache.
        </p>
      </div>
    );
  }

  const d = metar.decoded;
  const category = d.flightCategory;
  const categoryStyles = category ? FLIGHT_CATEGORY_STYLES[category] : null;
  const categoryLabel = category ? FLIGHT_CATEGORY_LABELS[category] : null;

  return (
    <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      {/* Header: label + ICAO + flight-category-badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            {label}
          </p>
          <p className="font-mono text-base font-bold mt-0.5">{icao}</p>
        </div>
        {category && categoryStyles && categoryLabel && (
          <span
            className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${categoryStyles}`}
            title="Flight Category (FAA): VFR / MVFR / IFR / LIFR"
          >
            {categoryLabel}
          </span>
        )}
      </div>

      {/* Decoded fields */}
      <dl className="space-y-1.5 text-xs">
        <DecodedRow label="Wind" value={formatWind(d.wind)} mono />
        <DecodedRow label="Sicht" value={formatVisibility(d.visibility)} mono />
        <DecodedRow label="Wolken" value={formatCeiling(d.clouds)} mono />
        <DecodedRow label="Temp" value={formatTemp(d)} mono />
        <DecodedRow label="QNH" value={formatPressure(d.pressure)} mono />
        {d.weather.length > 0 && (
          <DecodedRow label="Wetter" value={d.weather.join(', ')} mono />
        )}
      </dl>

      {/* Raw METAR + observation timestamp */}
      <details className="mt-3 group">
        <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 select-none flex items-center gap-1">
          <span className="group-open:hidden">▸</span>
          <span className="hidden group-open:inline">▾</span>
          Raw METAR
          {d.observedAt && (
            <span className="ml-auto text-gray-400 tabular-nums">
              Stand: {formatObservedRelative(d.observedAt)}
            </span>
          )}
        </summary>
        <pre className="mt-2 text-[10px] font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
          {metar.raw}
        </pre>
      </details>
    </div>
  );
}

function DecodedRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-gray-500 dark:text-gray-400 w-14 shrink-0">{label}</dt>
      <dd
        className={`text-gray-800 dark:text-gray-200 ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

function formatWind(wind: DecodedMetar['wind']): string {
  if (!wind) return 'Windstill';
  const { direction, speed, gust, variableFrom, variableTo } = wind;

  // VRB winds (variableFrom/To set, oder direction=null mit speed<3)
  if (direction === null && speed < 3) return 'Windstill';
  if (direction === null && variableFrom !== null && variableTo !== null) {
    return `VRB ${variableFrom}–${variableTo}° @ ${speed} kt`;
  }
  if (direction === null) return `VRB @ ${speed} kt`;

  const dirStr = String(direction).padStart(3, '0');
  const gustStr = gust !== null ? `G${gust}` : '';
  const variableSuffix =
    variableFrom !== null && variableTo !== null
      ? ` (VRB ${variableFrom}–${variableTo}°)`
      : '';
  return `${dirStr}° @ ${speed}${gustStr} kt${variableSuffix}`;
}

function formatVisibility(visibility: string | null): string {
  if (!visibility) return '—';
  // Parser-output ist schon eine schöne string — z.B. "10SM", "9999",
  // "5000", "1 1/2SM". Wir reichen's einfach durch. Nicht aufwendig
  // umrechnen weil die meisten pilots beide einheiten kennen.
  return visibility;
}

function formatCeiling(clouds: DecodedMetar['clouds']): string {
  if (clouds.length === 0) return 'klar (SKC/CAVOK)';

  // Ceiling = niedrigste BKN/OVC/OVX layer. FEW/SCT sind keine ceiling.
  const ceilingLayer = clouds.find((c) =>
    ['BKN', 'OVC', 'OVX', 'VV'].includes(c.coverage),
  );

  if (!ceilingLayer) {
    // Nur FEW/SCT → kein ceiling, aber wolken da. Zeig die niedrigste.
    const lowest = clouds.reduce((min, c) => (c.base < min.base ? c : min));
    return `${lowest.coverage} ${lowest.base} ft (kein Ceiling)`;
  }

  return `${ceilingLayer.coverage} ${ceilingLayer.base} ft`;
}

function formatTemp(d: DecodedMetar): string {
  const t = d.temperature;
  const dp = d.dewpoint;
  if (t === null && dp === null) return '—';
  const tStr = t !== null ? `${t}°C` : '—';
  const dpStr = dp !== null ? `${dp}°C` : '—';
  // Spread-hint: bei spread <=3°C wachsende nebelgefahr
  const spreadHint =
    t !== null && dp !== null && t - dp <= 3 && t - dp >= 0 ? ' ⚠ Nebel' : '';
  return `${tStr} / ${dpStr}${spreadHint}`;
}

function formatPressure(pressure: DecodedMetar['pressure']): string {
  const { qnhHpa, altimeterInHg } = pressure;
  if (qnhHpa !== null && altimeterInHg !== null) {
    return `${qnhHpa} hPa / ${altimeterInHg.toFixed(2)} inHg`;
  }
  if (qnhHpa !== null) return `${qnhHpa} hPa`;
  if (altimeterInHg !== null) return `${altimeterInHg.toFixed(2)} inHg`;
  return '—';
}

/**
 * "vor 12min" / "vor 2h" — analog zum activity-feed formatter.
 * Bei METARs sollte das fast immer <60min sein (bot pollt alle 10min,
 * fetch revalidates 60s), aber defensive.
 */
function formatObservedRelative(observedAt: string): string {
  const observedMs = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs)) return '—';
  const diffMs = Date.now() - observedMs;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH}h`;
  return new Date(observedAt).toLocaleString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}
