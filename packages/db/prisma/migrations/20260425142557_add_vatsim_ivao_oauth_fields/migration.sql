/*
  Warnings:

  - A unique constraint covering the columns `[vatsimCid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[ivaoVid]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ivaoAccessToken" TEXT,
ADD COLUMN     "ivaoRefreshToken" TEXT,
ADD COLUMN     "ivaoTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "ivaoVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "vatsimAccessToken" TEXT,
ADD COLUMN     "vatsimRefreshToken" TEXT,
ADD COLUMN     "vatsimTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "vatsimVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_vatsimCid_key" ON "User"("vatsimCid");

-- CreateIndex
CREATE UNIQUE INDEX "User_ivaoVid_key" ON "User"("ivaoVid");
