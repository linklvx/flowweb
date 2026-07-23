-- Prisma auto-generated DDL (applied via prisma db push 2026-07-23)

-- AlterTable: add balance column to UserBalance
ALTER TABLE "UserBalance" ADD COLUMN IF NOT EXISTS "balance" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum: RechargeOrderStatus
DO $$ BEGIN
    CREATE TYPE "RechargeOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: RechargeOrder
CREATE TABLE IF NOT EXISTS "RechargeOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" INTEGER NOT NULL DEFAULT 0,
    "status" "RechargeOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "payChannel" TEXT,
    "tradeNo" TEXT,
    "clientIp" TEXT,
    "notifyRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RechargeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RechargeOrder_orderNo_key" ON "RechargeOrder"("orderNo");
CREATE UNIQUE INDEX IF NOT EXISTS "RechargeOrder_tradeNo_key" ON "RechargeOrder"("tradeNo");
CREATE INDEX IF NOT EXISTS "RechargeOrder_userId_createdAt_idx" ON "RechargeOrder"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RechargeOrder_status_createdAt_idx" ON "RechargeOrder"("status", "createdAt");

-- === Manual SQL: CHECK constraints (Prisma 5.22 does not support @@check) ===
ALTER TABLE "UserBalance" ADD CONSTRAINT "user_balance_non_negative" CHECK ("balance" >= 0);
ALTER TABLE "RechargeOrder" ADD CONSTRAINT "recharge_amount_positive" CHECK ("amount" > 0);
