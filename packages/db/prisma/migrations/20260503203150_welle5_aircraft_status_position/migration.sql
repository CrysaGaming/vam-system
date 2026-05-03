-- CreateEnum
CREATE TYPE "AircraftStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'STORED', 'RETIRED');

-- AlterTable
ALTER TABLE "Aircraft" ADD COLUMN     "currentLocationAt" TIMESTAMP(3),
ADD COLUMN     "currentLocationIcao" TEXT,
ADD COLUMN     "status" "AircraftStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Aircraft_airlineId_status_idx" ON "Aircraft"("airlineId", "status");

-- CreateIndex
CREATE INDEX "Aircraft_airlineId_homeIcao_idx" ON "Aircraft"("airlineId", "homeIcao");

-- CreateIndex
CREATE INDEX "Aircraft_currentLocationIcao_idx" ON "Aircraft"("currentLocationIcao");

-- Welle 5 backfill: existing airframes mit active=false bekommen status=RETIRED.
-- Default-statement oben hat alle rows zunächst auf ACTIVE gesetzt; dieser
-- UPDATE korrigiert die "soft-deleted" airframes auf RETIRED damit das alte
-- active-flag und das neue status-feld konsistent sind.
UPDATE "Aircraft" SET "status" = 'RETIRED' WHERE "active" = false;
