-- Verify partial unique index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'UserSubscription'
  AND indexname = 'UserSubscription_userId_active_key';

-- Verify CHECK constraint exists
SELECT conname, pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE conname = 'UserBalance_subscription_credits_check';

-- Verify composite indexes for scheduled tasks
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'UserSubscription'
  AND indexname IN (
    'UserSubscription_status_nextGrantDate_idx',
    'UserSubscription_status_currentPeriodEnd_idx'
  );
