-- CreateTable
CREATE TABLE "AtcSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stationCallsign" VARCHAR(32) NOT NULL,
    "facilityType" VARCHAR(8) NOT NULL,
    "frequencyMhz" DOUBLE PRECISION NOT NULL,
    "controllerCid" INTEGER NOT NULL,
    "controllerName" VARCHAR(64) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtcSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtcSession_sessionId_startedAt_idx" ON "AtcSession"("sessionId", "startedAt");

-- AddForeignKey
ALTER TABLE "AtcSession" ADD CONSTRAINT "AtcSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
