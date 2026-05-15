/**
 * Prisma Client singleton für das gesamte VAM-monorepo.
 *
 * Welle 12 phase B: Prisma 7 nutzt explizite driver-adapters statt der
 * alten built-in-rust-engine. Wir setzen den PrismaPg-adapter manuell
 * mit einer connection-string aus DATABASE_URL — das ist v7's neue
 * default-architektur (rust-free WASM client).
 *
 * Architektur-rationale:
 *   - Adapter-pattern entkoppelt PrismaClient vom DB-treiber. In v7
 *     muss IMMER ein adapter angegeben werden — "engine: classic" als
 *     fallback wurde gestrichen.
 *   - PrismaPg wraps `pg` (node-postgres). Connection-pooling läuft
 *     darüber; pg defaultet auf max=10 wenn nicht override'd. Für
 *     dev reicht das. Production-tuning via PrismaPg-options wenn nötig.
 *
 * Singleton-pattern (unverändert seit v5):
 *   Next.js hot-reload würde sonst bei jedem code-change einen neuen
 *   PrismaClient erstellen → connection-leak nach 50+ saves. Den client
 *   in globalThis zu cachen verhindert das in dev. Production (server-
 *   build) reicht plain new PrismaClient() weil kein hot-reload.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { extendWithSlowQueryMonitor } from "./perf/slow-query-monitor.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

// Connection-string aus env. Wenn nicht gesetzt: gibt PrismaPg einen
// hilfreichen runtime-error wenn der erste query läuft. Wir checken
// nicht hier — process startup wird hier durchlaufen auch wenn nur
// type-imports verwendet werden, ein hard-throw würde den ganzen
// next-build sprengen ohne nutzen.
const connectionString = process.env.DATABASE_URL ?? "";

// Base-client (unwrapped). Wird in globalThis gecached für hot-reload
// resistance. Die slow-query-extension wird IMMER on-top angewandt —
// die globalThis-cache hat nur den base-client, nicht den extended.
// Das ist beabsichtigt: $extends macht einen lightweight wrapper,
// caching des base-clients reicht für connection-pool-stabilität.
const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = basePrisma;

// Track 4 #102 (Section T): slow-query-monitor extension. Wrappt jede
// query mit timing + ring-buffer-recording. Threshold via env-var
// VAM_SLOW_QUERY_MS (default 200ms). Buffer ist in-memory (siehe
// ./perf/slow-query-monitor.ts für details).
//
// Type-cast über `unknown as PrismaClient`: $extends ändert den
// laufzeit-typ zu einem "DynamicClientExtensionThis"-wrapper. Downstream
// code (z.b. economy/wallet.ts) nutzt prisma.$transaction(callback)
// patterns die mit dem extended-typ TS-overload-resolution-issues haben
// (TS pickt die array-overload statt callback-overload weil das
// callback-arg type strict matched gegen die original-Prisma.Transaction-
// Client-shape, nicht gegen die extended-tx-shape). Workaround: laufzeit
// bekommt den extended client (mit monitoring), type-system sieht
// plain PrismaClient (keine breaking changes für consumer).
const extendedPrisma = extendWithSlowQueryMonitor(basePrisma);
export const prisma: PrismaClient = extendedPrisma as unknown as PrismaClient;

// Re-export für Typ-Nutzung in anderen Packages.
//
// Explicit named-exports statt `export * from "@prisma/client"`: das
// @prisma/client package war historisch CommonJS, und Next.js (Turbopack)
// konnte dessen exports nicht statisch auflösen — das Ergebnis war eine
// dauerhafte WARN bei jedem Render: "unexpected export *". In Prisma 7
// ist das package ESM-first, theoretisch könnte `export *` jetzt
// funktionieren — wir behalten die explizite liste vorerst trotzdem,
// weil das tree-shaking-friendly bleibt und neue exports bewusst
// hinzugefügt werden müssen (kein "spooky action at a distance" wenn
// Prisma neue enums/types erfindet).
export { PrismaClient, Prisma } from "@prisma/client";
export { BookingState, NetworkType } from "@prisma/client";
// Welle 5: AircraftStatus enum für /airline/aircraft UI (status-badges,
// filter-tabs). Type-export erlaubt narrow type-checks ohne string-magic.
export { AircraftStatus } from "@prisma/client";
// Welle 6B: EmploymentStatus enum für personnel-management UI (status-
// dropdown, filter-tabs in /airline/pilots, status-badges in /pilots).
// Default ACTIVE für alle existing user (additive migration).
export { EmploymentStatus } from "@prisma/client";
// Welle 7: Schedule-system. Status-enum für ScheduledFlight-instanzen
// (Planned/Booked/Completed/Cancelled), Type-exports für ScheduleTemplate
// und ScheduledFlight damit lib/schedule helper + UI-components typed
// arbeiten können.
export { ScheduledFlightStatus } from "@prisma/client";
export type { ScheduleTemplate, ScheduledFlight } from "@prisma/client";

// Track 5 #26 (Section F): Roster-Assignment enum + type. Status-enum
// fürs UI (badge-colors, filter-tabs), Type-export für queries die
// RosterAssignment includen. Helpers separat via ./roster barrel unten.
export { RosterAssignmentStatus } from "@prisma/client";
export type { RosterAssignment } from "@prisma/client";
// Track 5 #29: RosterSwapRequest enum + model type für UI-konsumenten.
export { RosterSwapRequestStatus } from "@prisma/client";
export type { RosterSwapRequest } from "@prisma/client";
// Welle E / E4: Cockpit-room enums + model types für multi-pilot
// coordination. Role wird im UI für rollen-labels gerendert; Status
// für open/closed-filter; MemberStatus für active/historical-list.
// CockpitRoom + CockpitMember model-types für queries die rooms +
// members joinen (endpoint responses, future room-list pages).
export { CockpitRole, CockpitRoomStatus, CockpitMemberStatus } from "@prisma/client";
export type { CockpitRoom, CockpitMember } from "@prisma/client";
// Welle 9: ACARS Phase 2-5. Simulator + AcarsEventType enums für die
// settings-UI (sim-picker) und die heartbeat/event-API endpoints.
// Type-exports für die pairing-helpers + auto-PIREP-trigger.
export { Simulator, AcarsEventType } from "@prisma/client";
export type { AcarsPairingCode, AcarsEvent } from "@prisma/client";
// Welle 13 (Economy MVP): Wallet + Transaction enums + types. Die enums
// werden in switch-statements im UI für color-coding/icons gemappt;
// die types in queries die wallets/transactions includen.
export { WalletOwnerType, TransactionType } from "@prisma/client";
export type { Wallet, Transaction } from "@prisma/client";

// Welle O / O4: Channel-points action enums. Used by the UI (action-
// type-dropdown) and by the action-dispatcher in apps/web/lib/twitch.
export { ChannelPointActionType, ChannelPointRedemptionStatus } from "@prisma/client";
export type { ChannelPointReward, ChannelPointRedemption } from "@prisma/client";

// Welle O / O5: Auto-clip trigger enum + clip model type for the
// /settings/twitch hub UI and the apps/web/lib/twitch/clips helper.
export { TwitchClipTrigger } from "@prisma/client";
export type { TwitchClip } from "@prisma/client";

// Welle P / P1: Live aviation weather. FlightCategory enum drives
// dispatch-badge colors + filter queries; AirportWeather type is
// used by apps/web/lib/weather/aviation-weather.ts (cache helper)
// and consumed by the dispatch board + bookings UI.
export { FlightCategory } from "@prisma/client";
export type { AirportWeather } from "@prisma/client";

// Welle 13 (Economy MVP): wallet/transfer/decimal helpers. Re-exports
// vom ./economy barrel damit consumer (apps/web, apps/bot) alles via
// `import { transfer, formatVamCurrency } from "@vam/db"` kriegen ohne
// subpath-imports. Siehe ./economy/index.ts für die einzelnen module.
export * from "./economy/index.js";

// Welle 13E (Career-System): License + TypeRating + FlightSchool +
// FlightSchoolEnrollment enums + types. Enums werden in switch-statements
// im UI gemappt (status-badges, license-badge-colors), types in queries
// die licenses/ratings includen.
export { LicenseType, LicenseStatus, EnrollmentStatus, TypeRatingExamStatus, MentorshipStatus } from "@prisma/client";
export type {
  PilotLicense,
  TypeRating,
  FlightSchool,
  FlightSchoolEnrollment,
} from "@prisma/client";

// Welle 13E (Career-System): license/type-rating/booking-gate helpers.
// Re-exports vom ./career barrel — consumer importieren via `import {
// canPilotFlyAircraft, grantLicense } from "@vam/db"`. Siehe
// ./career/index.ts für die einzelnen module.
export * from "./career/index.js";

// Welle 14A (Twitch-Activation): Live-stream-status-helpers + types.
// Werden vom bot (services/twitch-eventsub.ts in 14B) bei stream.online/
// offline events genutzt, und von apps/web (live-badges in 14C) für
// queries. Re-exports vom ./twitch barrel — consumer importieren via
// `import { markPilotLive, getLivePilots, countLivePilots } from "@vam/db"`.
export * from "./twitch/index.js";

// Track 1 #1 (Awards UI, 9.2.3): Award/UserAward queries + actions.
// Award + UserAward models existieren seit dem prisma initial-schema —
// dies sind die helper-funktionen die das UI in apps/web/app/awards
// nutzt (catalog, detail, profile-section) plus die admin-actions in
// /admin/awards (create/grant/revoke). Re-exports vom ./awards barrel.
export type { Award, UserAward } from "@prisma/client";
export * from "./awards/index.js";

// Track 1 #3 (Sceneries-Catalog UI, 9.2.4): Scenery queries + actions.
// Scenery model existierte schon im prisma initial-schema mit minimal
// fields (name, airportIcao, provider, url, free, airlineId). Diese
// helpers sind das catalog-listing + admin-CRUD (create/update/delete).
// MVP ohne owned-tracking (UserScenery wäre eigene welle), ohne
// description/image/simulator (schema-erweiterung wäre eigene welle).
export type { Scenery } from "@prisma/client";
export * from "./sceneries/index.js";

// Track 1 #4 (PIREP-Heatmap, 9.2.6): Aggregation helper für die
// mapbox-heatmap-layer auf der live-map. Einzige function:
// getPirepHeatmapPoints — returnt die approved-PIREP-departure+arrival-
// counts pro airport als geo-punkte mit weight für die heatmap.
export * from "./pireps/index.js";

// Track 1 #7 (Events / Flight-Tours, 9.2.8): Event + EventParticipant
// schema (welle_track1_7_events_and_participants migration). Helpers
// für public-catalog (/events), event-detail mit signup, admin-CRUD
// (/admin/events) und profile-display ("Meine Events"). State-machine:
// DRAFT → PUBLISHED → COMPLETED, mit CANCELLED-side-channel. Bonus-
// rewards beim per-participant complete-marken werden als REVENUE_PASSENGER
// mit category="event-bonus" auf user-wallets gebucht (kein separater
// REVENUE_EVENT_BONUS-enum-value im MVP — siehe schema-comment Event.bonusReward).
export { EventKind, EventStatus } from "@prisma/client";
export type { Event, EventParticipant, EventTemplate, EventComment } from "@prisma/client";
export * from "./events/index.js";

// Track 4 #101 (Section T): AdminAuditLog type re-export + helper.
// Append-only audit-trail von admin-actions (role-changes, event-publish,
// award-grant etc.). Helper logAdminAction() lebt in ./audit barrel.
export type { AdminAuditLog } from "@prisma/client";
export * from "./audit/index.js";

// Track 4 #102 (Section T): Slow-Query-Monitor helpers. getSlowQueries(),
// getSlowQueryStats(), clearSlowQueryBuffer(), getSlowQueryThresholdMs().
// Die extension selbst (extendWithSlowQueryMonitor) wird oben schon
// internally auf den base-client angewandt — consumer brauchen nur die
// read/clear-helpers für die /admin/perf-page.
export * from "./perf/index.js";

// Track 4 #103 (Section T): ClientErrorLog type re-export + helpers.
// recordClientError() vom POST /api/errors-endpoint genutzt,
// listClientErrors() + getTopErrorUrlsLast24h() von der /admin/errors-page.
// Rate-limit-state lebt im helper-modul, in-memory wie #102.
export type { ClientErrorLog } from "@prisma/client";
export * from "./errors/index.js";

// Track 4 #104 (Section T): Data-Integrity-Check helpers. runIntegrityChecks()
// läuft eine batch von 10 read-only invariant-queries (orphan-rows,
// counter-drift, state-machine-inconsistencies, negative-values, stale-state)
// und returnt einen report mit severity-bewertung pro check. Konsumiert
// von der /admin/integrity-page.
export * from "./integrity/index.js";

// Track 1 #5 (Replay-Mode, 9.2.7): PIREP-replay queries. Findet die
// LiveSession + LiveSessionPosition[] zu einem given PIREP — entweder
// via AcarsEvent.triggeredPirepId (sauberer pfad für ACARS-PIREPs) oder
// heuristisch via userId + departure/arrival + zeitfenster (für
// VATSIM/IVAO/manuelle PIREPs). Read-only, keine actions.
export * from "./replay/index.js";

// Track 5 #6 (Section B): Pilot-Career-Stats. Pure aggregation helper
// über approved PIREPs eines pilots — totals, recent-windows, landing-
// stats, aircraft/route breakdowns, network split, 12-month-trend.
// Konsumiert von /pilots/[id]/stats. Kein neues schema, nur queries.
export * from "./pilot-stats/index.js";

// Track 5 #11 (Section C): Public-Profile helpers. getPublicProfile()
// returnt scrubbed-public view auf einen pilot (id, name, image, bio,
// tagline, rank, airline, total flights/hours, recent 5 flights, top-3
// aircraft). Throws PublicProfileNotFoundError wenn user nicht existiert
// ODER sein isProfilePublic-flag false ist. Konsumiert von /p/[id].
export * from "./users/index.js";

// Track 5 #12 (Section C): Airline Activity Feed. Pure-aggregator über
// existierende tables (kein schema-change). Mergt approved PIREPs +
// UserAward grants + PirepKudos in eine timeline der letzten 14 tage
// (oder custom-window). Konsumiert von /feed.
export * from "./activity/index.js";

// Track 5 #13 (Section C): Follow-System. Asymmetric (twitter-style),
// follow-button auf /p/[id]. Helpers für followUser/unfollowUser,
// getFollowState/Counts, listFollowers/Following. Schema: Follow model
// mit @@unique + zwei descending-indizes für list-queries.
export * from "./follows/index.js";

// Track 5 #14 (Section C): PIREP Discussion Comments. Free-form
// comments unter PIREPs. Schema: PirepComment model mit
// @@index([pirepId, createdAt]) für thread-reading. Helpers für
// list/create/update/delete + 15-min edit-window enforcement.
// Konsumiert von der PIREP-detail-page comments-section.
export * from "./comments/index.js";

// Track 5 #15 (Section C): PIREP Photo Posts. URL-based (kein file-
// upload V1) — author pastet image-link plus optional caption.
// Schema: PirepPhoto model mit @@index([pirepId, createdAt]) +
// @@index([authorId, createdAt]). Hard-cap 12 photos pro PIREP.
// Konsumiert von der PIREP-detail-page photo-gallery section.
export * from "./photos/index.js";

// Track 5 #17 (Section D): Route-Suggester. Smart "wo flieg ich als
// nächstes hin"-suggestions basierend auf User.currentLocationIcao
// (Welle 4) + Aircraft.currentLocationIcao + pilot's PIREP-history.
// Pure aggregator, kein neues schema. Konsumiert von /bookings/new.
export * from "./routes/index.js";

// Track 5 #18 (Section D): Alternate-Picker. Pure geo-aggregator über
// Airport-tabelle mit Haversine-distance. Liefert nächste N
// commercially-served airports innerhalb [30nm, 200nm] um einen
// arrival-ICAO. Bounding-box-prefilter in SQL, exact distance in JS.
// Konsumiert von /bookings/[id] alternate-picker section.
export * from "./airports/index.js";

// Track 5 #24 (Section E): Web Push subscriptions — Persistence-layer
// für browser-device-subscriptions. CRUD-helpers (upsert/remove/list/
// cleanup/count). Die actual notification-fan-out (web-push library +
// VAPID-signing + 410-cleanup) lebt in apps/web/lib/push/vapid.ts
// damit die @vam/db lib bundle-frei bleibt.
export * from "./push/index.js";

// Track 5 #26 (Section F): Roster-Assignment CRUD layer. Airline weist
// pilots zu scheduled-flights zu (separates konzept vom Booking, das
// pilot-self-service ist). Business-logic (eligibility-check,
// auto-rotation, swap-flow, no-show-detection) lebt in apps/web/lib/roster/
// — hier nur pure persistence.
export * from "./roster/index.js";
