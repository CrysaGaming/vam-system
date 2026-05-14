-- CreateEnum
CREATE TYPE "InterAirlineTripStatus" AS ENUM ('Proposed', 'Confirmed', 'Completed', 'Cancelled');

-- CreateTable
CREATE TABLE "InterAirlineTrip" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "organizerAirlineId" TEXT NOT NULL,
    "organizerUserId" TEXT NOT NULL,
    "departureIcao" VARCHAR(10) NOT NULL,
    "arrivalIcao" VARCHAR(10) NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 0,
    "status" "InterAirlineTripStatus" NOT NULL DEFAULT 'Proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "InterAirlineTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterAirlineTripParticipant" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" VARCHAR(500),

    CONSTRAINT "InterAirlineTripParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterAirlineTrip_status_scheduledAt_idx" ON "InterAirlineTrip"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "InterAirlineTrip_organizerUserId_status_idx" ON "InterAirlineTrip"("organizerUserId", "status");

-- CreateIndex
CREATE INDEX "InterAirlineTripParticipant_userId_idx" ON "InterAirlineTripParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InterAirlineTripParticipant_tripId_userId_key" ON "InterAirlineTripParticipant"("tripId", "userId");

-- AddForeignKey
ALTER TABLE "InterAirlineTrip" ADD CONSTRAINT "InterAirlineTrip_organizerAirlineId_fkey" FOREIGN KEY ("organizerAirlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterAirlineTrip" ADD CONSTRAINT "InterAirlineTrip_organizerUserId_fkey" FOREIGN KEY ("organizerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterAirlineTripParticipant" ADD CONSTRAINT "InterAirlineTripParticipant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "InterAirlineTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterAirlineTripParticipant" ADD CONSTRAINT "InterAirlineTripParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
