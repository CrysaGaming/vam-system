-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthday" DATE,
ADD COLUMN     "birthdayPublic" BOOLEAN NOT NULL DEFAULT false;
