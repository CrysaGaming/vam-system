-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PreFlightCheck', 'ACheck', 'BCheck', 'CCheck', 'DCheck', 'Repair', 'OilChange', 'TireReplacement', 'EngineWork', 'AvionicsUpdate', 'Other');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('Scheduled', 'InProgress', 'Completed', 'Cancelled');

-- CreateTable
CREATE TABLE "MaintenanceEvent" (
    "id" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'Scheduled',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "costVam" DECIMAL(14,2),
    "nextDueAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "MaintenanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceEvent_airlineId_status_scheduledStart_idx" ON "MaintenanceEvent"("airlineId", "status", "scheduledStart");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_aircraftId_scheduledStart_idx" ON "MaintenanceEvent"("aircraftId", "scheduledStart");

-- CreateIndex
CREATE INDEX "MaintenanceEvent_airlineId_nextDueAt_idx" ON "MaintenanceEvent"("airlineId", "nextDueAt");

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceEvent" ADD CONSTRAINT "MaintenanceEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
