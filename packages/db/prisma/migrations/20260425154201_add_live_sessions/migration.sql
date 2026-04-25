-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "network" "NetworkType" NOT NULL,
    "externalId" INTEGER NOT NULL,
    "callsign" TEXT NOT NULL,
    "aircraftType" TEXT,
    "aircraftRegistration" TEXT,
    "departureIcao" TEXT,
    "arrivalIcao" TEXT,
    "alternateIcao" TEXT,
    "cruiseAltitude" INTEGER,
    "flightRules" TEXT,
    "flightRoute" TEXT,
    "flightRemarks" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude" INTEGER NOT NULL,
    "groundSpeed" INTEGER NOT NULL,
    "heading" INTEGER NOT NULL,
    "transponder" TEXT,
    "onGround" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSessionPosition" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude" INTEGER NOT NULL,
    "groundSpeed" INTEGER NOT NULL,
    "heading" INTEGER NOT NULL,
    "onGround" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSessionPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveSession_userId_isActive_idx" ON "LiveSession"("userId", "isActive");

-- CreateIndex
CREATE INDEX "LiveSession_network_isActive_idx" ON "LiveSession"("network", "isActive");

-- CreateIndex
CREATE INDEX "LiveSession_lastUpdatedAt_idx" ON "LiveSession"("lastUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSession_network_externalId_key" ON "LiveSession"("network", "externalId");

-- CreateIndex
CREATE INDEX "LiveSessionPosition_sessionId_recordedAt_idx" ON "LiveSessionPosition"("sessionId", "recordedAt");

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSessionPosition" ADD CONSTRAINT "LiveSessionPosition_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
