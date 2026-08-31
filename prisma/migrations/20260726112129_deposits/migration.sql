-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "intentExpires" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "depositTxHash" DROP NOT NULL;
