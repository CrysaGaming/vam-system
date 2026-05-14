-- CreateEnum
CREATE TYPE "NotamType" AS ENUM ('Closure', 'Restriction', 'Procedure', 'Info');

-- CreateEnum
CREATE TYPE "NotamSeverity" AS ENUM ('Info', 'Warning', 'Critical');

-- CreateTable
CREATE TABLE "Notam" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "type" "NotamType" NOT NULL,
    "severity" "NotamSeverity" NOT NULL DEFAULT 'Info',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "affectedIcaos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notam_airlineId_validFrom_idx" ON "Notam"("airlineId", "validFrom");

-- CreateIndex
CREATE INDEX "Notam_airlineId_publishedAt_idx" ON "Notam"("airlineId", "publishedAt");

-- AddForeignKey
ALTER TABLE "Notam" ADD CONSTRAINT "Notam_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notam" ADD CONSTRAINT "Notam_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
