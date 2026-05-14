-- CreateEnum
CREATE TYPE "CrewPairingStatus" AS ENUM ('Draft', 'Published', 'Assigned', 'InProgress', 'Completed', 'Cancelled');

-- CreateTable
CREATE TABLE "CrewPairing" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "status" "CrewPairingStatus" NOT NULL DEFAULT 'Draft',
    "assignedPilotId" TEXT,
    "createdById" TEXT NOT NULL,
    "totalDurationMin" INTEGER NOT NULL DEFAULT 0,
    "legCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "CrewPairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewPairingLeg" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "scheduledFlightId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "layoverHoursAfter" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewPairingLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrewPairing_airlineId_status_startsAt_idx" ON "CrewPairing"("airlineId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "CrewPairing_assignedPilotId_status_idx" ON "CrewPairing"("assignedPilotId", "status");

-- CreateIndex
CREATE INDEX "CrewPairingLeg_scheduledFlightId_idx" ON "CrewPairingLeg"("scheduledFlightId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewPairingLeg_pairingId_sequence_key" ON "CrewPairingLeg"("pairingId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CrewPairingLeg_pairingId_scheduledFlightId_key" ON "CrewPairingLeg"("pairingId", "scheduledFlightId");

-- AddForeignKey
ALTER TABLE "CrewPairing" ADD CONSTRAINT "CrewPairing_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPairing" ADD CONSTRAINT "CrewPairing_assignedPilotId_fkey" FOREIGN KEY ("assignedPilotId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPairing" ADD CONSTRAINT "CrewPairing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPairingLeg" ADD CONSTRAINT "CrewPairingLeg_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "CrewPairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPairingLeg" ADD CONSTRAINT "CrewPairingLeg_scheduledFlightId_fkey" FOREIGN KEY ("scheduledFlightId") REFERENCES "ScheduledFlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
