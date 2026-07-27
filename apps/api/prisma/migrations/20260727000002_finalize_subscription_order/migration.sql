-- Drop old String "status" column (data already in statusNew via previous migration)
ALTER TABLE "SubscriptionOrder" DROP COLUMN "status";

-- Rename statusNew to status (preserving data — do NOT let Prisma DROP+ADD)
ALTER TABLE "SubscriptionOrder" RENAME COLUMN "statusNew" TO "status";

-- Enforce NOT NULL + default on the renamed column
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"SubscriptionOrderStatus";

-- Enforce NOT NULL on mandatory columns (data was backfilled in Step1 migration)
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "originalAmount" SET NOT NULL;
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "payableAmount" SET NOT NULL;

-- updatedAt: add NOT NULL + @updatedAt trigger (data backfilled in Step1)
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "updatedAt" SET NOT NULL;
-- Prisma auto-trigger for @updatedAt
CREATE OR REPLACE FUNCTION prismarails_updated_at_step1() RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "SubscriptionOrder_updatedAt_trigger" ON "SubscriptionOrder";
CREATE TRIGGER "SubscriptionOrder_updatedAt_trigger"
  BEFORE UPDATE ON "SubscriptionOrder"
  FOR EACH ROW EXECUTE FUNCTION prismarails_updated_at_step1();

-- Unique partial index on transactionId (multiple NULLs are distinct in PostgreSQL)
CREATE UNIQUE INDEX "SubscriptionOrder_transactionId_key"
  ON "SubscriptionOrder" ("transactionId")
  WHERE "transactionId" IS NOT NULL;

-- Composite indexes for business queries
CREATE INDEX "SubscriptionOrder_userId_status_idx" ON "SubscriptionOrder" ("userId", "status");
CREATE INDEX "SubscriptionOrder_status_expiredAt_idx" ON "SubscriptionOrder" ("status", "expiredAt");
