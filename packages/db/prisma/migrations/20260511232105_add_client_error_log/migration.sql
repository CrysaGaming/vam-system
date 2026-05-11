-- CreateTable
CREATE TABLE "ClientErrorLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "url" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" JSONB,

    CONSTRAINT "ClientErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientErrorLog_createdAt_idx" ON "ClientErrorLog"("createdAt");

-- CreateIndex
CREATE INDEX "ClientErrorLog_userId_createdAt_idx" ON "ClientErrorLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientErrorLog_url_createdAt_idx" ON "ClientErrorLog"("url", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientErrorLog" ADD CONSTRAINT "ClientErrorLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
