-- CreateEnum
CREATE TYPE "MentorshipStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'ENDED', 'REJECTED');

-- CreateTable
CREATE TABLE "Mentorship" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "status" "MentorshipStatus" NOT NULL DEFAULT 'PROPOSED',
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mentorship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mentorship_airlineId_status_idx" ON "Mentorship"("airlineId", "status");

-- CreateIndex
CREATE INDEX "Mentorship_mentorId_status_idx" ON "Mentorship"("mentorId", "status");

-- CreateIndex
CREATE INDEX "Mentorship_menteeId_status_idx" ON "Mentorship"("menteeId", "status");

-- AddForeignKey
ALTER TABLE "Mentorship" ADD CONSTRAINT "Mentorship_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mentorship" ADD CONSTRAINT "Mentorship_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mentorship" ADD CONSTRAINT "Mentorship_menteeId_fkey" FOREIGN KEY ("menteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
