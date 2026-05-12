-- CreateTable
CREATE TABLE "PirepPhoto" (
    "id" TEXT NOT NULL,
    "pirepId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PirepPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PirepPhoto_pirepId_createdAt_idx" ON "PirepPhoto"("pirepId", "createdAt");

-- CreateIndex
CREATE INDEX "PirepPhoto_authorId_createdAt_idx" ON "PirepPhoto"("authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "PirepPhoto" ADD CONSTRAINT "PirepPhoto_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PirepPhoto" ADD CONSTRAINT "PirepPhoto_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
