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

-- ============ Y0b-1 T1a（Z2）：census 对象定义断言——存在性+定义（防被重建为普通索引/序列静默丢失） ============
SELECT indexdef FROM pg_indexes WHERE indexname='generation_intent_active_node_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='team_owner_default_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='user_subscription_one_active' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='team_subscription_one_active' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='announcement_single_active' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='folder_team_root_name_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='folder_team_parent_name_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='material_folder_team_root_name_unique' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='material_folder_team_parent_name_unique' AND indexdef LIKE '%WHERE%';

SELECT 'seq-ok' AS assert WHERE EXISTS (SELECT 1 FROM pg_class WHERE relkind='S' AND relname='canvas_doc_update_seq');

SELECT conname FROM pg_constraint WHERE conname='CanvasDocUpdate_projectId_seq_key';

SELECT COUNT(*) AS n FROM "CollabLease" HAVING COUNT(*) >= 1;

SELECT 'fake-pricing-unique-gone' AS assert WHERE NOT EXISTS (
  SELECT 1 FROM pg_indexes WHERE indexname='PricingRule_nodeTypeId_modelId_resolutionId_durationId_key'
);

SELECT 'consumption-gone' AS assert WHERE NOT EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
  WHERE t.typname='TeamCreditTransactionType' AND e.enumlabel='consumption'
);

SELECT 'release-in-enum' AS assert WHERE EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
  WHERE t.typname='TeamCreditTransactionType' AND e.enumlabel='release'
);

-- ============ Y0b-1 T1b：资金不变量定义断言 ============
SELECT indexdef FROM pg_indexes WHERE indexname='pricing_rule_natural_key' AND indexdef LIKE '%NULLS NOT DISTINCT%';

SELECT indexdef FROM pg_indexes WHERE indexname='money_in_once' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='generation_intent_frozen_partial' AND indexdef LIKE '%WHERE%';

SELECT conname FROM pg_constraint WHERE conname='balance_non_negative';

SELECT conname FROM pg_constraint WHERE conname='ledger_amount_derived';

SELECT indexdef FROM pg_indexes WHERE indexname='ledger_reserve_open_partial' AND indexdef LIKE '%WHERE%';

SELECT COUNT(*) AS n FROM "PricingRule" WHERE "modelId" IS NULL AND active HAVING COUNT(*) >= 4;

-- ============ Y0b-2 T1（squash 终态）：触发器/新索引/新列/退役对象断言 ============
-- 台账唯一写入口触发器（Z51/Z89：函数+两表行级触发器）
SELECT proname FROM pg_proc WHERE proname='ledger_guard';

SELECT tgname FROM pg_trigger WHERE tgname='team_credit_transaction_guard';

SELECT tgname FROM pg_trigger WHERE tgname='team_balance_guard';

-- 进 datamodel 的三件（Z107：普通唯一/复合——Prisma 可表达）
SELECT indexdef FROM pg_indexes WHERE indexname='GenerationIntent_idemKey_key' AND indexdef LIKE '%UNIQUE%';

SELECT indexdef FROM pg_indexes WHERE indexname='TeamCreditTransaction_idempotencyKey_key' AND indexdef LIKE '%UNIQUE%';

SELECT indexdef FROM pg_indexes WHERE indexname='GenerationIntent_projectId_nodeId_status_createdAt_idx';

-- 保持 partial 的四件（migration-SQL-only——谓词与 WHERE 严格匹配防计划器弃用）
SELECT indexdef FROM pg_indexes WHERE indexname='GenerationIntent_running_deadline_idx' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='GenerationIntent_running_heartbeat_idx' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='GenerationIntent_frozen_user_idx' AND indexdef LIKE '%WHERE%';

SELECT indexdef FROM pg_indexes WHERE indexname='TeamCreditTransaction_settle_user_month_idx' AND indexdef LIKE '%WHERE%';

-- GenerationIntent 新列形态（heartbeatAt/deadlineAt/idemKey NOT NULL；startedAt/gestureKey/providerTaskId 可空）
SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name='GenerationIntent' AND column_name IN ('heartbeatAt','deadlineAt','idemKey') AND is_nullable='NO' HAVING COUNT(*)=3;

SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name='GenerationIntent' AND column_name IN ('startedAt','gestureKey','providerTaskId') AND is_nullable='YES' HAVING COUNT(*)=3;

-- TeamCreditTransaction.idempotencyKey 可空（Z100：NULL 不冲突=去 partial 语义等价）
SELECT column_name FROM information_schema.columns WHERE table_name='TeamCreditTransaction' AND column_name='idempotencyKey' AND is_nullable='YES';

-- 退役对象否定断言（squash "从未存在"形态）：TeamMember 月列/月 CHECK/status_updatedAt 索引
SELECT 'monthly-cols-gone' AS assert WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_name='TeamMember' AND column_name IN ('monthlyUsed','monthlyPeriod')
);

SELECT 'monthly-check-gone' AS assert WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname='member_monthly_non_negative'
);

SELECT 'status-updatedat-idx-gone' AS assert WHERE NOT EXISTS (
  SELECT 1 FROM pg_indexes WHERE indexname='GenerationIntent_status_updatedAt_idx'
);

-- AIModel 终态（裁定 5）：provider slug 域+三无外呼模型双钉 inactive
SELECT COUNT(*) AS n FROM "AIModel" WHERE provider NOT IN ('moonshot','tencent','stability','openai') HAVING COUNT(*)=0;

SELECT COUNT(*) AS n FROM "AIModel" WHERE id IN ('seed-model-sdxl','seed-model-dalle','seed-model-gpt4') AND NOT active AND NOT recommended HAVING COUNT(*)=3;

SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name='AIModel' AND column_name IN ('apiModelName','providerLabel') AND is_nullable='YES' HAVING COUNT(*)=2;

