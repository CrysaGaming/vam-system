-- AlterTable
ALTER TABLE "User" ADD COLUMN     "overlayLayout" TEXT NOT NULL DEFAULT 'bar',
ADD COLUMN     "overlayPhaseColors" JSONB;
