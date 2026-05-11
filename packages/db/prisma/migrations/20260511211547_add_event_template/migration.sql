-- CreateTable
CREATE TABLE "EventTemplate" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'THEMED',
    "bonusReward" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxParticipants" INTEGER,
    "legs" JSONB,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventTemplate_airlineId_idx" ON "EventTemplate"("airlineId");

-- AddForeignKey
ALTER TABLE "EventTemplate" ADD CONSTRAINT "EventTemplate_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTemplate" ADD CONSTRAINT "EventTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
