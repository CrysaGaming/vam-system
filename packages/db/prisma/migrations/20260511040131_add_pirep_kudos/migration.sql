-- CreateTable
CREATE TABLE "PirepKudos" (
    "id" TEXT NOT NULL,
    "pirepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PirepKudos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PirepKudos_userId_createdAt_idx" ON "PirepKudos"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PirepKudos_pirepId_userId_key" ON "PirepKudos"("pirepId", "userId");

-- AddForeignKey
ALTER TABLE "PirepKudos" ADD CONSTRAINT "PirepKudos_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PirepKudos" ADD CONSTRAINT "PirepKudos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
