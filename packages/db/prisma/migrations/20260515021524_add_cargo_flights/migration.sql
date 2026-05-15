-- AlterEnum
ALTER TYPE "FlightType" ADD VALUE 'CARGO';

-- CreateTable
CREATE TABLE "CargoLoadSpec" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "cargoTonnageKg" INTEGER NOT NULL,
    "payoutMultiplier" DECIMAL(5,3) NOT NULL DEFAULT 1.300,
    "cargoCategory" VARCHAR(50) NOT NULL DEFAULT 'general-freight',
    "notes" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CargoLoadSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CargoLoadSpec_routeId_key" ON "CargoLoadSpec"("routeId");

-- AddForeignKey
ALTER TABLE "CargoLoadSpec" ADD CONSTRAINT "CargoLoadSpec_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
