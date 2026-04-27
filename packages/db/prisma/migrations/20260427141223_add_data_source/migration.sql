-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('VATSIM_API', 'IVAO_API', 'ACARS_CLIENT', 'MANUAL', 'REPLAY');

-- AlterTable
ALTER TABLE "LiveSession" ADD COLUMN     "acarsClientVersion" TEXT,
ADD COLUMN     "dataSource" "DataSource" NOT NULL DEFAULT 'VATSIM_API',
ADD COLUMN     "lastAcarsHeartbeat" TIMESTAMP(3);
-- Backfill existing rows: dataSource basierend auf network
UPDATE "LiveSession" SET "dataSource" = 'VATSIM_API'   WHERE "network" = 'VATSIM';
UPDATE "LiveSession" SET "dataSource" = 'IVAO_API'     WHERE "network" = 'IVAO';
UPDATE "LiveSession" SET "dataSource" = 'MANUAL'       WHERE "network" = 'Offline';