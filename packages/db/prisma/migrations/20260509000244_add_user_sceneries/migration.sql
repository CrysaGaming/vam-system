-- CreateTable
CREATE TABLE "UserScenery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sceneryId" TEXT NOT NULL,
    "ownedSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "UserScenery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserScenery_userId_idx" ON "UserScenery"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserScenery_userId_sceneryId_key" ON "UserScenery"("userId", "sceneryId");

-- AddForeignKey
ALTER TABLE "UserScenery" ADD CONSTRAINT "UserScenery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScenery" ADD CONSTRAINT "UserScenery_sceneryId_fkey" FOREIGN KEY ("sceneryId") REFERENCES "Scenery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
