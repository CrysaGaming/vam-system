-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('SPL', 'PPL', 'NIGHT_RATING', 'INSTRUMENT_RATING', 'MULTI_ENGINE_RATING', 'CPL', 'MCC', 'ATPL', 'TRI', 'TRE');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('IN_PROGRESS', 'EXAM_SCHEDULED', 'PASSED', 'FAILED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'EXPENSE_FLIGHT_SCHOOL';

-- AlterTable
ALTER TABLE "Airline" ADD COLUMN     "careerEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "careerEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PilotLicense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LicenseType" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "issuingAuthority" TEXT NOT NULL DEFAULT 'VAM-Internal',
    "certificateNumber" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TypeRating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aircraftType" TEXT NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "hoursOnType" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastFlownAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TypeRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightSchool" (
    "id" TEXT NOT NULL,
    "airportIcao" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "offeredLicenses" "LicenseType"[],
    "hourlyRateGround" DECIMAL(10,2) NOT NULL,
    "hourlyRateAir" DECIMAL(10,2) NOT NULL,
    "hourlyRateSim" DECIMAL(10,2),
    "description" TEXT,
    "logoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightSchool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightSchoolEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "licenseType" "LicenseType" NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hoursTheory" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursPractical" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursSim" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "theoryExamPassedAt" TIMESTAMP(3),
    "theoryExamScore" DOUBLE PRECISION,
    "theoryExamAttempts" INTEGER NOT NULL DEFAULT 0,
    "practicalExamScheduledAt" TIMESTAMP(3),
    "practicalExamPirepId" TEXT,
    "practicalExamPassedAt" TIMESTAMP(3),
    "practicalExamAttempts" INTEGER NOT NULL DEFAULT 0,
    "totalCostPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "resultingLicenseId" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlightSchoolEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotLicense_certificateNumber_key" ON "PilotLicense"("certificateNumber");

-- CreateIndex
CREATE INDEX "PilotLicense_userId_status_idx" ON "PilotLicense"("userId", "status");

-- CreateIndex
CREATE INDEX "PilotLicense_type_idx" ON "PilotLicense"("type");

-- CreateIndex
CREATE INDEX "PilotLicense_expiresAt_idx" ON "PilotLicense"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotLicense_userId_type_key" ON "PilotLicense"("userId", "type");

-- CreateIndex
CREATE INDEX "TypeRating_userId_idx" ON "TypeRating"("userId");

-- CreateIndex
CREATE INDEX "TypeRating_aircraftType_idx" ON "TypeRating"("aircraftType");

-- CreateIndex
CREATE INDEX "TypeRating_expiresAt_idx" ON "TypeRating"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TypeRating_userId_aircraftType_key" ON "TypeRating"("userId", "aircraftType");

-- CreateIndex
CREATE INDEX "FlightSchool_airportIcao_idx" ON "FlightSchool"("airportIcao");

-- CreateIndex
CREATE INDEX "FlightSchool_active_rating_idx" ON "FlightSchool"("active", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "FlightSchoolEnrollment_resultingLicenseId_key" ON "FlightSchoolEnrollment"("resultingLicenseId");

-- CreateIndex
CREATE INDEX "FlightSchoolEnrollment_userId_status_idx" ON "FlightSchoolEnrollment"("userId", "status");

-- CreateIndex
CREATE INDEX "FlightSchoolEnrollment_schoolId_status_idx" ON "FlightSchoolEnrollment"("schoolId", "status");

-- CreateIndex
CREATE INDEX "FlightSchoolEnrollment_status_idx" ON "FlightSchoolEnrollment"("status");

-- AddForeignKey
ALTER TABLE "PilotLicense" ADD CONSTRAINT "PilotLicense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotLicense" ADD CONSTRAINT "PilotLicense_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypeRating" ADD CONSTRAINT "TypeRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypeRating" ADD CONSTRAINT "TypeRating_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightSchool" ADD CONSTRAINT "FlightSchool_airportIcao_fkey" FOREIGN KEY ("airportIcao") REFERENCES "Airport"("icao") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightSchoolEnrollment" ADD CONSTRAINT "FlightSchoolEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightSchoolEnrollment" ADD CONSTRAINT "FlightSchoolEnrollment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "FlightSchool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

