-- AlterTable
ALTER TABLE "Airline" ADD COLUMN     "description" TEXT,
ADD COLUMN     "primaryColor" TEXT,
ADD COLUMN     "publicVisible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "secondaryColor" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "websiteUrl" TEXT;
