-- Welle 13E-13: Theory-Exam Quiz-Mechanic
--
-- Erweitert das career-system um einen multiple-choice quiz für die
-- theorie-prüfung. Zwei neue tables:
--
-- 1. TheoryExamQuestion: question-bank, kategorisiert per LicenseType +
--    TheoryExamCategory. 4 options als String[], correctIndex (0-3),
--    optional explanation. Soft-delete via active=false.
--
-- 2. TheoryExamAttempt: per-enrollment attempt-record. questionIds[] +
--    answers[] arrays sind same-position-aligned. scorePercent + passed
--    werden bei submit gesetzt. Cascade-delete beim enrollment-delete.
--
-- Plus enum TheoryExamCategory mit 6 werten orientiert an EASA Part-FCL
-- syllabus (REGULATIONS/WEATHER/AERODYNAMICS/SYSTEMS/NAVIGATION/
-- HUMAN_FACTORS) für balanced random-selection in startTheoryExam.
--
-- Indices: per-licenseType+active (häufigste query "alle PPL-fragen"),
-- composite licenseType+category+active für balanced selection per
-- category, und enrollmentId+submittedAt für attempt-history.
--
-- Additive migration: keine bestehenden tables modifiziert. Existing
-- enrollments haben theoryAttempts=[] (empty back-relation).

-- CreateEnum
CREATE TYPE "TheoryExamCategory" AS ENUM ('REGULATIONS', 'WEATHER', 'AERODYNAMICS', 'SYSTEMS', 'NAVIGATION', 'HUMAN_FACTORS');

-- CreateTable
CREATE TABLE "TheoryExamQuestion" (
    "id" TEXT NOT NULL,
    "licenseType" "LicenseType" NOT NULL,
    "category" "TheoryExamCategory" NOT NULL,
    "questionText" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TheoryExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TheoryExamAttempt" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "questionIds" TEXT[],
    "answers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "scorePercent" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TheoryExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TheoryExamQuestion_licenseType_active_idx" ON "TheoryExamQuestion"("licenseType", "active");

-- CreateIndex
CREATE INDEX "TheoryExamQuestion_licenseType_category_active_idx" ON "TheoryExamQuestion"("licenseType", "category", "active");

-- CreateIndex
CREATE INDEX "TheoryExamAttempt_enrollmentId_submittedAt_idx" ON "TheoryExamAttempt"("enrollmentId", "submittedAt");

-- AddForeignKey
ALTER TABLE "TheoryExamAttempt" ADD CONSTRAINT "TheoryExamAttempt_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "FlightSchoolEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

