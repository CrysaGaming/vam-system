/*
  Warnings:

  - The primary key for the `Airline` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `code` on the `Airline` table. All the data in the column will be lost.
  - The primary key for the `Rank` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `level` on the `Rank` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Rank` table. All the data in the column will be lost.
  - The primary key for the `Role` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `updatedAt` on the `Role` table. All the data in the column will be lost.
  - The `permissions` column on the `Role` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[icao]` on the table `Airline` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[iata]` on the table `Airline` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[airlineId,name]` on the table `Rank` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[discordId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `icao` to the `Airline` table without a default value. This is not possible if the table is not empty.
  - Added the required column `airlineId` to the `Rank` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order` to the `Rank` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "FlightState" AS ENUM ('Planned', 'Departed', 'Airborne', 'Landed', 'Cancelled');

-- CreateEnum
CREATE TYPE "NetworkType" AS ENUM ('VATSIM', 'IVAO', 'Offline');

-- CreateEnum
CREATE TYPE "PirepStatus" AS ENUM ('Submitted', 'Approved', 'Rejected');

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_airlineId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_rankId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- DropIndex
DROP INDEX "Airline_code_key";

-- DropIndex
DROP INDEX "Airline_name_key";

-- DropIndex
DROP INDEX "Rank_name_key";

-- AlterTable
ALTER TABLE "Airline" DROP CONSTRAINT "Airline_pkey",
DROP COLUMN "code",
ADD COLUMN     "callsign" TEXT,
ADD COLUMN     "iata" TEXT,
ADD COLUMN     "icao" TEXT NOT NULL,
ADD COLUMN     "logoUrl" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Airline_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Airline_id_seq";

-- AlterTable
ALTER TABLE "Rank" DROP CONSTRAINT "Rank_pkey",
DROP COLUMN "level",
DROP COLUMN "updatedAt",
ADD COLUMN     "airlineId" TEXT NOT NULL,
ADD COLUMN     "minFlightHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "order" INTEGER NOT NULL,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "Rank_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Rank_id_seq";

-- AlterTable
ALTER TABLE "Role" DROP CONSTRAINT "Role_pkey",
DROP COLUMN "updatedAt",
ADD COLUMN     "description" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
DROP COLUMN "permissions",
ADD COLUMN     "permissions" TEXT[],
ADD CONSTRAINT "Role_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "Role_id_seq";

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "discordId" TEXT,
ADD COLUMN     "ivaoVid" INTEGER,
ADD COLUMN     "totalFlightHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalFlights" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vatsimCid" INTEGER,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "airlineId" SET DATA TYPE TEXT,
ALTER COLUMN "rankId" SET DATA TYPE TEXT,
ALTER COLUMN "roleId" SET DATA TYPE TEXT,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "User_id_seq";

-- CreateTable
CREATE TABLE "Aircraft" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "registration" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "homeIcao" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Airport" (
    "id" TEXT NOT NULL,
    "icao" TEXT NOT NULL,
    "iata" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation" INTEGER,

    CONSTRAINT "Airport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "departureId" TEXT NOT NULL,
    "arrivalId" TEXT NOT NULL,
    "aircraftId" TEXT,
    "estimatedMinutes" INTEGER NOT NULL,
    "distanceNm" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pirep" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routeId" TEXT,
    "aircraftId" TEXT,
    "departureId" TEXT NOT NULL,
    "arrivalId" TEXT NOT NULL,
    "state" "FlightState" NOT NULL DEFAULT 'Planned',
    "network" "NetworkType" NOT NULL DEFAULT 'Offline',
    "status" "PirepStatus" NOT NULL DEFAULT 'Submitted',
    "flightTimeMin" INTEGER,
    "fuelUsedKg" INTEGER,
    "landingRateFpm" INTEGER,
    "remarks" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "Pirep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "criteria" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenery" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT,
    "name" TEXT NOT NULL,
    "airportIcao" TEXT,
    "provider" TEXT,
    "url" TEXT,
    "free" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scenery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordRoleMapping" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "rankId" TEXT,
    "discordRoleId" TEXT NOT NULL,
    "discordGuildId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordRoleMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Aircraft_registration_key" ON "Aircraft"("registration");

-- CreateIndex
CREATE UNIQUE INDEX "Airport_icao_key" ON "Airport"("icao");

-- CreateIndex
CREATE INDEX "Route_departureId_idx" ON "Route"("departureId");

-- CreateIndex
CREATE INDEX "Route_arrivalId_idx" ON "Route"("arrivalId");

-- CreateIndex
CREATE UNIQUE INDEX "Route_airlineId_flightNumber_key" ON "Route"("airlineId", "flightNumber");

-- CreateIndex
CREATE INDEX "Pirep_userId_submittedAt_idx" ON "Pirep"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "Pirep_airlineId_status_idx" ON "Pirep"("airlineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Award_name_key" ON "Award"("name");

-- CreateIndex
CREATE UNIQUE INDEX "UserAward_userId_awardId_key" ON "UserAward"("userId", "awardId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_airlineId_userId_key_key" ON "FeatureFlag"("airlineId", "userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordRoleMapping_airlineId_discordRoleId_key" ON "DiscordRoleMapping"("airlineId", "discordRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "Airline_icao_key" ON "Airline"("icao");

-- CreateIndex
CREATE UNIQUE INDEX "Airline_iata_key" ON "Airline"("iata");

-- CreateIndex
CREATE INDEX "Rank_airlineId_order_idx" ON "Rank"("airlineId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Rank_airlineId_name_key" ON "Rank"("airlineId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rank" ADD CONSTRAINT "Rank_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_departureId_fkey" FOREIGN KEY ("departureId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_arrivalId_fkey" FOREIGN KEY ("arrivalId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_departureId_fkey" FOREIGN KEY ("departureId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_arrivalId_fkey" FOREIGN KEY ("arrivalId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAward" ADD CONSTRAINT "UserAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAward" ADD CONSTRAINT "UserAward_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "Award"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenery" ADD CONSTRAINT "Scenery_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscordRoleMapping" ADD CONSTRAINT "DiscordRoleMapping_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscordRoleMapping" ADD CONSTRAINT "DiscordRoleMapping_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
