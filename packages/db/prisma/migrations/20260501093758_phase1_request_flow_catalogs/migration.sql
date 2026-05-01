-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('Submitted', 'UnderReview', 'Approved', 'Rejected');

-- AlterTable
ALTER TABLE "Aircraft" ADD COLUMN     "aircraftTypeId" TEXT;

-- AlterTable
ALTER TABLE "Airport" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "proposedFromRequestId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "AircraftType" (
    "id" TEXT NOT NULL,
    "icaoType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rangeNm" INTEGER NOT NULL,
    "capacityPax" INTEGER NOT NULL,
    "cruiseSpeedKt" INTEGER NOT NULL,
    "fuelBurnKgH" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "proposedFromRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AircraftType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirportRequest" (
    "id" TEXT NOT NULL,
    "icao" TEXT NOT NULL,
    "iata" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation" INTEGER,
    "status" "RequestStatus" NOT NULL DEFAULT 'Submitted',
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAirlineId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewerNotes" TEXT,
    "approvedAsVerified" BOOLEAN,

    CONSTRAINT "AirportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AircraftTypeRequest" (
    "id" TEXT NOT NULL,
    "icaoType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rangeNm" INTEGER NOT NULL,
    "capacityPax" INTEGER NOT NULL,
    "cruiseSpeedKt" INTEGER NOT NULL,
    "fuelBurnKgH" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'Submitted',
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAirlineId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewerNotes" TEXT,
    "approvedAsVerified" BOOLEAN,

    CONSTRAINT "AircraftTypeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AircraftType_icaoType_key" ON "AircraftType"("icaoType");

-- CreateIndex
CREATE UNIQUE INDEX "AircraftType_proposedFromRequestId_key" ON "AircraftType"("proposedFromRequestId");

-- CreateIndex
CREATE INDEX "AirportRequest_status_submittedAt_idx" ON "AirportRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "AirportRequest_requestedById_submittedAt_idx" ON "AirportRequest"("requestedById", "submittedAt");

-- CreateIndex
CREATE INDEX "AirportRequest_icao_idx" ON "AirportRequest"("icao");

-- CreateIndex
CREATE INDEX "AircraftTypeRequest_status_submittedAt_idx" ON "AircraftTypeRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "AircraftTypeRequest_requestedById_submittedAt_idx" ON "AircraftTypeRequest"("requestedById", "submittedAt");

-- CreateIndex
CREATE INDEX "AircraftTypeRequest_icaoType_idx" ON "AircraftTypeRequest"("icaoType");

-- CreateIndex
CREATE UNIQUE INDEX "Airport_proposedFromRequestId_key" ON "Airport"("proposedFromRequestId");

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_aircraftTypeId_fkey" FOREIGN KEY ("aircraftTypeId") REFERENCES "AircraftType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Airport" ADD CONSTRAINT "Airport_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Airport" ADD CONSTRAINT "Airport_proposedFromRequestId_fkey" FOREIGN KEY ("proposedFromRequestId") REFERENCES "AirportRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftType" ADD CONSTRAINT "AircraftType_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftType" ADD CONSTRAINT "AircraftType_proposedFromRequestId_fkey" FOREIGN KEY ("proposedFromRequestId") REFERENCES "AircraftTypeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportRequest" ADD CONSTRAINT "AirportRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportRequest" ADD CONSTRAINT "AirportRequest_requestedAirlineId_fkey" FOREIGN KEY ("requestedAirlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportRequest" ADD CONSTRAINT "AirportRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftTypeRequest" ADD CONSTRAINT "AircraftTypeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftTypeRequest" ADD CONSTRAINT "AircraftTypeRequest_requestedAirlineId_fkey" FOREIGN KEY ("requestedAirlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftTypeRequest" ADD CONSTRAINT "AircraftTypeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

