// apps/api/src/modules/execution/execution-request.retention.service.ts
// C1-1（plan Task C1-1——生产就绪收尾批，spec v5 §6.1/R14）：ExecutionRequest/ExecutionInput
// retention 扫面共享服务——自 api ExecutionRequestService.sweepExpired 抽出（spec §1.3 实证无生产
// 调用方——原 api 侧方法死代码根修删除；worker 按模块边界注入共享 service 而非 api service）。
// 三面全为 **poller tick 事务内消费面**（tx 一律由 RetentionSweeperPoller 传入——本服务零自开事务）：
//  ①request 扫面（红⑤）：过期未执行（ADMITTED∧expiresAt<now）claim ≤50（FOR UPDATE SKIP LOCKED）
//    +同事务 voidForExecutionRequestInTx（CAS 让位幂等）——小批多 tick 排空由 poller 间隔驱动；
//  ②input 扫面（红①）：ExecutionInput 过期∧父行终态（COMPLETED/FAILED/VOIDED）判别双档——
//    非过期/非终态零触碰；批内 DELETE 循环至空（loop-to-empty）+**每 tick 批数上界**（P0#1：cap 出口
//    提交部分进度——防 60s tick 事务预算超限全回滚活锁）；
//  ③stuck 扫面（红②）：ADMITTED∧expiresAt<now / EXECUTING∧GenerationIntent MIN(deadlineAt)<now /
//    EXECUTING∧无 RUNNING intent（P1#2 孤儿档——intent 全终态后收口链中断的观测盲区补全）
//    ——stuck 口径=**request 侧** expiresAt（15min）/deadlineAt（非 input 侧 30d——input 只按终态
//    过滤）；计数+告警**不删**（poller 消费面）。
// scope ACTIVE 过滤（R15/C1 两删面）：join CanvasProject.lifecycleState='ACTIVE'+Team.status='ACTIVE'
// ——DELETING/DISBANDING 零触碰（擦除中项目行集与 retention 不相交；stuck 只读面同判防擦除期噪声）。
// 时间比较纪律（C1 rebaseline 终态）：DateTime 列=timestamptz(3)——raw SQL 裸 now() 与列同族直接比较
// =瞬时语义，会话时区无关（naive 列时代的补偿式时区转换已随 C1 拆除；彼时裸 now() 会按会话时区
// Asia/Shanghai +08 使窗口平移 8h）。typed Prisma 查询两端同源。
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamCreditService } from '../team/team-credit.service';

/** request 扫面单 tick claim 上界（红⑤小批——积压由 poller 间隔驱动多 tick 排空；1000 行≈20 tick）。 */
export const RETENTION_REQUEST_CLAIM_BATCH = 50;
/** input 扫面单批删除行数（loop-to-empty 批内 DELETE——同 tick 内循环至空）。 */
export const RETENTION_INPUT_DELETE_BATCH = 500;
/** input 扫面每 tick 批数上界（P0#1 活锁根修）：loop-to-empty 无批数上界 ⇔ 单 tick 待删量超 60s
 *  tick 事务预算（TICK_TX_TIMEOUT_MS）⇒ 超时全回滚+下 tick 从零重做=sweeper 永久排不空且零观测；
 *  达上界即 cap 出口（capped=true——poller 按需 count 回填 backlog gauge），每 tick 提交部分进度、
 *  跨 tick 单调排空（200×500=10 万行/tick 上界，超限下 tick 续——测试经 maxBatches 参数注入小 cap）。 */
export const RETENTION_INPUT_MAX_BATCHES_PER_TICK = 200;

@Injectable()
export class ExecutionRequestRetentionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
  ) {}

  /**
   * request 扫面（红⑤）：claim 过期未执行行 ≤50（FOR UPDATE SKIP LOCKED——并发让位）+**同事务**逐行
   * voidForExecutionRequestInTx（CAS ADMITTED→VOIDED+input 保留窗重写+逐 item release）。幂等：CAS
   * 0 命中行让位零资金动作（claim/void 幂等键语义——kill -9 续跑红⑥ 的结构保证）。
   * 返回 {claimed, voided}——claimed=claim 批行数（满批 ⇒ 积压可能未尽，backlog count 由 poller 按需回填）。
   */
  async sweepExpiredInTx(tx: Prisma.TransactionClient): Promise<{ claimed: number; voided: number }> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT r."id" FROM "ExecutionRequest" r
      JOIN "CanvasProject" p ON p."id" = r."projectId" AND p."lifecycleState" = 'ACTIVE'
      JOIN "Team" t ON t."id" = r."teamId" AND t."status" = 'ACTIVE'
      WHERE r."state" = 'ADMITTED' AND r."expiresAt" < now()
      ORDER BY r."expiresAt" ASC
      LIMIT ${RETENTION_REQUEST_CLAIM_BATCH}
      FOR UPDATE OF r SKIP LOCKED`;
    let voided = 0;
    for (const row of rows) {
      const ok = await this.teamCredit.voidForExecutionRequestInTx(tx, row.id, 'expired-unclaimed');
      if (ok) voided += 1;
    }
    return { claimed: rows.length, voided };
  }

  /**
   * input 扫面（红①判别双档）：过期∧父行终态行批删循环至空；**未过期零触碰+非终态零触碰**
   * （expiresAt<now ∧ state∈终态——双谓词缺一不删；受理/终态保留窗见 :449 受理写+终态重写口径）。
   * scope ACTIVE 过滤（DELETING/DISBANDING 行集零触碰）。返回 {deleted, capped}——capped=true=
   * 每 tick 批数上界出口（P0#1：残余行下 tick 续，backlog count 由 poller 回填观测）。
   */
  async sweepExpiredInputsInTx(
    tx: Prisma.TransactionClient,
    maxBatches: number = RETENTION_INPUT_MAX_BATCHES_PER_TICK,
    scopeProjectIds?: readonly string[],
  ): Promise<{ deleted: number; capped: boolean }> {
    // scopeProjectIds=测试隔离缝（int 并行文件共享 dev 库——cap 断言域内化；生产不传=全域；maxBatches 同族）
    const scope = scopeProjectIds
      ? Prisma.sql` AND r."projectId" = ANY(${scopeProjectIds}::text[])`
      : Prisma.empty;
    let deleted = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await tx.$queryRaw<{ requestId: string }[]>`
        DELETE FROM "ExecutionInput"
        WHERE "requestId" IN (
          SELECT i."requestId" FROM "ExecutionInput" i
          JOIN "ExecutionRequest" r ON r."id" = i."requestId"
          JOIN "CanvasProject" p ON p."id" = r."projectId" AND p."lifecycleState" = 'ACTIVE'
          JOIN "Team" t ON t."id" = r."teamId" AND t."status" = 'ACTIVE'
          WHERE i."expiresAt" < now() AND r."state" IN ('COMPLETED', 'FAILED', 'VOIDED')${scope}
          ORDER BY i."expiresAt" ASC
          LIMIT ${RETENTION_INPUT_DELETE_BATCH}
        )
        RETURNING "requestId"`;
      deleted += rows.length;
      if (rows.length < RETENTION_INPUT_DELETE_BATCH) return { deleted, capped: false };   // 批不满=排空（loop-to-empty 出口）
    }
    return { deleted, capped: true };   // 批数上界出口（cap——残余行下 tick 续，跨 tick 单调排空）
  }

  /**
   * stuck 扫面（红②——只读计数+告警不删）：按状态分三档（stuck 口径=request 侧 expiresAt 15min/
   * deadlineAt——非 input 侧 30d）：
   *  - admitted：ADMITTED∧expiresAt<now（受理窗 15min 已过仍未 claim——本 tick request 扫面将 void，
   *    计数为在飞积压到达信号；持续增量=void 收口链滞留）；
   *  - executing：EXECUTING∧其 RUNNING GenerationIntent MIN(deadlineAt)<now（外呼硬截止已过仍
   *    EXECUTING——retention 不触碰，人工/收口链处置）。
   *  - orphan（P1#2 观测盲区补全）：EXECUTING∧**无任何 RUNNING intent**（intent 全终态后 api 死在
   *    finalization 前的孤儿——原 INNER JOIN RUNNING 谓词零计数档；与 executing 档谓词互斥不双计）。
   *    scope ACTIVE 同判（擦除期行不告警）。
   */
  async countStuckInTx(tx: Prisma.TransactionClient): Promise<{ admitted: number; executing: number; orphan: number }> {
    const admittedRows = await tx.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "ExecutionRequest" r
      JOIN "CanvasProject" p ON p."id" = r."projectId" AND p."lifecycleState" = 'ACTIVE'
      JOIN "Team" t ON t."id" = r."teamId" AND t."status" = 'ACTIVE'
      WHERE r."state" = 'ADMITTED' AND r."expiresAt" < now()`;
    const executingRows = await tx.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT r."id")::int AS n FROM "ExecutionRequest" r
      JOIN "GenerationIntent" g ON g."executionRequestId" = r."id" AND g."status" = 'RUNNING'
      JOIN "CanvasProject" p ON p."id" = r."projectId" AND p."lifecycleState" = 'ACTIVE'
      JOIN "Team" t ON t."id" = r."teamId" AND t."status" = 'ACTIVE'
      WHERE r."state" = 'EXECUTING' AND g."deadlineAt" < now()`;
    const orphanRows = await tx.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "ExecutionRequest" r
      JOIN "CanvasProject" p ON p."id" = r."projectId" AND p."lifecycleState" = 'ACTIVE'
      JOIN "Team" t ON t."id" = r."teamId" AND t."status" = 'ACTIVE'
      WHERE r."state" = 'EXECUTING' AND NOT EXISTS (
        SELECT 1 FROM "GenerationIntent" g
        WHERE g."executionRequestId" = r."id" AND g."status" = 'RUNNING'
      )`;
    return {
      admitted: Number(admittedRows[0]?.n ?? 0),
      executing: Number(executingRows[0]?.n ?? 0),
      orphan: Number(orphanRows[0]?.n ?? 0),
    };
  }

  /** request 面积压按需 count（红⑤ backlog 观测——claim 满批时 poller 调用；scope ACTIVE 同判）。 */
  async countExpiredAdmittedBacklog(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "ExecutionRequest" r
      JOIN "CanvasProject" p ON p."id" = r."projectId" AND p."lifecycleState" = 'ACTIVE'
      JOIN "Team" t ON t."id" = r."teamId" AND t."status" = 'ACTIVE'
      WHERE r."state" = 'ADMITTED' AND r."expiresAt" < now()`;
    return Number(rows[0]?.n ?? 0);
  }

  /** input 面积压按需 count（P0#1 cap 出口残余行——poller 回填 backlog gauge；
   *  谓词/scope 同 sweepExpiredInputsInTx：过期∧父行终态∧scope ACTIVE）。 */
  async countExpiredTerminalInputBacklog(scopeProjectIds?: readonly string[]): Promise<number> {
    const scope = scopeProjectIds
      ? Prisma.sql` AND r."projectId" = ANY(${scopeProjectIds}::text[])`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "ExecutionInput" i
      JOIN "ExecutionRequest" r ON r."id" = i."requestId"
      JOIN "CanvasProject" p ON p."id" = r."projectId" AND p."lifecycleState" = 'ACTIVE'
      JOIN "Team" t ON t."id" = r."teamId" AND t."status" = 'ACTIVE'
      WHERE i."expiresAt" < now() AND r."state" IN ('COMPLETED', 'FAILED', 'VOIDED')${scope}`;
    return Number(rows[0]?.n ?? 0);
  }
}