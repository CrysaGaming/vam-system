-- CreateTable
CREATE TABLE "BookingTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "intendedNetwork" "NetworkType",
    "legCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingTemplate_userId_createdAt_idx" ON "BookingTemplate"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingTemplate_airlineId_idx" ON "BookingTemplate"("airlineId");

-- AddForeignKey
ALTER TABLE "BookingTemplate" ADD CONSTRAINT "BookingTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTemplate" ADD CONSTRAINT "BookingTemplate_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingTemplate" ADD CONSTRAINT "BookingTemplate_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
