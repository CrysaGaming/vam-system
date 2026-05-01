-- CreateTable
CREATE TABLE "Runway" (
    "id" TEXT NOT NULL,
    "ourAirportsId" INTEGER NOT NULL,
    "airportIcao" TEXT NOT NULL,
    "lengthFt" INTEGER,
    "widthFt" INTEGER,
    "surface" TEXT,
    "lighted" BOOLEAN NOT NULL DEFAULT false,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "leIdent" TEXT,
    "leLatitude" DOUBLE PRECISION,
    "leLongitude" DOUBLE PRECISION,
    "leElevationFt" INTEGER,
    "leHeadingDegT" DOUBLE PRECISION,
    "leDisplacedFt" INTEGER,
    "heIdent" TEXT,
    "heLatitude" DOUBLE PRECISION,
    "heLongitude" DOUBLE PRECISION,
    "heElevationFt" INTEGER,
    "heHeadingDegT" DOUBLE PRECISION,
    "heDisplacedFt" INTEGER,

    CONSTRAINT "Runway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AirportFrequency" (
    "id" TEXT NOT NULL,
    "ourAirportsId" INTEGER NOT NULL,
    "airportIcao" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "frequencyMhz" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AirportFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Navaid" (
    "id" TEXT NOT NULL,
    "ourAirportsId" INTEGER NOT NULL,
    "ident" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "frequencyKhz" INTEGER,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevationFt" INTEGER,
    "isoCountry" TEXT NOT NULL,
    "dmeFrequencyKhz" INTEGER,
    "dmeChannel" TEXT,
    "dmeLatitude" DOUBLE PRECISION,
    "dmeLongitude" DOUBLE PRECISION,
    "dmeElevationFt" INTEGER,
    "slavedVariationDeg" DOUBLE PRECISION,
    "magneticVariationDeg" DOUBLE PRECISION,
    "usageType" TEXT,
    "power" TEXT,
    "associatedAirportIcao" TEXT,

    CONSTRAINT "Navaid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Runway_ourAirportsId_key" ON "Runway"("ourAirportsId");

-- CreateIndex
CREATE INDEX "Runway_airportIcao_idx" ON "Runway"("airportIcao");

-- CreateIndex
CREATE INDEX "Runway_surface_idx" ON "Runway"("surface");

-- CreateIndex
CREATE INDEX "Runway_closed_idx" ON "Runway"("closed");

-- CreateIndex
CREATE UNIQUE INDEX "AirportFrequency_ourAirportsId_key" ON "AirportFrequency"("ourAirportsId");

-- CreateIndex
CREATE INDEX "AirportFrequency_airportIcao_idx" ON "AirportFrequency"("airportIcao");

-- CreateIndex
CREATE INDEX "AirportFrequency_type_idx" ON "AirportFrequency"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Navaid_ourAirportsId_key" ON "Navaid"("ourAirportsId");

-- CreateIndex
CREATE INDEX "Navaid_associatedAirportIcao_idx" ON "Navaid"("associatedAirportIcao");

-- CreateIndex
CREATE INDEX "Navaid_type_idx" ON "Navaid"("type");

-- CreateIndex
CREATE INDEX "Navaid_ident_idx" ON "Navaid"("ident");

-- AddForeignKey
ALTER TABLE "Runway" ADD CONSTRAINT "Runway_airportIcao_fkey" FOREIGN KEY ("airportIcao") REFERENCES "Airport"("icao") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AirportFrequency" ADD CONSTRAINT "AirportFrequency_airportIcao_fkey" FOREIGN KEY ("airportIcao") REFERENCES "Airport"("icao") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Navaid" ADD CONSTRAINT "Navaid_associatedAirportIcao_fkey" FOREIGN KEY ("associatedAirportIcao") REFERENCES "Airport"("icao") ON DELETE SET NULL ON UPDATE CASCADE;
