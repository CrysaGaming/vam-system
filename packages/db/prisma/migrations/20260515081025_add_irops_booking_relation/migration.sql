-- AddForeignKey
ALTER TABLE "IropsEvent" ADD CONSTRAINT "IropsEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
