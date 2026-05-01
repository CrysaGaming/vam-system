-- AlterTable
ALTER TABLE "Airport" ADD COLUMN     "continent" TEXT,
ADD COLUMN     "gpsCode" TEXT,
ADD COLUMN     "scheduledService" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" TEXT,
ADD COLUMN     "wikipediaLink" TEXT;

-- CreateIndex
CREATE INDEX "Airport_type_idx" ON "Airport"("type");

-- CreateIndex
CREATE INDEX "Airport_continent_idx" ON "Airport"("continent");

-- CreateIndex
CREATE INDEX "Airport_country_idx" ON "Airport"("country");

-- CreateIndex
CREATE INDEX "Airport_scheduledService_idx" ON "Airport"("scheduledService");
