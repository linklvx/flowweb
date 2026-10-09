// apps/api/src/modules/admin/intent/intent.service.ts —— Y0b-1（§1.4ter）force-void 运维出口
// TEAM_HAS_ACTIVE_FUNDS 409 不能只会等 cron/reconcile——admin 人工清算通道（AdminGuard 全局路径守卫承载）。
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TeamCreditService } from '../../team/team-credit.service';
import { GenerationIntentService } from '../../execution/generation-intent.service';
import { AuditService } from '../../../common/audit/audit.service';

@Injectable()
export class AdminIntentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
    @Inject(GenerationIntentService) private readonly intentService: GenerationIntentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 序：解冻（teamCredit.void_ CAS reservedCredits>0→0+release 冲销——幂等）→ 终态化 VOIDED
   *  （GenerationIntentService.void_ where ACTIVE——VOIDED 语义=退款已归零、rearm 重试照常扣费；
   *  FAILED 语义=押金还押着，与解冻后状态不符故不取）→ 复读终态+审计登记（前后值留痕）。 */
  async forceVoid(intentRowId: string, operatorId: string) {
    const row = await this.prisma.generationIntent.findUnique({ where: { id: intentRowId } });
    if (!row) throw new NotFoundException('意图不存在');
    await this.teamCredit.void_({ intentRowId });
    await this.intentService.void_(intentRowId, 'admin force-void');
    const after = await this.prisma.generationIntent.findUniqueOrThrow({
      where: { id: intentRowId },
      select: { id: true, teamId: true, status: true, reservedCredits: true, error: true },
    });
    await this.audit.log({
      operatorId,
      operatorName: (await this.prisma.user.findUnique({ where: { id: operatorId }, select: { name: true } }))?.name ?? 'admin',
      teamId: row.teamId,
      targetType: 'GENERATION_INTENT',
      targetId: intentRowId,
      action: 'force_void',
      beforeValue: { status: row.status, reservedCredits: row.reservedCredits },
      afterValue: { status: after.status, reservedCredits: after.reservedCredits },
    });
    return after;
  }
}
