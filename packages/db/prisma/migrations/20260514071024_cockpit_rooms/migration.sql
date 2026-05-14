-- CreateEnum
CREATE TYPE "CockpitRoomStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CockpitRole" AS ENUM ('CAPTAIN', 'FIRST_OFFICER', 'RELIEF', 'OBSERVER');

-- CreateEnum
CREATE TYPE "CockpitMemberStatus" AS ENUM ('ACTIVE', 'LEFT');

-- CreateTable
CREATE TABLE "CockpitRoom" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "flightId" TEXT,
    "title" VARCHAR(80),
    "status" "CockpitRoomStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CockpitRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CockpitMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "role" "CockpitRole" NOT NULL DEFAULT 'FIRST_OFFICER',
    "status" "CockpitMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "CockpitMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CockpitRoom_ownerId_status_idx" ON "CockpitRoom"("ownerId", "status");

-- CreateIndex
CREATE INDEX "CockpitRoom_flightId_idx" ON "CockpitRoom"("flightId");

-- CreateIndex
CREATE INDEX "CockpitRoom_status_createdAt_idx" ON "CockpitRoom"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CockpitMember_roomId_idx" ON "CockpitMember"("roomId");

-- CreateIndex
CREATE INDEX "CockpitMember_pilotId_status_idx" ON "CockpitMember"("pilotId", "status");

-- AddForeignKey
ALTER TABLE "CockpitRoom" ADD CONSTRAINT "CockpitRoom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CockpitRoom" ADD CONSTRAINT "CockpitRoom_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CockpitMember" ADD CONSTRAINT "CockpitMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CockpitRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CockpitMember" ADD CONSTRAINT "CockpitMember_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
