-- CreateEnum
CREATE TYPE "Simulator" AS ENUM ('MSFS', 'P3D', 'XPLANE', 'FSX');

-- CreateEnum
CREATE TYPE "AcarsEventType" AS ENUM ('PHASE_CHANGE', 'TOUCHDOWN', 'BLOCK_ON', 'BLOCK_OFF', 'INCIDENT', 'CONNECTION_LOST', 'CONNECTION_RESUMED');

-- AlterTable
ALTER TABLE "LiveSession" ADD COLUMN     "acarsSimulator" "Simulator",
ADD COLUMN     "aircraftTitle" TEXT,
ADD COLUMN     "altitudeAglFt" INTEGER,
ADD COLUMN     "autopilotMaster" BOOLEAN,
ADD COLUMN     "bank" DOUBLE PRECISION,
ADD COLUMN     "currentPhase" TEXT,
ADD COLUMN     "engineN1Avg" DOUBLE PRECISION,
ADD COLUMN     "engineN2Avg" DOUBLE PRECISION,
ADD COLUMN     "flapsPercent" INTEGER,
ADD COLUMN     "flightNumber" TEXT,
ADD COLUMN     "fuelFlowPph" INTEGER,
ADD COLUMN     "fuelTotalKg" INTEGER,
ADD COLUMN     "gForce" DOUBLE PRECISION,
ADD COLUMN     "gearDown" BOOLEAN,
ADD COLUMN     "indicatedAirspeed" INTEGER,
ADD COLUMN     "mach" DOUBLE PRECISION,
ADD COLUMN     "oatCelsius" INTEGER,
ADD COLUMN     "parkingBrake" BOOLEAN,
ADD COLUMN     "pitch" DOUBLE PRECISION,
ADD COLUMN     "simRate" DOUBLE PRECISION,
ADD COLUMN     "spoilersDeployed" BOOLEAN,
ADD COLUMN     "totalPauseSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trueAirspeed" INTEGER,
ADD COLUMN     "verticalSpeedFpm" INTEGER,
ADD COLUMN     "windDirection" INTEGER,
ADD COLUMN     "windSpeedKts" INTEGER;

-- AlterTable
ALTER TABLE "LiveSessionPosition" ADD COLUMN     "altitudeAglFt" INTEGER,
ADD COLUMN     "bank" DOUBLE PRECISION,
ADD COLUMN     "flapsPercent" INTEGER,
ADD COLUMN     "gearDown" BOOLEAN,
ADD COLUMN     "indicatedAirspeed" INTEGER,
ADD COLUMN     "phase" TEXT,
ADD COLUMN     "pitch" DOUBLE PRECISION,
ADD COLUMN     "verticalSpeedFpm" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acarsLastSeen" TIMESTAMP(3),
ADD COLUMN     "acarsPairedAt" TIMESTAMP(3),
ADD COLUMN     "acarsToken" TEXT,
ADD COLUMN     "preferredNetwork" "NetworkType" NOT NULL DEFAULT 'Offline';

-- CreateTable
CREATE TABLE "AcarsPairingCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcarsPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcarsEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "AcarsEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "triggeredPirepId" TEXT,

    CONSTRAINT "AcarsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcarsPairingCode_code_key" ON "AcarsPairingCode"("code");

-- CreateIndex
CREATE INDEX "AcarsPairingCode_code_idx" ON "AcarsPairingCode"("code");

-- CreateIndex
CREATE INDEX "AcarsPairingCode_userId_consumedAt_idx" ON "AcarsPairingCode"("userId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AcarsEvent_triggeredPirepId_key" ON "AcarsEvent"("triggeredPirepId");

-- CreateIndex
CREATE INDEX "AcarsEvent_sessionId_type_timestamp_idx" ON "AcarsEvent"("sessionId", "type", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "User_acarsToken_key" ON "User"("acarsToken");

-- AddForeignKey
ALTER TABLE "AcarsPairingCode" ADD CONSTRAINT "AcarsPairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcarsEvent" ADD CONSTRAINT "AcarsEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcarsEvent" ADD CONSTRAINT "AcarsEvent_triggeredPirepId_fkey" FOREIGN KEY ("triggeredPirepId") REFERENCES "Pirep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

