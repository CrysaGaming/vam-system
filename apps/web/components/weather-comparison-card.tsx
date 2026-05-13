import type { ReactNode } from 'react';
import { Cloud, Wind, Thermometer, Gauge } from 'lucide-react';

/**
 * Welle B — B1 phase 3. PIREP weather comparison card. Renders sim-side
 * environment values (captured in LiveSession by the heartbeat path
 * from the BAROMETER PRESSURE / AMBIENT WIND / AMBIENT TEMPERATURE
 * simvars) side-by-side against the real-world METAR for the arrival
 * airport at flight-end-time. Lets pilots see how realistic their sim's
 * weather engine was vs. ground-truth observations.
 *
 * Why arrival (not cruise) for the v1 comparison: METAR is a ground-
 * level observation. Comparing a cruise-altitude wind reading against
 * a ground-station METAR would be apples-to-oranges (winds aloft are
 * dramatically different from surface winds). Phase 3 v1 captures
 * weather at flight-end via the BLOCK_ON heartbeat's environment block;
 * future phase work could extend with departure-METAR comparison or
 * winds-aloft data from NCEP for proper cruise comparison.
 *
 * # Data sources
 *
 * - **Sim side** (left column): `LiveSession.windSpeedKts`,
 *   `windDirection`, `oatCelsius`, `ambientPressureMb` — the most-recent
 *   values captured by the heartbeat-route from the
 *   `data.environment.*` block. These get overwritten by every
 *   heartbeat, so at PIREP-creation time (triggered by BLOCK_ON)
 *   they reflect taxi-in/arrival conditions.
 *
 * - **Real side** (right column): decoded METAR for the arrival ICAO
 *   from the bot's METAR cache (10-min refresh, see
 *   `apps/web/lib/metars/fetch-from-bot.ts`). Decoded shape matches the
 *   `DecodedMetar` type — wind / temperature / pressure split into the
 *   same units the sim reports.
 *
 * # Accuracy heuristic
 *
 * The "accuracy" badge is a coarse summary score, NOT a precise
 * metric. It compares each of the four available dimensions
 * (wind speed, wind direction, OAT, QNH) and counts how many are
 * "close" by a per-dimension tolerance:
 *
 *   - Wind speed:     within ±10 kts → close
 *   - Wind direction: within ±20°    → close (with wrap-around)
 *   - OAT:            within ±5°C    → close
 *   - QNH:            within ±5 mb   → close
 *
 * Score = (close_count / available_count) × 100. The thresholds are
 * intentionally generous so that "the sim got it broadly right" reads
 * as accurate; pilots get a feel for sim realism rather than a strict
 * pass/fail.
 *
 * # When the card is hidden
 *
 * The caller (PIREP detail page) only renders this card when both sides
 * have at least one field. If sim data is missing entirely (pre-B1
 * client, or a manual PIREP without an ACARS session) the page skips
 * the card. If METAR is missing (bot down, or arrival airport has no
 * VATSIM weather report) but sim data exists, we render the card
 * showing only sim values with a muted note explaining why real values
 * are absent — better than hiding the section entirely and confusing
 * the pilot.
 */

/**
 * Sim-side weather snapshot. All fields nullable because the older
 * heartbeat schema only had wind/oat and was missing pressure, plus
 * the client may have lost SimConnect mid-flight before populating any.
 * Renders as em-dashes when null.
 */
export type WeatherComparisonSimData = {
  windSpeedKts: number | null;
  windDirection: number | null;
  oatCelsius: number | null;
  ambientPressureMb: number | null;
};

/**
 * Real-side weather snapshot, decoded from METAR. Shape mirrors the
 * relevant subset of DecodedMetar from `apps/web/lib/metars/fetch-from-bot.ts`,
 * pre-flattened so the component doesn't have to know about METAR's
 * decoded structure (which may evolve).
 *
 * `observedAt` is the METAR observation timestamp — typically within
 * 30-50 minutes of flight-end, since METARs publish on a half-hourly
 * cadence. Shown as a small caption so the pilot can judge if the
 * comparison is meaningful (a METAR observed 2h before landing isn't
 * a fair comparison and the caption makes that visible).
 */
export type WeatherComparisonRealData = {
  windSpeedKts: number | null;
  windDirection: number | null;
  /** Knots; null if METAR didn't report gusts. */
  windGustKts: number | null;
  oatCelsius: number | null;
  ambientPressureMb: number | null;
  observedAt: string | null;
  /** Raw METAR text, displayed in a small monospace footer. */
  raw: string | null;
};

export type WeatherComparisonProps = {
  /**
   * Arrival airport ICAO. Used in the card title ("Weather comparison
   * at EDDF") and to scope the "no METAR available" message when real
   * data is absent.
   */
  arrivalIcao: string;
  sim: WeatherComparisonSimData;
  /**
   * Real-world METAR-derived values, or null if the METAR cache had
   * nothing for this airport (bot down, unknown station, etc.). The
   * component renders gracefully either way.
   */
  real: WeatherComparisonRealData | null;
};

export function WeatherComparisonCard({
  arrivalIcao,
  sim,
  real,
}: WeatherComparisonProps): ReactNode {
  const accuracy = computeAccuracyScore(sim, real);

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
          Weather Comparison · {arrivalIcao}
        </h2>
        {accuracy && (
          <span
            className={[
              'text-xs px-2.5 py-1 rounded-full font-medium',
              accuracy.score >= 75
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                : accuracy.score >= 50
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
            ].join(' ')}
            title={`${accuracy.closeCount} of ${accuracy.totalCount} dimensions within tolerance`}
          >
            Sim weather {accuracy.score}% accurate
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
        Sim-engine snapshot at flight end vs. real-world METAR for{' '}
        {arrivalIcao}
        {real?.observedAt &&
          ` (observed ${formatRelativeTime(real.observedAt)})`}
        .
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <WeatherColumn
          title="Im Sim"
          subtitle="Captured at BLOCK_ON"
          values={sim}
          variant="sim"
        />
        <WeatherColumn
          title="Real-World"
          subtitle={
            real?.observedAt
              ? `METAR ${formatTimeShort(real.observedAt)}`
              : 'METAR'
          }
          values={
            real
              ? {
                  windSpeedKts: real.windSpeedKts,
                  windDirection: real.windDirection,
                  oatCelsius: real.oatCelsius,
                  ambientPressureMb: real.ambientPressureMb,
                }
              : null
          }
          windGustKts={real?.windGustKts ?? null}
          variant="real"
          fallbackNote={
            real
              ? null
              : `No METAR available for ${arrivalIcao} — the bot's weather cache may be cold or this airport doesn't publish on the VATSIM datafeed.`
          }
        />
      </div>

      {real?.raw && (
        <p className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all">
          {real.raw}
        </p>
      )}
    </section>
  );
}

/**
 * One side of the comparison (sim or real). Pulled out as a private
 * sub-component so the layout stays symmetric — both columns use
 * identical grids, only the values differ.
 *
 * When `values` is null (real-side only, when no METAR is cached), we
 * render the column with em-dashes and a muted explanatory note.
 */
function WeatherColumn({
  title,
  subtitle,
  values,
  windGustKts,
  variant,
  fallbackNote,
}: {
  title: string;
  subtitle: string;
  values: WeatherComparisonSimData | null;
  windGustKts?: number | null;
  variant: 'sim' | 'real';
  fallbackNote?: string | null;
}): ReactNode {
  const accentBorder =
    variant === 'sim'
      ? 'border-blue-200 dark:border-blue-800/40'
      : 'border-emerald-200 dark:border-emerald-800/40';

  return (
    <div
      className={`bg-gray-50 dark:bg-gray-800/40 border ${accentBorder} rounded-lg p-4`}
    >
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          {subtitle}
        </span>
      </div>

      {fallbackNote ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          {fallbackNote}
        </p>
      ) : (
        <dl className="space-y-3">
          <WeatherRow
            icon={<Wind className="w-3.5 h-3.5" />}
            label="Wind"
            value={formatWind(
              values?.windDirection ?? null,
              values?.windSpeedKts ?? null,
              windGustKts ?? null,
            )}
          />
          <WeatherRow
            icon={<Thermometer className="w-3.5 h-3.5" />}
            label="OAT"
            value={
              values?.oatCelsius !== null && values?.oatCelsius !== undefined
                ? `${values.oatCelsius}°C`
                : '—'
            }
          />
          <WeatherRow
            icon={<Gauge className="w-3.5 h-3.5" />}
            label="QNH"
            value={
              values?.ambientPressureMb !== null &&
              values?.ambientPressureMb !== undefined
                ? `${values.ambientPressureMb.toFixed(1)} hPa`
                : '—'
            }
          />
        </dl>
      )}
    </div>
  );
}

function WeatherRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}): ReactNode {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        {label}
      </dt>
      <dd className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/**
 * Format wind in the standard aviation pattern "270/15" or "270/15G25"
 * when gusts are present. Falls back to em-dash if direction or speed
 * is missing. Direction is zero-padded to 3 digits to match the METAR
 * convention and the briefing-style readability pilots expect.
 *
 * Variable-wind handling (METAR's "VRB") isn't in scope here because
 * the upstream DecodedMetar exposes direction as `number | null` and
 * already collapses VRB to null. If a future METAR-parser change
 * starts exposing variability ranges (variableFrom/variableTo), the
 * `WeatherComparisonRealData` shape would grow to carry them and this
 * function would learn to render "VRB10" or "240V300/15".
 */
function formatWind(
  direction: number | null,
  speed: number | null,
  gust: number | null,
): string {
  if (direction === null || speed === null) return '—';
  const dir = String(Math.round(direction)).padStart(3, '0');
  const spd = String(Math.round(speed));
  if (gust !== null && gust > 0) {
    return `${dir}/${spd}G${Math.round(gust)} kt`;
  }
  return `${dir}/${spd} kt`;
}

function formatTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    // ISO observation strings come in as UTC; show HH:mmZ so pilots
    // recognize the METAR "observed at" cadence instantly.
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}Z`;
  } catch {
    return iso;
  }
}

/**
 * Format observation time as a short relative string ("12 min ago",
 * "1h ago", "yesterday"). Used in the card subtitle so the pilot can
 * tell at a glance if the METAR is fresh enough to be a fair comparison.
 *
 * Falls back to the raw ISO string on parse failure rather than crashing
 * — defensive because the upstream shape comes from a third-party METAR
 * parser whose timestamp format we don't control.
 */
function formatRelativeTime(iso: string): string {
  try {
    const obs = new Date(iso).getTime();
    if (Number.isNaN(obs)) return iso;
    const diffMs = Date.now() - obs;
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return diffDays === 1 ? 'yesterday' : `${diffDays} days ago`;
  } catch {
    return iso;
  }
}

/**
 * Compute the coarse "accuracy" score that lights up the header badge.
 * Returns null when there's not enough data for a meaningful comparison
 * (no real data at all, or zero dimensions both sides happen to have).
 *
 * Each dimension contributes one slot to the total count IFF both sides
 * have a value for it; missing-on-either-side dimensions are excluded
 * from both numerator AND denominator (rather than counted as 0% match)
 * because we don't want a missing METAR field to drag the score down
 * when the sim faithfully reported its value.
 *
 * Wind-direction comparison handles the 0°/360° wrap-around: sim 5° vs
 * real 355° is a 10° delta, not 350°.
 */
function computeAccuracyScore(
  sim: WeatherComparisonSimData,
  real: WeatherComparisonRealData | null,
): { score: number; closeCount: number; totalCount: number } | null {
  if (!real) return null;

  let total = 0;
  let close = 0;

  // Wind speed: ±10 kts tolerance
  if (sim.windSpeedKts !== null && real.windSpeedKts !== null) {
    total++;
    if (Math.abs(sim.windSpeedKts - real.windSpeedKts) <= 10) close++;
  }

  // Wind direction: ±20° tolerance with wrap-around handling
  if (sim.windDirection !== null && real.windDirection !== null) {
    total++;
    const rawDelta = Math.abs(sim.windDirection - real.windDirection);
    const wrappedDelta = Math.min(rawDelta, 360 - rawDelta);
    if (wrappedDelta <= 20) close++;
  }

  // OAT: ±5°C tolerance
  if (sim.oatCelsius !== null && real.oatCelsius !== null) {
    total++;
    if (Math.abs(sim.oatCelsius - real.oatCelsius) <= 5) close++;
  }

  // QNH: ±5 mb tolerance
  if (
    sim.ambientPressureMb !== null &&
    real.ambientPressureMb !== null
  ) {
    total++;
    if (
      Math.abs(sim.ambientPressureMb - real.ambientPressureMb) <= 5
    ) {
      close++;
    }
  }

  if (total === 0) return null;
  return {
    score: Math.round((close / total) * 100),
    closeCount: close,
    totalCount: total,
  };
}
