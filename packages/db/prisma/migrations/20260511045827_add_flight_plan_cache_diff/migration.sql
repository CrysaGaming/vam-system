-- AlterTable
ALTER TABLE "FlightPlanCache" ADD COLUMN     "previousBlockTimeMin" INTEGER,
ADD COLUMN     "previousFuelKg" INTEGER,
ADD COLUMN     "previousGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "previousOfpId" TEXT,
ADD COLUMN     "previousRouteString" TEXT;
