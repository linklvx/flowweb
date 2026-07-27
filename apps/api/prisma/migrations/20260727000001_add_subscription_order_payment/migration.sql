-- CreateEnum
CREATE TYPE "SubscriptionOrderStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CLOSED');

-- AlterTable: ADD new columns first
ALTER TABLE "SubscriptionOrder"
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "delayCloseJobId" TEXT,
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "fromPlanId" TEXT,
ADD COLUMN     "fromSubscriptionId" TEXT,
ADD COLUMN     "notifySummary" JSONB,
ADD COLUMN     "originalAmount" INTEGER,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payChannel" VARCHAR(32) NOT NULL DEFAULT 'wechat',
ADD COLUMN     "payableAmount" INTEGER,
ADD COLUMN     "payerOpenid" VARCHAR(64),
ADD COLUMN     "prepayId" VARCHAR(64),
ADD COLUMN     "prorationAmount" INTEGER,
ADD COLUMN     "statusNew" "SubscriptionOrderStatus",
ADD COLUMN     "transactionId" VARCHAR(64),
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Data migration: copy old fields to new fields BEFORE dropping old columns
-- Amount conversion: yuan (Int) → fen (Int), multiply by 100
UPDATE "SubscriptionOrder" SET "payableAmount" = "amount" * 100 WHERE "amount" IS NOT NULL;
UPDATE "SubscriptionOrder" SET "originalAmount" = "originalPrice" * 100 WHERE "originalPrice" IS NOT NULL;
UPDATE "SubscriptionOrder" SET "prorationAmount" = "deductibleAmount" * 100 WHERE "deductibleAmount" IS NOT NULL;

-- Field rename: originalSubscriptionId → fromSubscriptionId
UPDATE "SubscriptionOrder" SET "fromSubscriptionId" = "originalSubscriptionId";

-- Status mapping: map all historical status values to new enum
-- Run pre-check: SELECT DISTINCT "status" FROM "SubscriptionOrder";
UPDATE "SubscriptionOrder" SET "statusNew" = 'SUCCESS'::"SubscriptionOrderStatus" WHERE "status" = 'success';
UPDATE "SubscriptionOrder" SET "statusNew" = 'PENDING'::"SubscriptionOrderStatus" WHERE "status" = 'pending' OR "status" = 'PENDING';
UPDATE "SubscriptionOrder" SET "statusNew" = 'CLOSED'::"SubscriptionOrderStatus" WHERE "status" = 'closed' OR "status" = 'CLOSED';
UPDATE "SubscriptionOrder" SET "statusNew" = 'FAILED'::"SubscriptionOrderStatus" WHERE "status" = 'failed' OR "status" = 'FAILED';

-- Fill timestamps
UPDATE "SubscriptionOrder" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

-- Now DROP old columns (data already copied)
ALTER TABLE "SubscriptionOrder" DROP COLUMN "amount",
DROP COLUMN "deductibleAmount",
DROP COLUMN "originalPrice",
DROP COLUMN "originalSubscriptionId";

-- Change default on status (new orders start as PENDING)
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING';
