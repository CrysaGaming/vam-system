// Track 5 #12 (Section C) — Airline Activity Feed.
//
// Pure-aggregator über approved PIREPs, UserAward grants, PirepKudos.
// Kein neues schema. Konsumiert von /feed.
export {
  getAirlineActivityFeed,
  type ActivityEvent,
  type ActivityActor,
} from "./feed.js";
