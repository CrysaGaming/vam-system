import { PrismaClient } from "@prisma/client";

// Singleton-Pattern: verhindert mehrere PrismaClient-Instanzen bei Next.js Hot-Reload
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Re-export für Typ-Nutzung in anderen Packages.
//
// Explicit named-exports statt `export * from "@prisma/client"`: das
// @prisma/client package ist CommonJS, und Next.js (Turbopack) kann
// dessen exports nicht statisch auflösen — das Ergebnis war eine
// dauerhafte WARN bei jedem Render: "unexpected export *". Hier
// listen wir nur was tatsächlich konsumiert wird (siehe `grep -rh
// "from '@vam/db'"` über das Repo). Wenn ein neuer Konsument einen
// generierten Type/Enum braucht, einfach hier ergänzen.
export { PrismaClient, Prisma } from "@prisma/client";
export { BookingState, NetworkType } from "@prisma/client";
// Welle 5: AircraftStatus enum für /airline/aircraft UI (status-badges,
// filter-tabs). Type-export erlaubt narrow type-checks ohne string-magic.
export { AircraftStatus } from "@prisma/client";
