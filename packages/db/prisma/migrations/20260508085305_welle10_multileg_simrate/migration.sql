-- AlterEnum
ALTER TYPE "BookingState" ADD VALUE 'InProgress';

-- AlterTable
ALTER TABLE "Airline" ADD COLUMN     "enforceSimRate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "legCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "legsCompleted" INTEGER NOT NULL DEFAULT 0;
