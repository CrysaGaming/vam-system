-- AlterTable
ALTER TABLE "AdminAuditLog" ADD COLUMN     "airlineId" TEXT;

-- CreateIndex
CREATE INDEX "AdminAuditLog_airlineId_createdAt_idx" ON "AdminAuditLog"("airlineId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
