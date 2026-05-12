-- CreateEnum
CREATE TYPE "RosterAssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'COMPLETED', 'SWAPPED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "RosterAssignment" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "scheduledFlightId" TEXT NOT NULL,
    "status" "RosterAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAircraftId" TEXT,
    "assignedById" TEXT,
    "note" VARCHAR(500),
    "pirepId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RosterAssignment_pirepId_key" ON "RosterAssignment"("pirepId");

-- CreateIndex
CREATE INDEX "RosterAssignment_airlineId_status_idx" ON "RosterAssignment"("airlineId", "status");

-- CreateIndex
CREATE INDEX "RosterAssignment_pilotId_status_idx" ON "RosterAssignment"("pilotId", "status");

-- CreateIndex
CREATE INDEX "RosterAssignment_scheduledFlightId_idx" ON "RosterAssignment"("scheduledFlightId");

-- CreateIndex
CREATE INDEX "RosterAssignment_airlineId_createdAt_idx" ON "RosterAssignment"("airlineId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RosterAssignment_pilotId_scheduledFlightId_key" ON "RosterAssignment"("pilotId", "scheduledFlightId");

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_scheduledFlightId_fkey" FOREIGN KEY ("scheduledFlightId") REFERENCES "ScheduledFlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_assignedAircraftId_fkey" FOREIGN KEY ("assignedAircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
