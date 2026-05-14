-- CreateTable
CREATE TABLE "RoutePriceSnapshot" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "finalPrice" DECIMAL(14,2) NOT NULL,
    "basePrice" DECIMAL(14,2) NOT NULL,
    "demandMultiplier" DECIMAL(5,3) NOT NULL,
    "bookings7d" INTEGER NOT NULL DEFAULT 0,
    "airlineModifier" DECIMAL(5,3) NOT NULL DEFAULT 1.000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutePriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutePriceSnapshot_routeId_createdAt_idx" ON "RoutePriceSnapshot"("routeId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutePriceSnapshot_airlineId_createdAt_idx" ON "RoutePriceSnapshot"("airlineId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoutePriceSnapshot" ADD CONSTRAINT "RoutePriceSnapshot_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePriceSnapshot" ADD CONSTRAINT "RoutePriceSnapshot_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
