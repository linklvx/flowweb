import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { CreditLedgerService } from '../../team/credit-ledger.service';
import { clearPersonalTeamSubscription } from '../task/personal-team-ledger';
import { serializeSubscriptionPlan } from '../subscription.service';

@Injectable()
export class AdminSubscriptionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
  ) {}

  async listSubscriptions(filter: { userId?: string; planId?: string; status?: string; page?: number; pageSize?: number }) {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where: Record<string, unknown> = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.planId) where.planId = filter.planId;
    if (filter.status) where.status = filter.status;

    const [items, total] = await Promise.all([
      this.prisma.userSubscription.findMany({
        where,
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.userSubscription.count({ where }),
    ]);
    return { items: items.map(i => ({ ...i, plan: serializeSubscriptionPlan(i.plan) })), total, page, pageSize };
  }

  async cancelSubscription(id: string) {
    const sub = await this.prisma.userSubscription.findUnique({ where: { id } });
    if (!sub) throw new BusinessException('SUBSCRIPTION_NOT_FOUND');

    const TERMINAL = new Set(['expired', 'upgraded']);
    if (TERMINAL.has(sub.status)) throw new BusinessException('STATE_MACHINE_TERMINAL', '终态订阅不可作废');
    if (sub.status !== 'active') throw new BusinessException('SUBSCRIPTION_STATUS_INVALID');

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`; // Z13：台账锁等待以 55P03 可重试暴露（T4 质量审 I-1）
      await tx.userSubscription.update({
        where: { id },
        data: { status: 'expired' },
      });
      // 清默认团队实时剩余订阅积分（admin_clear 流水，amount=-剩余；无剩余不写空流水）
      await clearPersonalTeamSubscription(this.ledger, tx, sub.userId, 'admin_clear', id);
    });
  }

  async grantCredit(userId: string, amount: number, creditType: 'regular' | 'subscription') {
    const team = await this.prisma.team.findFirst({ where: { ownerId: userId, isDefault: true } });
    if (!team) throw new BusinessException('PERSONAL_TEAM_MISSING', '用户默认团队缺失');

    const txType = amount >= 0 ? 'admin_grant' : 'admin_clear';

    if (creditType === 'subscription') {
      const sub = await this.prisma.userSubscription.findFirst({
        where: { userId, status: 'active' },
      });
      if (!sub) throw new BusinessException('GRANT_NO_ACTIVE_SUB', '无生效订阅，不可发放订阅积分');
    }

    // Y0b-1（撕裂根修）：唯一无事务点补单事务——ensureBalance（upsert 自愈收口）+lockBalance+mutate。
    // admin_* 不进 money_in 幂等键（合法重复操作面）；referenceId=userId（操作对象锚）。
    await this.prisma.$transaction(async (raw) => {
      const tx = this.ledger.tx(raw);
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      await this.ledger.ensureBalance(tx, team.id);
      await this.ledger.lockBalance(tx, team.id);
      await this.ledger.mutate(tx, {
        teamId: team.id, operatorUserId: userId, type: txType, creditType,
        balanceDelta: amount, frozenDelta: 0, referenceId: userId,
      });
    });
  }
}
