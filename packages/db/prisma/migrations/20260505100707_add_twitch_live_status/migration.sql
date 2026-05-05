-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twitchIsLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twitchLastWentLiveAt" TIMESTAMP(3),
ADD COLUMN     "twitchStreamGameName" TEXT,
ADD COLUMN     "twitchStreamThumbnailUrl" TEXT,
ADD COLUMN     "twitchStreamTitle" TEXT;
