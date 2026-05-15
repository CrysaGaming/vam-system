-- CreateEnum
CREATE TYPE "EmergencyType" AS ENUM ('RAPID_DESCENT', 'HARD_LANDING', 'ACARS_INCIDENT');

-- CreateEnum
CREATE TYPE "EmergencySeverity" AS ENUM ('INCIDENT', 'EMERGENCY', 'MAYDAY');

-- CreateTable
CREATE TABLE "EmergencyReport" (
    "id" TEXT NOT NULL,
    "pirepId" TEXT NOT NULL,
    "type" "EmergencyType" NOT NULL,
    "severity" "EmergencySeverity" NOT NULL DEFAULT 'EMERGENCY',
    "autoDetected" BOOLEAN NOT NULL DEFAULT true,
    "details" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmergencyReport_pirepId_idx" ON "EmergencyReport"("pirepId");

-- CreateIndex
CREATE INDEX "EmergencyReport_type_severity_idx" ON "EmergencyReport"("type", "severity");

-- AddForeignKey
ALTER TABLE "EmergencyReport" ADD CONSTRAINT "EmergencyReport_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
