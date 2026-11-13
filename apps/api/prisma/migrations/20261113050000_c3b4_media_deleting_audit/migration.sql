-- AlterTable
-- C3b-4（spec 2026-11-11-foundation-batch-design.md §3.4-5 :81）：Media DELETING 状态机审计三列。
-- CAS 抢占（ACTIVE→DELETING——media-gc/project-erasure 删除流 UPDATE..RETURNING）时落值；
-- DELETING→ACTIVE 回退（recheck 命中中止/用户恢复）保留值=最近一次删除尝试的审计痕迹
-- （runbook §13.2：ACTIVE∧审计列非空=上次尝试中止/失败）。列 nullable：未尝试过删除的行恒 NULL。
ALTER TABLE "Media" ADD COLUMN     "deletionRequestedAt" TIMESTAMPTZ(3);
ALTER TABLE "Media" ADD COLUMN     "deletionRunId" TEXT;
ALTER TABLE "Media" ADD COLUMN     "deletionReason" TEXT;
