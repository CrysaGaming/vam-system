-- CreateTable
CREATE TABLE "PirepComment" (
    "id" TEXT NOT NULL,
    "pirepId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "PirepComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PirepComment_pirepId_createdAt_idx" ON "PirepComment"("pirepId", "createdAt");

-- CreateIndex
CREATE INDEX "PirepComment_authorId_createdAt_idx" ON "PirepComment"("authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "PirepComment" ADD CONSTRAINT "PirepComment_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PirepComment" ADD CONSTRAINT "PirepComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
