// apps/api/src/modules/team/team-funds-gate.service.ts —— Y0b-1（§1.4ter/Z4）：解散/删项目前置清算门
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeamFundsGateService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 存在 RUNNING 或 reservedCredits>0 ⇒ 409（等待在飞完成或 admin force-void 后重试）。两维度：
   *  teamId=解散前置；projectId=删项目/模板级联前置；projectIds=cleanDrafts 批量前置。
   *  tx 参数（三轮 P0-4）：disbandTeam/cleanDrafts 事务内调用时与 FOR UPDATE 同连接同快照（"持锁检查"为真）；
   *  非事务调用点传 this.prisma（project/template 侧——读后写窗口登记为残余，兜底=reconcile+孤儿巡检）。 */
  async assertSettled(tx: Prisma.TransactionClient | PrismaService, scope: { teamId?: string; projectId?: string; projectIds?: string[] }): Promise<void> {
    const base = scope.teamId
      ? { teamId: scope.teamId }
      : scope.projectIds
        ? { projectId: { in: scope.projectIds } }
        : { projectId: scope.projectId! };
    const [running, frozen] = await Promise.all([
      tx.generationIntent.count({ where: { ...base, status: 'RUNNING' } }),
      tx.generationIntent.count({ where: { ...base, reservedCredits: { gt: 0 } } }),
    ]);
    if (running > 0 || frozen > 0) {
      throw new BusinessException('TEAM_HAS_ACTIVE_FUNDS', '该范围存在进行中或冻结中的生成任务（资金未清算）——请等待任务完成或经 admin force-void 后重试', HttpStatus.CONFLICT);
    }
  }
}
