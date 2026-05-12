import { prisma, getAlternates } from '@vam/db';
import {
  estimateBlockFuel,
  DEFAULT_ALTERNATE_DISTANCE_NM,
} from '@/lib/fuel/calculate';

/**
 * Track 5 #20 (Section D) — Fuel-Estimate UI.
 *
 * Server-component die für ein booking ein block-fuel-estimate rendert,
 * basierend auf:
 *   - Route.distanceNm (trip distance)
 *   - AircraftType.cruiseSpeedKt + fuelBurnKgH + rangeNm + category
 *     (gejoint via Aircraft.type = AircraftType.icaoType)
 *   - Nearest alternate-distance via getAlternates() (default 100nm
 *     wenn keine alternates in 30-200nm range)
 *
 * # Conditional rendering
 *
 *   - Aircraft.type null ODER kein AircraftType-row → section hidden
 *     (kein vergleich möglich ohne cruise-speed/burn-rate)
 *   - Route.distanceNm null/0 → section hidden (defensive, schema cap
 *     ist Int @default(0) aber legacy-rows ohne distance möglich)
 *
 * # Why pure compute statt SimBrief-fetch?
 *
 * SimBrief macht das real-world-accurate mit METAR-winds + cost-index +
 * dispatcher-overrides. Hier ist die rule-of-thumb-version für
 * pre-planning ("passt das aircraft überhaupt?"). Zero-dependency,
 * deterministic, sofortig — kein SimBrief-account nötig.
 *
 * # Range-warning thresholds
 *
 *   < 0.70 = comfortable
 *   0.70-0.85 = green (typische narrow-body planning)
 *   0.85-1.00 = yellow ("close to max range")
 *   > 1.00 = red ("EXCEEDS aircraft range")
 */

function formatKg(kg: number): string {
  return kg.toLocaleString('de-DE');
}

function formatTime(min: number): string {
  if (min === 0) return '0';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, '0')}min`;
}

function rangeStatusStyle(util: number): {
  bg: string;
  label: string;
  emoji: string;
} {
  if (util > 1.0) {
    return {
      bg: 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300',
      label: 'Überschreitet aircraft-range',
      emoji: '🚨',
    };
  }
  if (util > 0.85) {
    return {
      bg: 'bg-yellow-500/10 border-yellow-500/40 text-yellow-700 dark:text-yellow-300',
      label: 'Nahe maximum range',
      emoji: '⚠️',
    };
  }
  return {
    bg: 'bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300',
    label: 'Range comfortable',
    emoji: '✅',
  };
}

export async function FuelEstimateCard({
  aircraftIcaoType,
  tripDistanceNm,
  arrivalIcao,
  departureIcao,
}: {
  aircraftIcaoType: string | null;
  tripDistanceNm: number;
  arrivalIcao: string;
  departureIcao: string;
}) {
  if (!aircraftIcaoType || tripDistanceNm <= 0) return null;

  // Parallel: AircraftType + nearest alternate.
  // Beide cheap (<50ms typisch) — Promise.all spart einen roundtrip.
  const [aircraftType, alternates] = await Promise.all([
    prisma.aircraftType.findUnique({
      where: { icaoType: aircraftIcaoType },
      select: {
        cruiseSpeedKt: true,
        fuelBurnKgH: true,
        rangeNm: true,
        category: true,
        name: true,
      },
    }),
    getAlternates({
      arrivalIcao,
      excludeIcaos: [departureIcao],
      limit: 1,
    }),
  ]);

  // Falls AircraftType nicht im catalog ist (z.B. obscure custom type),
  // können wir keine cruise/burn-werte ableiten → keine schätzung möglich.
  if (!aircraftType) return null;

  // Nearest alternate-distance falls vorhanden, sonst fällt der
  // estimator auf DEFAULT_ALTERNATE_DISTANCE_NM (100nm) zurück.
  const altDistance = alternates[0]?.distanceNm ?? null;
  const altIcao = alternates[0]?.icao ?? null;

  const estimate = estimateBlockFuel({
    tripDistanceNm,
    alternateDistanceNm: altDistance,
    cruiseSpeedKt: aircraftType.cruiseSpeedKt,
    fuelBurnKgH: aircraftType.fuelBurnKgH,
    category: aircraftType.category,
    rangeNm: aircraftType.rangeNm,
  });

  const rangeStatus = rangeStatusStyle(estimate.rangeUtilization);
  const utilPct = Math.round(estimate.rangeUtilization * 100);

  return (
    <section className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
          ⛽ Block-Fuel Estimate
        </h2>
        <p className="text-[10px] text-gray-400">
          Rule-of-thumb · keine SimBrief-substitute
        </p>
      </div>

      {/* Headline: block fuel + trip time + range-status pill */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Block Fuel
          </p>
          <p className="text-4xl font-bold font-mono tabular-nums text-gray-900 dark:text-gray-100">
            {formatKg(estimate.blockFuelKg)}
            <span className="text-base font-normal text-gray-400 ml-2">kg</span>
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            Trip-zeit: {formatTime(estimate.tripTimeMin)} · {aircraftType.name}
          </p>
        </div>
        <div
          className={`px-3 py-2 rounded-md border text-xs font-semibold ${rangeStatus.bg}`}
          title={`Range utilization: ${utilPct}% — total in-flight time ÷ max range time`}
        >
          <span className="mr-1.5">{rangeStatus.emoji}</span>
          {rangeStatus.label}
          <span className="ml-2 font-mono tabular-nums text-[11px] opacity-75">
            {utilPct}%
          </span>
        </div>
      </div>

      {/* Component breakdown */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-semibold">
          Breakdown
        </p>
        <ul className="space-y-1">
          {estimate.components.map((c) => (
            <li
              key={c.label}
              className="flex items-center gap-3 text-xs text-gray-700 dark:text-gray-300"
            >
              <span className="font-semibold w-24 shrink-0">{c.label}</span>
              <span className="font-mono tabular-nums font-bold w-20 text-right">
                {formatKg(c.fuelKg)} kg
              </span>
              {c.minutes > 0 && (
                <span className="font-mono tabular-nums text-gray-500 w-16 text-right shrink-0">
                  {formatTime(c.minutes)}
                </span>
              )}
              {c.minutes === 0 && (
                <span className="font-mono tabular-nums text-gray-400 w-16 text-right shrink-0">
                  —
                </span>
              )}
              {c.note && (
                <span className="text-[10px] text-gray-500 truncate">
                  {c.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Footer: alternate-source disclosure + caveat */}
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 space-y-1">
        <p className="text-[10px] text-gray-500">
          Alternate-assumption:{' '}
          {altIcao ? (
            <>
              <span className="font-mono font-semibold">{altIcao}</span> (
              {altDistance} nm via Track-5 #18 Alternate-Picker)
            </>
          ) : (
            <>
              <span className="font-mono">
                {DEFAULT_ALTERNATE_DISTANCE_NM} nm
              </span>{' '}
              default (kein alternate in 30-200nm range gefunden)
            </>
          )}
        </p>
        <p className="text-[10px] text-gray-400">
          Zero-wind, ISA-standard, mittel-cruise. Reale werte ±15% wegen
          wind/temp/cost-index — nutze SimBrief für dispatch.
        </p>
      </div>
    </section>
  );
}
