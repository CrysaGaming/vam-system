-- CreateEnum
CREATE TYPE "ScheduledFlightStatus" AS ENUM ('Planned', 'Booked', 'Completed', 'Cancelled');

-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "label" TEXT,
    "daysOfWeek" INTEGER[],
    "departureMinuteUtc" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "preferredAircraftId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledFlight" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "templateId" TEXT,
    "departureTime" TIMESTAMP(3) NOT NULL,
    "preferredAircraftId" TEXT,
    "status" "ScheduledFlightStatus" NOT NULL DEFAULT 'Planned',
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledFlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleTemplate_airlineId_active_idx" ON "ScheduleTemplate"("airlineId", "active");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_routeId_idx" ON "ScheduleTemplate"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledFlight_bookingId_key" ON "ScheduledFlight"("bookingId");

-- CreateIndex
CREATE INDEX "ScheduledFlight_airlineId_status_departureTime_idx" ON "ScheduledFlight"("airlineId", "status", "departureTime");

-- CreateIndex
CREATE INDEX "ScheduledFlight_routeId_departureTime_idx" ON "ScheduledFlight"("routeId", "departureTime");

-- CreateIndex
CREATE INDEX "ScheduledFlight_preferredAircraftId_departureTime_idx" ON "ScheduledFlight"("preferredAircraftId", "departureTime");

-- CreateIndex
CREATE INDEX "ScheduledFlight_departureTime_idx" ON "ScheduledFlight"("departureTime");

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleTemplate" ADD CONSTRAINT "ScheduleTemplate_preferredAircraftId_fkey" FOREIGN KEY ("preferredAircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledFlight" ADD CONSTRAINT "ScheduledFlight_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledFlight" ADD CONSTRAINT "ScheduledFlight_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledFlight" ADD CONSTRAINT "ScheduledFlight_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledFlight" ADD CONSTRAINT "ScheduledFlight_preferredAircraftId_fkey" FOREIGN KEY ("preferredAircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledFlight" ADD CONSTRAINT "ScheduledFlight_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
