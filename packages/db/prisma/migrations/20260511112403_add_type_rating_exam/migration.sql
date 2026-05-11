-- CreateEnum
CREATE TYPE "TypeRatingExamStatus" AS ENUM ('SCHEDULED', 'PASSED', 'FAILED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "TypeRatingExam" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "aircraftType" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "examinerId" TEXT,
    "status" "TypeRatingExamStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "resultNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "typeRatingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TypeRatingExam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TypeRatingExam_typeRatingId_key" ON "TypeRatingExam"("typeRatingId");

-- CreateIndex
CREATE INDEX "TypeRatingExam_airlineId_status_scheduledFor_idx" ON "TypeRatingExam"("airlineId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "TypeRatingExam_userId_idx" ON "TypeRatingExam"("userId");

-- CreateIndex
CREATE INDEX "TypeRatingExam_examinerId_idx" ON "TypeRatingExam"("examinerId");

-- AddForeignKey
ALTER TABLE "TypeRatingExam" ADD CONSTRAINT "TypeRatingExam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypeRatingExam" ADD CONSTRAINT "TypeRatingExam_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypeRatingExam" ADD CONSTRAINT "TypeRatingExam_examinerId_fkey" FOREIGN KEY ("examinerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypeRatingExam" ADD CONSTRAINT "TypeRatingExam_typeRatingId_fkey" FOREIGN KEY ("typeRatingId") REFERENCES "TypeRating"("id") ON DELETE SET NULL ON UPDATE CASCADE;
