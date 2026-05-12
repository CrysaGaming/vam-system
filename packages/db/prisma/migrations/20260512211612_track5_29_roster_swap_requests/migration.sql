-- CreateEnum
CREATE TYPE "RosterSwapRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "RosterSwapRequest" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "requesterAssignmentId" TEXT NOT NULL,
    "targetAssignmentId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetPilotId" TEXT NOT NULL,
    "status" "RosterSwapRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" VARCHAR(500),
    "responseMessage" VARCHAR(500),
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RosterSwapRequest_targetPilotId_status_idx" ON "RosterSwapRequest"("targetPilotId", "status");

-- CreateIndex
CREATE INDEX "RosterSwapRequest_requesterId_status_idx" ON "RosterSwapRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "RosterSwapRequest_airlineId_status_idx" ON "RosterSwapRequest"("airlineId", "status");

-- CreateIndex
CREATE INDEX "RosterSwapRequest_airlineId_createdAt_idx" ON "RosterSwapRequest"("airlineId", "createdAt");

-- AddForeignKey
ALTER TABLE "RosterSwapRequest" ADD CONSTRAINT "RosterSwapRequest_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSwapRequest" ADD CONSTRAINT "RosterSwapRequest_requesterAssignmentId_fkey" FOREIGN KEY ("requesterAssignmentId") REFERENCES "RosterAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSwapRequest" ADD CONSTRAINT "RosterSwapRequest_targetAssignmentId_fkey" FOREIGN KEY ("targetAssignmentId") REFERENCES "RosterAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSwapRequest" ADD CONSTRAINT "RosterSwapRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSwapRequest" ADD CONSTRAINT "RosterSwapRequest_targetPilotId_fkey" FOREIGN KEY ("targetPilotId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
