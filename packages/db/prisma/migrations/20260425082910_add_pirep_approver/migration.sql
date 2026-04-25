-- AlterTable
ALTER TABLE "Pirep" ADD COLUMN     "approvedById" TEXT;

-- CreateIndex
CREATE INDEX "Pirep_approvedById_idx" ON "Pirep"("approvedById");

-- AddForeignKey
ALTER TABLE "Pirep" ADD CONSTRAINT "Pirep_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
