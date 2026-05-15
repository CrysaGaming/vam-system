-- CreateEnum
CREATE TYPE "VamseTradeKind" AS ENUM ('BUY', 'SELL');

-- CreateTable
CREATE TABLE "VamseStock" (
    "id" TEXT NOT NULL,
    "airlineId" TEXT NOT NULL,
    "tickerSymbol" VARCHAR(6) NOT NULL,
    "currentPrice" DECIMAL(12,4) NOT NULL,
    "totalShares" INTEGER NOT NULL DEFAULT 1000,
    "sharesOutstanding" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastPricedAt" TIMESTAMP(3),

    CONSTRAINT "VamseStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VamseStockSnapshot" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "price" DECIMAL(12,4) NOT NULL,
    "pireps7d" INTEGER NOT NULL,
    "totalRevenue7d" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VamseStockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VamseHolding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "avgPurchasePrice" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VamseHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VamseTrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "kind" "VamseTradeKind" NOT NULL,
    "shares" INTEGER NOT NULL,
    "pricePerShare" DECIMAL(12,4) NOT NULL,
    "totalVam" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VamseTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VamseStock_airlineId_key" ON "VamseStock"("airlineId");

-- CreateIndex
CREATE INDEX "VamseStockSnapshot_stockId_createdAt_idx" ON "VamseStockSnapshot"("stockId", "createdAt");

-- CreateIndex
CREATE INDEX "VamseHolding_userId_idx" ON "VamseHolding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VamseHolding_userId_stockId_key" ON "VamseHolding"("userId", "stockId");

-- CreateIndex
CREATE INDEX "VamseTrade_userId_createdAt_idx" ON "VamseTrade"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VamseTrade_stockId_createdAt_idx" ON "VamseTrade"("stockId", "createdAt");

-- AddForeignKey
ALTER TABLE "VamseStock" ADD CONSTRAINT "VamseStock_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VamseStockSnapshot" ADD CONSTRAINT "VamseStockSnapshot_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "VamseStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VamseHolding" ADD CONSTRAINT "VamseHolding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VamseHolding" ADD CONSTRAINT "VamseHolding_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "VamseStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VamseTrade" ADD CONSTRAINT "VamseTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VamseTrade" ADD CONSTRAINT "VamseTrade_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "VamseStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
