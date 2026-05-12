// Track 5 #18 (Section D): Alternate-Picker. Pure geo-aggregator über
// Airport-tabelle. Liefert nächste N commercially-served airports
// innerhalb [30nm, 200nm] um einen given arrival-ICAO. Konsumiert von
// /bookings/[id] alternate-picker section.
export {
  getAlternates,
  type AlternateOption,
  type Compass8,
} from "./alternates.js";
