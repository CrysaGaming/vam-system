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
