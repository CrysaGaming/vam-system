-- CreateEnum
CREATE TYPE "ChannelPointActionType" AS ENUM ('FUEL_BONUS', 'CALLSIGN_SHOUT', 'GATE_REQUEST', 'WEATHER_NUDGE');

-- CreateEnum
CREATE TYPE "ChannelPointRedemptionStatus" AS ENUM ('EXECUTED', 'UNMATCHED', 'SKIPPED_DISABLED', 'FAILED');

-- CreateTable
CREATE TABLE "ChannelPointReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "twitchRewardId" VARCHAR(64) NOT NULL,
    "rewardTitle" VARCHAR(120) NOT NULL,
    "actionType" "ChannelPointActionType" NOT NULL,
    "payloadJson" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelPointReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPointRedemption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardId" TEXT,
    "twitchRedemptionId" VARCHAR(64) NOT NULL,
    "redeemerUsername" VARCHAR(60) NOT NULL,
    "redeemerUserInput" VARCHAR(500) NOT NULL DEFAULT '',
    "rewardTitleSnapshot" VARCHAR(120) NOT NULL,
    "status" "ChannelPointRedemptionStatus" NOT NULL,
    "errorMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelPointRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelPointReward_userId_isEnabled_idx" ON "ChannelPointReward"("userId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPointReward_userId_twitchRewardId_key" ON "ChannelPointReward"("userId", "twitchRewardId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPointRedemption_twitchRedemptionId_key" ON "ChannelPointRedemption"("twitchRedemptionId");

-- CreateIndex
CREATE INDEX "ChannelPointRedemption_userId_createdAt_idx" ON "ChannelPointRedemption"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelPointRedemption_rewardId_createdAt_idx" ON "ChannelPointRedemption"("rewardId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChannelPointReward" ADD CONSTRAINT "ChannelPointReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPointRedemption" ADD CONSTRAINT "ChannelPointRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPointRedemption" ADD CONSTRAINT "ChannelPointRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "ChannelPointReward"("id") ON DELETE SET NULL ON UPDATE CASCADE;
