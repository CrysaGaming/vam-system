/*
  Warnings:

  - A unique constraint covering the columns `[bookingId]` on the table `Pirep` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BookingState" AS ENUM ('Created', 'SimBriefDispatched', 'Completed', 'Cancelled', 'Expired');

-- AlterTable
ALTER TABLE "Pirep" ADD COLUMN     "bookingId" TEXT;

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "state" "BookingState" NOT NULL DEFAULT 'Created',
    "intendedNetwork" "NetworkType",
    "flightPlanCacheId" TEXT,
    "simBriefOfpId" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightPlanCache" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "aircraftType" TEXT NOT NULL,
    "ofpId" TEXT NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "routeString" TEXT,
    "fuelKg" INTEGER,
    "blockTimeMin" INTEGER,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightPlanCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_userId_state_idx" ON "Booking"("userId", "state");

-- CreateIndex
CREATE INDEX "Booking_airlineId_state_idx" ON "Booking"("airlineId", "state");

-- CreateIndex
CREATE INDEX "Booking_routeId_idx" ON "Booking"("routeId");

-- CreateIndex
CREATE INDEX "Booking_expiresAt_idx" ON "Booking"("expiresAt");

-- CreateIndex
CREATE INDEX "FlightPlanCache_routeId_aircraftType_expiresAt_idx" ON "FlightPlanCache"("routeId", "aircraftType", "expiresAt");

-- CreateIndex
CREATE INDEX "FlightPlanCache_airlineId_idx" ON "FlightPlanCache"("airlineId");

-- CreateIndex
CREATE INDEX "FlightPlanCache_expiresAt_idx" ON "FlightPlanCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pirep_bookingId_key" ON "Pirep"("bookingId");

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_flightPlanCacheId_fkey" FOREIGN KEY ("flightPlanCacheId") REFERENCES "FlightPlanCache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightPlanCache" ADD CONSTRAINT "FlightPlanCache_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightPlanCache" ADD CONSTRAINT "FlightPlanCache_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
