-- AlterTable
ALTER TABLE "AirportFrequency" ALTER COLUMN "ourAirportsId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Navaid" ALTER COLUMN "ourAirportsId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Runway" ALTER COLUMN "ourAirportsId" DROP NOT NULL;
