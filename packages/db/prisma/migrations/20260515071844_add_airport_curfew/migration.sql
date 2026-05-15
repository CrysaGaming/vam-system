-- CreateTable
CREATE TABLE "AirportCurfew" (
    "id" TEXT NOT NULL,
    "airportIcao" VARCHAR(4) NOT NULL,
    "timezone" VARCHAR(40) NOT NULL,
    "curfewStartLocalMin" INTEGER NOT NULL,
    "curfewEndLocalMin" INTEGER NOT NULL,
    "dayMask" INTEGER NOT NULL DEFAULT 127,
    "source" VARCHAR(200),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirportCurfew_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AirportCurfew_airportIcao_key" ON "AirportCurfew"("airportIcao");
