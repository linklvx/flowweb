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

-- Y0a-1: unique constraint on CanvasDocUpdate(projectId, seq)（pg_constraint 口径）
SELECT conname FROM pg_constraint WHERE conrelid = '"CanvasDocUpdate"'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) LIKE '%projectId%seq%';

-- Y0a-1: CanvasDoc.stateSeq column NOT NULL DEFAULT 0
SELECT column_name FROM information_schema.columns WHERE table_name = 'CanvasDoc' AND column_name = 'stateSeq' AND is_nullable = 'NO' AND column_default LIKE '%0%';

-- Y0a-3（Z1）：租约行不变量——epoch 恒非空；(owner IS NULL)=(expiresAt IS NULL) 耦合
--（持有者必有过期时刻；释放后两者同 NULL；break-glass 态 owner='revoked'+expiresAt=now() 双非 NULL——不变量对全五态恒立）。
SELECT scope FROM "CollabLease" WHERE scope = 'primary' AND epoch IS NOT NULL AND (owner IS NULL) = ("expiresAt" IS NULL);

-- Y0a-3（P2）：AuditTargetType 必含 COLLAB_LEASE（break-glass/drain 审计行依赖——枚举漏迁移即红）。
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AuditTargetType' AND e.enumlabel = 'COLLAB_LEASE';

-- Y0a-1: 冗余非唯一 (projectId,seq) 索引必须不存在（否定断言：NOT EXISTS 返回 1 行=通过）
SELECT 'redundant_index_absent' AS ok WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'CanvasDocUpdate' AND indexdef LIKE '%CREATE INDEX%' AND indexdef NOT LIKE '%UNIQUE%' AND indexdef LIKE '%projectId%' AND indexdef LIKE '%seq%');
