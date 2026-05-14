-- AlterTable
ALTER TABLE "PirepPhoto" ADD COLUMN     "featuredAt" TIMESTAMP(3),
ADD COLUMN     "featuredById" TEXT;

-- CreateIndex
CREATE INDEX "PirepPhoto_featuredAt_idx" ON "PirepPhoto"("featuredAt" DESC);

-- AddForeignKey
ALTER TABLE "PirepPhoto" ADD CONSTRAINT "PirepPhoto_featuredById_fkey" FOREIGN KEY ("featuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
