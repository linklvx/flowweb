-- 订阅域关键索引/约束存在性断言（runner: scripts/verify-indexes.mjs——逐块执行并断言每块 ≥1 行，
-- 从机制上消灭"查询名不存在⇒恒空集⇒静默通过"；运行时机：上线前/订阅迁移后，见 docs/README.md 运维节）

-- 活跃订阅唯一 partial unique index（迁移 20260829201000 创建，真名 user_subscription_one_active）
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'UserSubscription'
  AND indexname = 'user_subscription_one_active';

-- 定时任务复合索引（init 迁移 :701/:704）
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'UserSubscription'
  AND indexname IN (
    'UserSubscription_status_nextGrantDate_idx',
    'UserSubscription_status_currentPeriodEnd_idx'
  );
