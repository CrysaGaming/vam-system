-- CreateEnum
CREATE TYPE "FlightType" AS ENUM ('SCHEDULED', 'CHARTER', 'POSITIONING', 'TRAINING', 'FREE');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('MANUAL', 'PIREP', 'ACARS', 'VATSIM', 'IVAO', 'JUMPSEAT');

-- CreateEnum
CREATE TYPE "JumpseatReason" AS ENUM ('RETURN_TO_HUB', 'HUB_TO_HUB', 'POSITIONING', 'ADMIN_TRANSFER');

-- AlterTable
ALTER TABLE "Airline" ADD COLUMN     "economyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "flightType" "FlightType" NOT NULL DEFAULT 'SCHEDULED';

-- AlterTable
ALTER TABLE "Pirep" ADD COLUMN     "cargoKg" INTEGER,
ADD COLUMN     "flightType" "FlightType" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN     "passengerCount" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseIcao" TEXT,
ADD COLUMN     "currentLocationAt" TIMESTAMP(3),
ADD COLUMN     "currentLocationIcao" TEXT,
ADD COLUMN     "currentLocationSource" "LocationSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "economyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AirlineHub" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "airportIcao" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirlineHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JumpseatTransfer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromIcao" TEXT NOT NULL,
    "toIcao" TEXT NOT NULL,
    "reason" "JumpseatReason" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JumpseatTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AirlineHub_airlineId_isPrimary_idx" ON "AirlineHub"("airlineId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "AirlineHub_airlineId_airportIcao_key" ON "AirlineHub"("airlineId", "airportIcao");

-- CreateIndex
CREATE INDEX "JumpseatTransfer_userId_createdAt_idx" ON "JumpseatTransfer"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "JumpseatTransfer_toIcao_createdAt_idx" ON "JumpseatTransfer"("toIcao", "createdAt");

-- AddForeignKey
ALTER TABLE "AirlineHub" ADD CONSTRAINT "AirlineHub_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirlineHub" ADD CONSTRAINT "AirlineHub_airportIcao_fkey" FOREIGN KEY ("airportIcao") REFERENCES "Airport"("icao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JumpseatTransfer" ADD CONSTRAINT "JumpseatTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JumpseatTransfer" ADD CONSTRAINT "JumpseatTransfer_fromIcao_fkey" FOREIGN KEY ("fromIcao") REFERENCES "Airport"("icao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JumpseatTransfer" ADD CONSTRAINT "JumpseatTransfer_toIcao_fkey" FOREIGN KEY ("toIcao") REFERENCES "Airport"("icao") ON DELETE RESTRICT ON UPDATE CASCADE;
