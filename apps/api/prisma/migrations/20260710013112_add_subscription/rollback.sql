-- Rollback: Drop manually added constraints first
ALTER TABLE "UserBalance" DROP CONSTRAINT IF EXISTS "UserBalance_subscription_credits_check";
DROP INDEX IF EXISTS "UserSubscription_userId_active_key";

-- Drop subscription tables (reverse order of creation due to FK dependencies)
DROP TABLE IF EXISTS "AuditLog";
DROP TABLE IF EXISTS "CreditTransaction";
DROP TABLE IF EXISTS "SubscriptionOrder";
DROP TABLE IF EXISTS "UserSubscription";
DROP TABLE IF EXISTS "SubscriptionPlan";

-- Drop enums
DROP TYPE IF EXISTS "AuditTargetType";
DROP TYPE IF EXISTS "CreditReferenceType";
DROP TYPE IF EXISTS "CreditType";
DROP TYPE IF EXISTS "CreditTransactionType";
DROP TYPE IF EXISTS "SubscriptionOrderType";
DROP TYPE IF EXISTS "SubscriptionStatus";
DROP TYPE IF EXISTS "SubscriptionPeriod";
DROP TYPE IF EXISTS "SubscriptionTier";

-- Revert UserBalance columns
ALTER TABLE "UserBalance" DROP COLUMN IF EXISTS "subscriptionCreditsExpiry";
ALTER TABLE "UserBalance" DROP COLUMN IF EXISTS "subscriptionCredits";
