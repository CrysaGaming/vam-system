// Track 5 #17 (Section D): Route-Suggester. Smart "wo flieg ich als
// nächstes hin"-suggestions basierend auf User.currentLocationIcao
// (Welle 4) + Aircraft.currentLocationIcao + pilot's PIREP-history.
// Pure aggregator, kein neues schema. Konsumiert von /bookings/new.
export {
  getPilotLocation,
  getRouteSuggestions,
  type PilotLocation,
  type RouteSuggestion,
} from "./suggestions.js";
