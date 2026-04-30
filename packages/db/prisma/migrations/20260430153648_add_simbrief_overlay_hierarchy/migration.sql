-- AlterTable
ALTER TABLE "Aircraft" ADD COLUMN     "simBriefOverlay" JSONB;

-- AlterTable
ALTER TABLE "Airline" ADD COLUMN     "simBriefOverlay" JSONB;

-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "simBriefOverlay" JSONB;

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "simBriefOverlay" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_airlineId_type_key" ON "Fleet"("airlineId", "type");

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
