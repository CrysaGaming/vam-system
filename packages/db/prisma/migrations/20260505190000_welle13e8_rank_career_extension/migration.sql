-- Welle 13E-8: Career-System integration auf Rank
--
-- Erweitert Rank um zwei felder die im career-mode aktiv werden:
--
-- 1. requiredLicenses: LicenseType[]
--    Liste der licenses die ein pilot ACTIVE haben muss um diesen rank zu
--    erreichen. Default empty-array für additive migration: existing ranks
--    behalten ihre hours-only-promotion-policy. Wenn nicht-leer, wird im
--    auto-promotion-flow (13E-9) gegen getActiveLicenses geprüft.
--
-- 2. salaryMultiplier: Decimal(4,2) DEFAULT 1.00
--    Multiplier für base-salary in der per-flight economy (13E-10). Default
--    1.00 = unchanged, ersetzt schritt für schritt die order-basierte
--    RANK_PROGRESSION_PER_ORDER-skalierung in calc.ts.
--
-- Beide felder sind additive; existing ranks brauchen kein backfill.

-- AlterTable
ALTER TABLE "Rank" ADD COLUMN     "requiredLicenses" "LicenseType"[] DEFAULT ARRAY[]::"LicenseType"[],
ADD COLUMN     "salaryMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.00;
