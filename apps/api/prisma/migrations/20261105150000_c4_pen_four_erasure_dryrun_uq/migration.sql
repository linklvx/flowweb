-- C4-a（plan Task C4-1——生产就绪收尾批·project-erasure）迁移笔四：dryRun run 不占真实唯一。
-- 笔一落盘的 project_erasure_active_uq 谓词未排除 dryRun 行（schema ProjectErasureRun 头注设计
-- 意图=「dryRun=标志列（不占真实唯一+跳过 lifecycle 置位）」——dry-run 后真实擦为其明列场景），
-- PENDING dryRun run（C4-a worker 骨架不消费 dryRun——执行归 C4-c）会永久阻塞同 scope 真实 run
-- 置入。重建谓词加 "dryRun" = false 对齐设计意图；存量无 dryRun 行（列 C1 落盘后零写入）=零数据迁移。
DROP INDEX IF EXISTS "project_erasure_active_uq";
CREATE UNIQUE INDEX "project_erasure_active_uq" ON "ProjectErasureRun"("scopeType","scopeId")
WHERE state IN ('PENDING','RUNNING','DRAINING','WAITING_CHILDREN','PURGING_DB','PURGING_OBJECTS','PURGING_CACHE','VERIFYING')
  AND "dryRun" = false;
