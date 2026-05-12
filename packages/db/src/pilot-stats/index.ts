// Track 5 #6 — Pilot Career Stats. Public API barrel.
export {
  getPilotCareerStats,
  type PilotCareerStats,
  type AircraftTypeStat,
  type RoutePairStat,
} from "./career-stats.js";

// Track 5 #8 — Personal Best Records. Findet pro pilot die einzelnen
// PIREPs die als extremster wert herausstechen (smoothest landing,
// longest flight, most pax etc). Komplementär zu career-stats — die
// aggregate, dies highlights pro einzelnem flug.
export {
  getPilotPersonalBests,
  type PilotPersonalBests,
  type PersonalBestRecord,
  type RecordPirepSummary,
} from "./personal-bests.js";

// Track 5 #9 — Airline Leaderboards. Cross-pilot rankings innerhalb
// einer airline. 5 boards: mostFlights/Hours/Distance, smoothestPilot
// (avg|fpm| asc, min 5 landings), mostRecentActivity (last 7d).
export {
  getAirlineLeaderboards,
  type AirlineLeaderboards,
  type LeaderboardEntry,
  type LeaderboardPilotSummary,
  type LeaderboardKind,
} from "./leaderboards.js";
