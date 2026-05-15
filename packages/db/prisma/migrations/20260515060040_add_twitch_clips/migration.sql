-- CreateEnum
CREATE TYPE "TwitchClipTrigger" AS ENUM ('BUTTER_LANDING', 'HARD_LANDING', 'AWARD_GRANTED', 'MILESTONE_REACHED');

-- CreateTable
CREATE TABLE "TwitchClip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "twitchClipId" VARCHAR(64) NOT NULL,
    "editUrl" VARCHAR(500) NOT NULL,
    "trigger" "TwitchClipTrigger" NOT NULL,
    "pirepId" TEXT,
    "awardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwitchClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwitchClip_twitchClipId_key" ON "TwitchClip"("twitchClipId");

-- CreateIndex
CREATE INDEX "TwitchClip_userId_createdAt_idx" ON "TwitchClip"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TwitchClip" ADD CONSTRAINT "TwitchClip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
