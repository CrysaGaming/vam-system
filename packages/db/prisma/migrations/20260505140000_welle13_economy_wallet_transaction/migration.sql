-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('USER', 'AIRLINE', 'AIRLINE_PAYROLL', 'AIRLINE_MAINTENANCE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('REVENUE_PASSENGER', 'REVENUE_CARGO', 'REVENUE_TICKET_TWITCH', 'EXPENSE_FUEL', 'EXPENSE_LANDING_FEE', 'EXPENSE_GROUND_HANDLING', 'EXPENSE_CATERING', 'EXPENSE_MAINTENANCE', 'SALARY_PAID', 'SALARY_RECEIVED', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_ADMIN', 'ECONOMY_RESET');

-- AlterTable
ALTER TABLE "Pirep" ADD COLUMN     "revenueProcessed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revenueProcessedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "ownerType" "WalletOwnerType" NOT NULL,
    "ownerUserId" TEXT,
    "ownerAirlineId" TEXT,
    "walletType" TEXT NOT NULL DEFAULT 'primary',
    "currency" TEXT NOT NULL DEFAULT 'VAM$',
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pirepId" TEXT,
    "bookingId" TEXT,
    "counterpartyWalletId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Wallet_ownerUserId_idx" ON "Wallet"("ownerUserId");

-- CreateIndex
CREATE INDEX "Wallet_ownerAirlineId_idx" ON "Wallet"("ownerAirlineId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_ownerType_ownerUserId_ownerAirlineId_walletType_key" ON "Wallet"("ownerType", "ownerUserId", "ownerAirlineId", "walletType");

-- CreateIndex
CREATE INDEX "Transaction_walletId_createdAt_idx" ON "Transaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_pirepId_idx" ON "Transaction"("pirepId");

-- CreateIndex
CREATE INDEX "Transaction_bookingId_idx" ON "Transaction"("bookingId");

-- CreateIndex
CREATE INDEX "Transaction_walletId_type_idx" ON "Transaction"("walletId", "type");

-- CreateIndex
CREATE INDEX "Pirep_status_revenueProcessed_idx" ON "Pirep"("status", "revenueProcessed");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_ownerAirlineId_fkey" FOREIGN KEY ("ownerAirlineId") REFERENCES "Airline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_pirepId_fkey" FOREIGN KEY ("pirepId") REFERENCES "Pirep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

