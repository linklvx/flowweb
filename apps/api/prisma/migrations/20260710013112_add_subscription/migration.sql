-- Prisma auto-generated DDL (applied via prisma db push 2026-07-10)

-- === Manual SQL: Partially unique index (Prisma does not support WHERE clause) ===
-- Ensures only ONE active subscription per user at database level
CREATE UNIQUE INDEX IF NOT EXISTS "UserSubscription_userId_active_key"
  ON "UserSubscription" ("userId")
  WHERE "status" = 'active';

-- === Manual SQL: CHECK constraint ===
-- Ensures subscriptionCredits > 0 implies subscriptionCreditsExpiry IS NOT NULL
ALTER TABLE "UserBalance"
  ADD CONSTRAINT "UserBalance_subscription_credits_check"
  CHECK ("subscriptionCredits" = 0 OR "subscriptionCreditsExpiry" IS NOT NULL);
