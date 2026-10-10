import { Injectable, Inject, HttpStatus } from '@nestjs/common';
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

    await this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
      await tx.userSubscription.update({
        where: { id },
        data: { status: 'expired' },
      });
      // 清默认团队实时剩余订阅积分（admin_clear 流水，amount=-剩余；无剩余不写空流水）
      await clearPersonalTeamSubscription(this.ledger, tx, sub.userId, 'admin_clear', id);
    });
  }

  /** Y0b-2 T8（Z87/Z113）admin Idempotency-Key：opts.idempotencyKey 携带时走幂等协议——
   *  pg_advisory_xact_lock（事务首句业务锁——收并发同键窗：前置查对并发无效，双方 miss⇒后者撞
   *  idempotencyKey @unique⇒事务 abort 500；admin 幂等路径唯一取锁者无 ABBA）→ lockBalance →
   *  findFirst 前置查 → 命中⇒指纹比对（type/amount/creditType/operatorUserId——不一致 409
   *  IDEMPOTENCY_KEY_REUSED：换操作员同 key≠重放）⇒回放 replayed:true+transactionId 原值+
   *  credits/subscriptionCredits=同事务读当前两池（不回历史 balanceAfter=台账行发生时值⇒UI 陈旧）。
   *  miss⇒原样 mutate（reversesId @unique/money_in_once 抛错 backstop 全保留——禁 skipDuplicates；
   *  不带 key=合法重复操作面维持，Z9 同族）。 */
  async grantCredit(
    userId: string, amount: number, creditType: 'regular' | 'subscription',
    opts?: { idempotencyKey?: string; operatorUserId?: string | null },
  ): Promise<{ replayed: boolean; transactionId: string; credits: number; subscriptionCredits: number }> {
    const team = await this.prisma.team.findFirst({ where: { ownerId: userId, isDefault: true } });
    if (!team) throw new BusinessException('PERSONAL_TEAM_MISSING', '用户默认团队缺失');

    const txType = amount >= 0 ? 'admin_grant' : 'admin_clear';
    const operatorUserId = opts?.operatorUserId ?? userId;

    if (creditType === 'subscription') {
      const sub = await this.prisma.userSubscription.findFirst({
        where: { userId, status: 'active' },
      });
      if (!sub) throw new BusinessException('GRANT_NO_ACTIVE_SUB', '无生效订阅，不可发放订阅积分');
    }

    // Y0b-1（撕裂根修）：唯一无事务点补单事务——ensureBalance（upsert 自愈收口）+lockBalance+mutate。
    // referenceId=userId（操作对象锚）；带 key 时行落 idempotencyKey 列（Z100 同列——admin 链自管指纹/回放）。
    return this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
      if (opts?.idempotencyKey) {
        // Z113：advisory 事务锁先于一切业务语句（SET LOCAL 之后）——事务提交即释放，锁粒度=hash(key)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'admin:' + opts.idempotencyKey}))`;
      }
      await this.ledger.ensureBalance(tx, team.id);
      await this.ledger.lockBalance(tx, team.id);
      const bothPools = async () => {
        const bal = await tx.teamBalance.findUniqueOrThrow({ where: { teamId: team.id } });
        return { credits: bal.credits, subscriptionCredits: bal.subscriptionCredits };
      };
      if (opts?.idempotencyKey) {
        const prev = await tx.teamCreditTransaction.findFirst({
          where: { idempotencyKey: opts.idempotencyKey, teamId: team.id },
          select: { id: true, type: true, creditType: true, balanceDelta: true, operatorUserId: true },
        });
        if (prev) {
          if (prev.type !== txType || prev.creditType !== creditType
            || prev.balanceDelta !== amount || prev.operatorUserId !== operatorUserId) {
            throw new BusinessException('IDEMPOTENCY_KEY_REUSED', '同 Idempotency-Key 已用于不同操作（type/amount/creditType/operatorUserId 指纹不一致）', HttpStatus.CONFLICT);
          }
          return { replayed: true, transactionId: prev.id, ...await bothPools() };
        }
      }
      const r = await this.ledger.mutate(tx, {
        teamId: team.id, operatorUserId, type: txType, creditType,
        balanceDelta: amount, frozenDelta: 0, referenceId: userId,
        idempotencyKey: opts?.idempotencyKey ?? null,
      });
      return { replayed: false, transactionId: r.rowId!, ...await bothPools() };
    });
  }
}
