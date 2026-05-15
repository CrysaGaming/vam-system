-- CreateEnum
CREATE TYPE "FlightCategory" AS ENUM ('VFR', 'MVFR', 'IFR', 'LIFR', 'UNKNOWN');

-- CreateTable
CREATE TABLE "AirportWeather" (
    "id" TEXT NOT NULL,
    "airportIcao" VARCHAR(4) NOT NULL,
    "metarRaw" TEXT NOT NULL,
    "tafRaw" TEXT,
    "ceilingFt" INTEGER,
    "visibilitySm" DOUBLE PRECISION,
    "windDirDeg" INTEGER,
    "windSpeedKt" INTEGER,
    "windGustKt" INTEGER,
    "tempC" DOUBLE PRECISION,
    "dewpointC" DOUBLE PRECISION,
    "altimeterHpa" DOUBLE PRECISION,
    "category" "FlightCategory" NOT NULL DEFAULT 'UNKNOWN',
    "rawObservationAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(40) NOT NULL DEFAULT 'aviationweather.gov',

    CONSTRAINT "AirportWeather_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AirportWeather_airportIcao_key" ON "AirportWeather"("airportIcao");

-- CreateIndex
CREATE INDEX "AirportWeather_fetchedAt_idx" ON "AirportWeather"("fetchedAt");

-- CreateIndex
CREATE INDEX "AirportWeather_category_idx" ON "AirportWeather"("category");
