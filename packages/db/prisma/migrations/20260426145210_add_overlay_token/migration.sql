/*
  Warnings:

  - A unique constraint covering the columns `[overlayToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "overlayToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_overlayToken_key" ON "User"("overlayToken");
