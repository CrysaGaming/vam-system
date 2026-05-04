-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twitchAccessToken" TEXT,
ADD COLUMN     "twitchRefreshToken" TEXT,
ADD COLUMN     "twitchTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "twitchUserId" TEXT,
ADD COLUMN     "twitchUsername" TEXT,
ADD COLUMN     "twitchVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_twitchUserId_key" ON "User"("twitchUserId");

