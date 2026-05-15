import { type FlightCategory, type AirportWeather } from '@vam/db';
import { categoryBadgeStyle, formatWind } from '@/lib/weather/aviation-weather';

/**
 * Welle P / P1 — Compact weather badge for dispatch/booking surfaces.
 *
 * Server component (no useState/useEffect). Renders a colored
 * FlightCategory pill plus a few optional summary fields. Caller
 * controls density via the `compact` prop:
 *
 *   compact=true  →  just the category pill (for table cells, lists)
 *   compact=false →  pill + ICAO + ceiling/vis + wind (for cards)
 *
 * # Null-safety
 *
 * `weather` is null when getAirportWeather returned a failure (no
 * METAR for this airport, fetch threw with no stale cache). The
 * badge renders a neutral "—" placeholder rather than disappearing,
 * so a missing METAR doesn't break the surrounding layout.
 */
export function WeatherBadge({
  weather,
  icao,
  isStale = false,
  compact = false,
}: {
  weather: AirportWeather | null;
  icao: string;
  isStale?: boolean;
  compact?: boolean;
}) {
  if (!weather) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
        title={`Keine METAR-daten für ${icao}`}
      >
        {icao} —
      </span>
    );
  }

  const style = categoryBadgeStyle(weather.category as FlightCategory);

  if (compact) {
    // Tight pill for table cells. Title-attr surfaces the raw METAR
    // on hover so the pilot can drill into the details without
    // expanding the row.
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style.bg} ${style.text} ${isStale ? 'opacity-70' : ''}`}
        title={`${icao} — ${weather.metarRaw}${isStale ? '\n\n(stale cache)' : ''}`}
      >
        {style.label}
        {isStale && <span aria-label="stale">⏳</span>}
      </span>
    );
  }

  // Expanded form. Renders a small card with the key METAR fields.
  return (
    <div
      className={`rounded-md border border-border bg-card p-3 text-xs ${isStale ? 'opacity-80' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold">{icao}</span>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style.bg} ${style.text}`}
          >
            {style.label}
          </span>
        </div>
        {isStale && (
          <span
            className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400"
            title="Cache abgelaufen — upstream nicht erreicht"
          >
            ⏳ Stale
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
        <dt>Wind</dt>
        <dd className="text-right font-mono">
          {formatWind(weather.windDirDeg, weather.windSpeedKt, weather.windGustKt)}
        </dd>
        <dt>Ceiling</dt>
        <dd className="text-right font-mono">
          {weather.ceilingFt !== null
            ? `${weather.ceilingFt.toLocaleString('de-DE')} ft`
            : '—'}
        </dd>
        <dt>Visibility</dt>
        <dd className="text-right font-mono">
          {weather.visibilitySm !== null
            ? `${weather.visibilitySm.toFixed(1)} sm`
            : '—'}
        </dd>
        <dt>Temp / Dew</dt>
        <dd className="text-right font-mono">
          {weather.tempC !== null ? `${weather.tempC.toFixed(0)}°` : '—'}
          {' / '}
          {weather.dewpointC !== null ? `${weather.dewpointC.toFixed(0)}°` : '—'}
        </dd>
        <dt>QNH</dt>
        <dd className="text-right font-mono">
          {weather.altimeterHpa !== null
            ? `${weather.altimeterHpa.toFixed(0)} hPa`
            : '—'}
        </dd>
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground">
          Raw METAR
        </summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/30 p-2 font-mono text-[10px]">
          {weather.metarRaw}
        </pre>
      </details>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Observed{' '}
        {weather.rawObservationAt
          ? weather.rawObservationAt.toLocaleString('de-DE', {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : '—'}
        {' · cached '}
        {weather.fetchedAt.toLocaleString('de-DE', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}
      </p>
    </div>
  );
}
