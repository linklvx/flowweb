-- C2-2b P1 修复（生产就绪收尾批——迁移笔三：plan v3.1 §C4「迁移笔数勘正」预留的第三笔即此用途）：
-- CanaryPin 加 semanticDigest 列（Char(64) nullable）——语义兜底判据载体。
-- 评审反例根修：Yjs delete 不进 state vector——纯删除帧丢失时 SV 互支成立而节点复活（语义不等），
-- SV 互支作等价判据漏报（归 hash-encoding-mismatch 只计数不 freeze）；改捕获④落语义摘要
-- （nodes+edges 两根 canonical JSON→SHA-256，collab-canary-semantic.ts 单源）+verify 兜底深比。
-- nullable 语义：捕获侧超限档（canonical>CANARY_HASH_MAX_BYTES=8MiB）预算同跳过摘要=null——
-- 该档 verify 降级 SV 同代辅助（登记盲区）；存量 pin（本笔前落库）null=同降级路径，TTL 15min
-- 自然清退。全 additive（单列新增零破坏）。
ALTER TABLE "CanaryPin" ADD COLUMN "semanticDigest" CHAR(64);
