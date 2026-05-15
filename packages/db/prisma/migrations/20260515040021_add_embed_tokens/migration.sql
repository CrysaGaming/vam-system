-- CreateTable
CREATE TABLE "EmbedToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenString" VARCHAR(40) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "EmbedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmbedToken_tokenString_key" ON "EmbedToken"("tokenString");

-- CreateIndex
CREATE INDEX "EmbedToken_userId_revokedAt_idx" ON "EmbedToken"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "EmbedToken" ADD CONSTRAINT "EmbedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
