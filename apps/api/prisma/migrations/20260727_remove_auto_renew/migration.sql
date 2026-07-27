-- 1. Drop partial unique index that references old enum type
DROP INDEX IF EXISTS "UserSubscription_userId_active_key";

-- 2. Update any cancelled subscriptions to expired (dev data cleanup)
UPDATE "UserSubscription" SET status = 'expired' WHERE status = 'cancelled';

-- 3. Create new SubscriptionStatus enum without 'cancelled'
DO $$ BEGIN
    CREATE TYPE "SubscriptionStatus_new" AS ENUM ('active', 'expired', 'upgraded');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 4. Alter UserSubscription.status column to use new enum
ALTER TABLE "UserSubscription" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "UserSubscription" ALTER COLUMN "status" TYPE "SubscriptionStatus_new" USING ("status"::text::"SubscriptionStatus_new");
ALTER TABLE "UserSubscription" ALTER COLUMN "status" SET DEFAULT 'active'::"SubscriptionStatus_new";

-- 5. Drop old enum type
DROP TYPE "SubscriptionStatus";

-- 6. Rename new enum to original name
ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";

-- 7. Recreate unique partial index
CREATE UNIQUE INDEX "UserSubscription_userId_active_key" ON "UserSubscription" ("userId") WHERE (status = 'active'::"SubscriptionStatus");

-- 8. Drop autoRenew and cancelledAt columns
ALTER TABLE "UserSubscription" DROP COLUMN "autoRenew";
ALTER TABLE "UserSubscription" DROP COLUMN "cancelledAt";
