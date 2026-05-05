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

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

// Connection-string aus env. Wenn nicht gesetzt: gibt PrismaPg einen
// hilfreichen runtime-error wenn der erste query läuft. Wir checken
// nicht hier — process startup wird hier durchlaufen auch wenn nur
// type-imports verwendet werden, ein hard-throw würde den ganzen
// next-build sprengen ohne nutzen.
const connectionString = process.env.DATABASE_URL ?? "";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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

// Welle 13 (Economy MVP): wallet/transfer/decimal helpers. Re-exports
// vom ./economy barrel damit consumer (apps/web, apps/bot) alles via
// `import { transfer, formatVamCurrency } from "@vam/db"` kriegen ohne
// subpath-imports. Siehe ./economy/index.ts für die einzelnen module.
export * from "./economy/index.js";

// Welle 13E (Career-System): License + TypeRating + FlightSchool +
// FlightSchoolEnrollment enums + types. Enums werden in switch-statements
// im UI gemappt (status-badges, license-badge-colors), types in queries
// die licenses/ratings includen.
export { LicenseType, LicenseStatus, EnrollmentStatus } from "@prisma/client";
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
