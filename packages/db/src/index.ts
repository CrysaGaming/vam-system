import { PrismaClient } from "@prisma/client";

// Singleton-Pattern: verhindert mehrere PrismaClient-Instanzen bei Next.js Hot-Reload
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Re-export für Typ-Nutzung in anderen Packages
export { PrismaClient } from "@prisma/client";
export * from "@prisma/client";
