-- CreateTable
CREATE TABLE "AirportFuelPrice" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "icao" VARCHAR(10) NOT NULL,
    "pricePerGallon" DECIMAL(8,3) NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportFuelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AirportFuelPrice_airlineId_idx" ON "AirportFuelPrice"("airlineId");

-- CreateIndex
CREATE UNIQUE INDEX "AirportFuelPrice_airlineId_icao_key" ON "AirportFuelPrice"("airlineId", "icao");

-- AddForeignKey
ALTER TABLE "AirportFuelPrice" ADD CONSTRAINT "AirportFuelPrice_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
