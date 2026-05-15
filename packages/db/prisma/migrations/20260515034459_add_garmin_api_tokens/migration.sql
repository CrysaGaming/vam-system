-- CreateTable
CREATE TABLE "GarminApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "tokenSuffix" VARCHAR(4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GarminApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GarminApiToken_tokenHash_key" ON "GarminApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "GarminApiToken_userId_revokedAt_idx" ON "GarminApiToken"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "GarminApiToken" ADD CONSTRAINT "GarminApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
