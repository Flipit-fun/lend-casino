-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "positionId" TEXT,
ADD COLUMN     "tokenAddress" TEXT,
ADD COLUMN     "tokenAmountRaw" BIGINT,
ALTER COLUMN "amountWei" SET DEFAULT 0;
