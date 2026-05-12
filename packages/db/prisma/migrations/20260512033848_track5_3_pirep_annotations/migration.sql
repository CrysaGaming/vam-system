-- CreateTable
CREATE TABLE "PirepAnnotation" (
    "id" TEXT NOT NULL,
    "pirepId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "frameIndex" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PirepAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PirepAnnotation_pirepId_frameIndex_idx" ON "PirepAnnotation"("pirepId", "frameIndex");

-- CreateIndex
CREATE INDEX "PirepAnnotation_authorId_createdAt_idx" ON "PirepAnnotation"("authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "PirepAnnotation" ADD CONSTRAINT "PirepAnnotation_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PirepAnnotation" ADD CONSTRAINT "PirepAnnotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
