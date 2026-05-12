// Track 5 #18 (Section D): Alternate-Picker. Pure geo-aggregator über
// Airport-tabelle. Liefert nächste N commercially-served airports
// innerhalb [30nm, 200nm] um einen given arrival-ICAO. Konsumiert von
// /bookings/[id] alternate-picker section.
export {
  getAlternates,
  type AlternateOption,
  type Compass8,
} from "./alternates.js";

// Track 5 #19 (Section D): Airport-Briefing. Pure aggregator über
// Runway + AirportFrequency + Navaid tables (alle aus OurAirports
// bulk-import). Liefert per-airport pre-flight info: RWYs, ATC-freqs,
// ILS-approach-aids. Konsumiert von /bookings/[id] briefing-section.
export {
  getAirportBriefing,
  type AirportBriefing,
  type RunwayInfo,
  type FrequencyInfo,
  type NavaidInfo,
} from "./briefing.js";
