-- CreateEnum
CREATE TYPE "IropsEventType" AS ENUM ('SLOT_DELAY', 'GATE_CHANGE', 'WEATHER_HOLD', 'TECH_ISSUE', 'CREW_SHUFFLE', 'RUNWAY_CHANGE');

-- CreateEnum
CREATE TYPE "IropsSeverity" AS ENUM ('MINOR', 'MAJOR');

-- CreateTable
CREATE TABLE "IropsEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "eventType" "IropsEventType" NOT NULL,
    "severity" "IropsSeverity" NOT NULL DEFAULT 'MINOR',
    "delayMin" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IropsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IropsEvent_bookingId_idx" ON "IropsEvent"("bookingId");

-- CreateIndex
CREATE INDEX "IropsEvent_acknowledgedAt_idx" ON "IropsEvent"("acknowledgedAt");
