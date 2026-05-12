-- CreateEnum
CREATE TYPE "PilotGoalKind" AS ENUM ('WeeklyFlights', 'WeeklyHours', 'MonthlyFlights', 'MonthlyHours');

-- CreateTable
CREATE TABLE "PilotGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PilotGoalKind" NOT NULL,
    "target" INTEGER NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastIncrementedPeriod" TEXT,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PilotGoal_userId_idx" ON "PilotGoal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PilotGoal_userId_kind_key" ON "PilotGoal"("userId", "kind");

-- AddForeignKey
ALTER TABLE "PilotGoal" ADD CONSTRAINT "PilotGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
