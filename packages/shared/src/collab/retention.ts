// packages/shared/src/collab/retention.ts
// C1-0（plan Task C1-0——生产就绪收尾批）：retention 常量单源迁移（30d/7d/100k——自
// execution-request.ts/runtime-event.ts 原地抽出，原址改再导出保既有 import 面零变化）+tick 词表。
// 消费面：C1 retention worker（ExecutionInput 终态 30d 过期扫+RuntimeEvent 7d/100k 尾部清理——
// spec §6.1/§7 同源常量单点）；api 侧受理写 expiresAt=now+30d 同源（execution-request.service.ts）。

/** ExecutionInput 终态保留期（spec §6.1——终态 30d 过期清理；受理写 expiresAt=now+30d 同源：
 *  长任务受理后久未终态≠悬置垃圾，终态迁移时重写 expiresAt=now+30d〔C1-1 红① 口径〕）。 */
export const EXEC_INPUT_RETENTION_AFTER_FINAL_DAYS = 30 as const;

/** RuntimeEvent 保留期（spec §7——7 天/项目 或 100k 条/项目**先到为准**；清理 worker 推进
 *  minRetainedSeq+`runtime_feed_bytes`；游标<minRetainedSeq 或保留期已过→客户端全量快照）。 */
export const RUNTIME_EVENT_RETENTION_DAYS = 7 as const;
export const RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT = 100_000 as const;

/** C3-1 worker append 审计 tick 的 job 键（消费面=apps/api collab-append-audit.worker——CollabJobCursor
 *  行主键；命名常量先于词表存在，词表自本常量派生〔值域随批增列登记〕）。 */
export const DOC_APPEND_GAP_AUDIT_JOB = 'doc-append-gap-audit' as const;

/** tick 词表（CollabJobCursor.job 值域单源——迁移笔一〔C1-0〕建表，值域随批增列登记）：
 *  - 'doc-append-gap-audit'：C3 worker append 审计 tick（每 5min——lastKey 按 projectId 轮转
 *    ［尾部项目饿死根除］+lastGap 存 (project,generation) 边沿状态［新 gap 边沿才 inc］）。
 *  注：C1 retention sweep tick 不在本表——单飞走 `pg_try_advisory_xact_lock(hashtext(
 *  'flowweb:retention'))`（红④），无游标消费。 */
export const COLLAB_JOB_CURSOR_JOBS = [DOC_APPEND_GAP_AUDIT_JOB] as const;
export type CollabJobCursorJob = (typeof COLLAB_JOB_CURSOR_JOBS)[number];