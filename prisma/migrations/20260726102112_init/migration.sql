-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('PENDING', 'OPEN', 'SETTLING', 'CLOSED', 'LIQUIDATED');

-- CreateEnum
CREATE TYPE "RedeemMethod" AS ENUM ('ETH', 'CHIPS');

-- CreateEnum
CREATE TYPE "RedeemStatus" AS ENUM ('QUOTED', 'PAID', 'RELEASING', 'RELEASED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('COLLATERAL_DRAW', 'BET_STAKE', 'BET_RETURN', 'CHIP_SALE', 'REDEEM_BURN', 'LIQUIDATION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutKind" AS ENUM ('CHIP_SALE', 'COLLATERAL_RELEASE');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "GameKind" AS ENUM ('ROLLIT', 'COIN', 'BLACKJACK', 'MINES', 'DICE', 'HILO');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('ACTIVE', 'SETTLED', 'VOIDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chipsCents" BIGINT NOT NULL DEFAULT 0,
    "clientSeed" TEXT NOT NULL,
    "serverSeedId" TEXT,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bannedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "ltvBps" INTEGER NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minDepositRaw" BIGINT NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "ticketNo" SERIAL NOT NULL,
    "qtyRaw" BIGINT NOT NULL,
    "markPriceCents" BIGINT NOT NULL,
    "valueCents" BIGINT NOT NULL,
    "drawnCents" BIGINT NOT NULL,
    "debtCents" BIGINT NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "depositTxHash" TEXT NOT NULL,
    "releaseTxHash" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "method" "RedeemMethod" NOT NULL,
    "quotedEthWei" BIGINT,
    "quoteExpires" TIMESTAMP(3),
    "paidTxHash" TEXT,
    "chipsBurned" BIGINT,
    "status" "RedeemStatus" NOT NULL DEFAULT 'QUOTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deltaCents" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PayoutKind" NOT NULL,
    "amountWei" BIGINT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'QUEUED',
    "txHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerSeed" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "seedHash" TEXT NOT NULL,
    "revealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerSeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "game" "GameKind" NOT NULL,
    "stakeCents" BIGINT NOT NULL,
    "state" JSONB NOT NULL,
    "serverSeedId" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "outcome" JSONB,
    "returnCents" BIGINT,
    "status" "RoundStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "GameRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositWatch" (
    "id" TEXT NOT NULL,
    "lastBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedTx" (
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "handledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedTx_pkey" PRIMARY KEY ("txHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tokenAddress_key" ON "Asset"("tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Position_ticketNo_key" ON "Position"("ticketNo");

-- CreateIndex
CREATE UNIQUE INDEX "Position_depositTxHash_key" ON "Position"("depositTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_paidTxHash_key" ON "Redemption"("paidTxHash");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_txHash_key" ON "Payout"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GameRound_userId_createdAt_idx" ON "GameRound"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedTx_txHash_logIndex_key" ON "ProcessedTx"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_assetSymbol_fkey" FOREIGN KEY ("assetSymbol") REFERENCES "Asset"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerSeed" ADD CONSTRAINT "ServerSeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRound" ADD CONSTRAINT "GameRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
