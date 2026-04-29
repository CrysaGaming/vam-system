-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_flightPlanCacheId_fkey";

-- DropForeignKey
ALTER TABLE "FlightPlanCache" DROP CONSTRAINT "FlightPlanCache_routeId_fkey";

-- DropIndex
DROP INDEX "FlightPlanCache_routeId_aircraftType_expiresAt_idx";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "flightPlanCacheId",
DROP COLUMN "simBriefOfpId";

-- AlterTable
ALTER TABLE "FlightPlanCache" DROP COLUMN "aircraftType",
DROP COLUMN "routeId",
ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "pirepId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FlightPlanCache_bookingId_key" ON "FlightPlanCache"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "FlightPlanCache_pirepId_key" ON "FlightPlanCache"("pirepId");

-- AddForeignKey
ALTER TABLE "FlightPlanCache" ADD CONSTRAINT "FlightPlanCache_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightPlanCache" ADD CONSTRAINT "FlightPlanCache_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
