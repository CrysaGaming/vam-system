/**
 * Track 5 #20 (Section D) — Fuel-Calculator (pure compute).
 *
 * Block-fuel estimator nach ICAO/FAA flight-planning-formel:
 *
 *   block = trip + alternate + reserve + contingency + taxi
 *
 * Pure function — keine DB-zugriffe, keine side-effects. Caller liefert
 * cruise-speed + fuel-burn (typischerweise aus AircraftType.cruiseSpeedKt
 * + AircraftType.fuelBurnKgH), plus distances + category. Wrapper-
 * komponente in /bookings/[id]/fuel-estimate.tsx macht den DB-lookup.
 *
 * # Formel-rationale (ICAO Annex 6 / FAR 121.639 äquivalent)
 *
 *   - Trip fuel:        block-zeit × burn-rate, basierend auf
 *                       distance / cruise-speed (großkreis approximation)
 *   - Alternate fuel:   diversion distance × burn-rate, plus 30min
 *                       hold above alternate
 *   - Final reserve:    30min hold above final destination
 *                       (ICAO standard für commercial ops)
 *   - Contingency:      5% of trip fuel (FAA/ICAO default)
 *   - Taxi:             category-based heuristic (siehe TAXI_FUEL_KG)
 *
 * Reserve+alternate-reserve werden hier zu "reserve" zusammengefasst —
 * 45min total above destination wenn alternate da, 30min wenn nicht.
 * Reale OFPs zerlegen das in zwei posten, aber für ein VA-estimate
 * reicht der konsolidierte block.
 *
 * # Why not external API?
 *
 * SimBrief macht das bereits real-world-accurate mit METAR-winds,
 * cost-index, dispatcher-overrides etc. Dieser estimator ist explicit
 * NICHT SimBrief — er ist ein rule-of-thumb für "passt das aircraft
 * überhaupt für die strecke?" pre-planning-check. Zero-dependency,
 * deterministic, instant.
 */

/**
 * Taxi-fuel pro aircraft-category. Real-world taxi-times sind 10-20min
 * je nach airport, das ist eine konservative estimate die alle drei
 * legs (DEP-taxi, ARR-taxi, kurze APU/start-up burns) abdeckt.
 */
const TAXI_FUEL_KG: Record<string, number> = {
  ga: 20,
  regional: 100,
  narrow_body: 200,
  wide_body: 500,
  cargo: 300,
};

/**
 * Default taxi-fuel wenn category unbekannt — narrow-body als
 * "median aircraft" annahme (Airbus/Boeing single-aisle dominiert
 * commercial fleet).
 */
const DEFAULT_TAXI_FUEL_KG = 200;

/** ICAO standard final reserve: 30min hold at 1500ft AAL über destination. */
const FINAL_RESERVE_MIN = 30;
/** ICAO + EASA standard: zusätzliche 15min wenn alternate filed (45min total). */
const ALTERNATE_RESERVE_MIN = 15;
/** FAA/ICAO contingency-fuel default — 5% of trip fuel. */
const CONTINGENCY_PCT = 0.05;
/** Fallback alternate distance falls kein konkretes alternate vorhanden — 100nm ist regulatory-minimum range. */
export const DEFAULT_ALTERNATE_DISTANCE_NM = 100;

export type FuelEstimateInput = {
  /** Route distance in nm (großkreis). */
  tripDistanceNm: number;
  /** Distance to filed alternate in nm. Null → default 100nm assumption. */
  alternateDistanceNm: number | null;
  /** Aircraft cruise speed in knots (true airspeed approximation). */
  cruiseSpeedKt: number;
  /** Aircraft fuel burn rate in kg/h at cruise. */
  fuelBurnKgH: number;
  /** OurAirports-style category: narrow_body / wide_body / regional / cargo / ga. */
  category: string;
  /** Aircraft maximum range in nm — used for the "out of range" warning. */
  rangeNm: number;
};

export type FuelComponent = {
  label: string;
  /** Fuel quantity in kg, rounded to nearest 10. */
  fuelKg: number;
  /** Minutes the burn covers (info-only, helps pilot sanity-check). */
  minutes: number;
  /** Optional sub-note shown next to the label (e.g. "5% of trip"). */
  note?: string;
};

export type FuelEstimate = {
  components: FuelComponent[];
  /** Sum of all components in kg, rounded to nearest 10. */
  blockFuelKg: number;
  /** Estimated flight time in hours+minutes (trip phase only, no taxi). */
  tripTimeMin: number;
  /**
   * Range-check: ratio of estimated block-fuel-flight-time to aircraft
   * range. Values >0.85 trigger a warning in the UI ("nahe maximum range").
   * >1.0 means the route exceeds aircraft range outright.
   */
  rangeUtilization: number;
};

/**
 * Rundet kg-werte auf die nächsten 10kg. Fuel-quantities werden in
 * der praxis nie auf einzelnes kg genau geplant — pilots tanken in
 * 10kg/100lb-schritten. Konsistente rundung macht die spalte tabular-num.
 */
function roundTo10(kg: number): number {
  return Math.round(kg / 10) * 10;
}

/**
 * Block fuel estimate für ein given booking. Returns breakdown +
 * total in kg, plus utilization-ratio für range-warnings.
 *
 * # Annahmen
 *
 *   - Cruise-speed konstant über die ganze strecke (in der praxis
 *     climb/descent sind langsamer + burnen mehr, aber das mittelt
 *     sich für 200-1500nm strecken gut raus)
 *   - Zero wind (real-world: head/tailwind kann ±15% trip fuel ändern)
 *   - Standard atmosphere (real ISA-deviation hat ~3% impact)
 *   - Aircraft is at MZFW + fuel — kein gewichts-iteration
 *
 * Für eine pre-planning-rough-estimate sind diese annahmen alle ok.
 * Echte dispatch nutzt SimBrief — das ist nicht der zweck hier.
 */
export function estimateBlockFuel(input: FuelEstimateInput): FuelEstimate {
  const {
    tripDistanceNm,
    alternateDistanceNm,
    cruiseSpeedKt,
    fuelBurnKgH,
    category,
    rangeNm,
  } = input;

  const altDistance = alternateDistanceNm ?? DEFAULT_ALTERNATE_DISTANCE_NM;
  const tripTimeH = tripDistanceNm / cruiseSpeedKt;
  const altTimeH = altDistance / cruiseSpeedKt;

  const tripFuel = tripTimeH * fuelBurnKgH;
  const alternateFuel = altTimeH * fuelBurnKgH;
  const contingencyFuel = tripFuel * CONTINGENCY_PCT;

  // Final reserve = 30min hold at destination (ICAO).
  // Plus 15min wenn alternate da ist (EASA reserve-stack).
  const reserveMin = alternateDistanceNm
    ? FINAL_RESERVE_MIN + ALTERNATE_RESERVE_MIN
    : FINAL_RESERVE_MIN;
  const reserveFuel = (reserveMin / 60) * fuelBurnKgH;

  const taxiFuel = TAXI_FUEL_KG[category] ?? DEFAULT_TAXI_FUEL_KG;

  const components: FuelComponent[] = [
    {
      label: "Trip",
      fuelKg: roundTo10(tripFuel),
      minutes: Math.round(tripTimeH * 60),
      note: `${tripDistanceNm} nm @ ${cruiseSpeedKt}kt`,
    },
    {
      label: "Contingency",
      fuelKg: roundTo10(contingencyFuel),
      minutes: Math.round(tripTimeH * 60 * CONTINGENCY_PCT),
      note: `${Math.round(CONTINGENCY_PCT * 100)}% of trip`,
    },
    {
      label: "Alternate",
      fuelKg: roundTo10(alternateFuel),
      minutes: Math.round(altTimeH * 60),
      note: alternateDistanceNm
        ? `${altDistance} nm`
        : `${altDistance} nm (default — kein alternate filed)`,
    },
    {
      label: "Final reserve",
      fuelKg: roundTo10(reserveFuel),
      minutes: reserveMin,
      note: alternateDistanceNm
        ? "30min hold + 15min alt-reserve"
        : "30min hold (ICAO minimum)",
    },
    {
      label: "Taxi",
      fuelKg: roundTo10(taxiFuel),
      minutes: 0,
      note: `${category} default`,
    },
  ];

  const blockFuelKg = components.reduce((sum, c) => sum + c.fuelKg, 0);
  const tripTimeMin = Math.round(tripTimeH * 60);

  // Range utilization: total in-flight time (trip + alt + reserve) ÷
  // theoretical max flight time at range. >1 = exceeds aircraft range.
  const totalInFlightH = tripTimeH + altTimeH + reserveMin / 60;
  const maxFlightH = rangeNm / cruiseSpeedKt;
  const rangeUtilization = totalInFlightH / maxFlightH;

  return {
    components,
    blockFuelKg,
    tripTimeMin,
    rangeUtilization,
  };
}
