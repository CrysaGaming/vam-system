-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mentorAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mentorBio" VARCHAR(500),
ADD COLUMN     "mentorTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];
