// Track 5 #11 (Section C) — User module barrel.
//
// Public-profile helper für die /p/[id] route. Settings-related
// helpers (toggleProfileVisibility) leben in der page-action,
// nicht hier — server-actions sind page-side, nicht db-side.
export {
  getPublicProfile,
  PublicProfileNotFoundError,
  type PublicProfile,
  type PublicProfileRecentFlight,
  type PublicProfileAircraftStat,
} from "./public-profile.js";
