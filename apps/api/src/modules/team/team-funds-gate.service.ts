// apps/api/src/modules/team/team-funds-gate.service.ts —— Y0b-1（§1.4ter/Z4）：解散/删项目前置清算门
// C4-a（plan Task C4-1 资金门扩查——生产就绪收尾批·project-erasure）：原两维（RUNNING∨reservedCredits>0）
// 扩查三面（tombstone-only 后请求事务内持锁检查——FenceTx 同连接同快照）：
//  ①ExecutionRequest：state IN (ADMITTED,EXECUTING) ∧ reservedCredit>0（在飞执行请求冻结额）；
//  ②RefundObligation：state=PENDING（经 GenerationIntent 归属 scope——无 FK 纯列 join）；
//  ③StorageReservation：state=ACTIVE（team 维直查；project 维经 Media.projectId 归属）。
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeamFundsGateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 存在 RUNNING/reservedCredits>0 的 GenerationIntent，或在飞 ExecutionRequest 冻结额/PENDING
   *  退款义务/ACTIVE 存储预留 任一 ⇒ 409（等待在飞完成或 admin force-void 后重试）。维度：
   *  teamId=解散前置；projectId=删项目/模板级联前置；projectIds=cleanDrafts 批量前置。
   *  tx 参数（三轮 P0-4）：tombstone 请求事务内调用时与 FOR SHARE 行锁同连接同快照（"持锁检查"
   *  为真）；非事务调用点传 this.prisma（读后写窗口登记为残余，兜底=reconcile+孤儿巡检）。 */
  async assertSettled(tx: Prisma.TransactionClient | PrismaService, scope: { teamId?: string; projectId?: string; projectIds?: string[] }): Promise<void> {
    const base = scope.teamId
      ? { teamId: scope.teamId }
      : scope.projectIds
        ? { projectId: { in: scope.projectIds } }
        : { projectId: scope.projectId! };
    // C4-a 扩查三面归属谓词（GenerationIntent 无 FK 纯列——gi 前缀限 join 面）：
    const intentWhere = scope.teamId
      ? Prisma.sql`gi."teamId" = ${scope.teamId}`
      : scope.projectIds
        ? Prisma.sql`gi."projectId" IN (${Prisma.join(scope.projectIds)})`
        : Prisma.sql`gi."projectId" = ${scope.projectId!}`;
    // ExecutionRequest 直列（projectId/teamId 双列在表）；StorageReservation：team 维直查、project 维经 Media 归属
    const execWhere = scope.teamId
      ? Prisma.sql`"teamId" = ${scope.teamId}`
      : scope.projectIds
        ? Prisma.sql`"projectId" IN (${Prisma.join(scope.projectIds)})`
        : Prisma.sql`"projectId" = ${scope.projectId!}`;
    const storageWhere = scope.teamId
      ? Prisma.sql`sr."teamId" = ${scope.teamId}`
      : scope.projectIds
        ? Prisma.sql`m."projectId" IN (${Prisma.join(scope.projectIds)})`
        : Prisma.sql`m."projectId" = ${scope.projectId!}`;
    const [running, frozen, execReq, refundPending, storageActive] = await Promise.all([
      tx.generationIntent.count({ where: { ...base, status: 'RUNNING' } }) as Promise<number>,
      tx.generationIntent.count({ where: { ...base, reservedCredits: { gt: 0 } } }) as Promise<number>,
      tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM "ExecutionRequest"
        WHERE ${execWhere} AND state IN ('ADMITTED','EXECUTING') AND "reservedCredit" > 0`),
      tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM "RefundObligation" ro
        JOIN "GenerationIntent" gi ON gi.id = ro."intentRowId"
        WHERE ro.state = 'PENDING' AND ${intentWhere}`),
      tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM "StorageReservation" sr
        LEFT JOIN "Media" m ON m.id = sr."mediaId"
        WHERE sr.state = 'ACTIVE' AND ${storageWhere}`),
    ]);
    if (running > 0 || frozen > 0
      || execReq[0]?.n > 0 || refundPending[0]?.n > 0 || storageActive[0]?.n > 0) {
      throw new BusinessException('TEAM_HAS_ACTIVE_FUNDS', '该范围存在进行中或冻结中的生成任务/在飞执行请求/待退款项/存储预留（资金未清算）——请等待任务完成或经 admin force-void 后重试', HttpStatus.CONFLICT);
    }
  }
}
