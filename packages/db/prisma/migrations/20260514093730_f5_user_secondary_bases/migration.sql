-- AlterTable
ALTER TABLE "User" ADD COLUMN     "secondaryBaseIcaos" TEXT[] DEFAULT ARRAY[]::TEXT[];
