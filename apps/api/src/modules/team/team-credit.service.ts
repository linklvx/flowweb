import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_RETRIES = 3;

/** F13：consume 事务内中止——throw 即整体回滚（余额/扣费门/流水同生共死）；catch 翻译回 reason。
 *  v5.8 写死：扣减后配额复验失败若 return=提交已扣余额——必须 throw。 */
class ConsumeAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class TeamCreditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 双池+总额+该成员 quota/used（惰性重置：monthlyPeriod 非当月先清零） */
  async getBalanceView(teamId: string, userId: string) {
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId } });
    let member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('非团队成员');

    const period = currentPeriod();
    if (member.monthlyPeriod !== period) {
      member = await this.prisma.teamMember.update({
        where: { id: member.id },
        data: { monthlyPeriod: period, monthlyUsed: 0 },
      });
    }

    const credits = balance?.credits ?? 0;
    const subscriptionCredits = balance?.subscriptionCredits ?? 0;
    return {
      credits,
      subscriptionCredits,
      total: credits + subscriptionCredits,
      quota: member.monthlyQuota,
      used: member.monthlyUsed,
    };
  }

  /** 校验顺序（D5）：总额 → quota → CAS 扣费门 → 扣减（订阅优先+乐观锁）→ monthlyUsed 原子累加 → 流水。
   *  F13 批0.5-4：整体搬进 $transaction——扣减与记账同生共死，配额复验失败 throw 回滚（余额不再裸扣）。
   *  intentGuard（CAS 扣费门，净删五套机制后的扣费幂等接替物）：creditsConsumed 0→amount 原子占位，
   *  count===0 = 已扣过（崩溃/重跑/重试全组合只扣一次）——不扣余额零流水，续产物；
   *  门在扣余额之前且同事务——回滚时 creditsConsumed 随之撤销（门与钱同生共死）。
   *  流水键：带门时 referenceId = `intent:${intentId}`（intent: 维度，referenceId 前缀退役）。
   *  执行侧接线（传 intentGuard）随 0.5-6/0.5-8 的 claim 接入一并做——签名可选参数向后兼容。 */
  async consume(
    teamId: string,
    userId: string,
    cost: number,
    referenceId: string,
    intentGuard?: { intentRowId: string; intentId: string },
  ): Promise<{ success: boolean; reason?: string; alreadyCharged?: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const balance = await tx.teamBalance.findUnique({ where: { teamId } });
        if (!balance) return { success: false, reason: 'TEAM_BALANCE_MISSING' };
        if (balance.credits + balance.subscriptionCredits < cost) {
          return { success: false, reason: 'CREDIT_INSUFFICIENT' };
        }

        const member = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId } },
        });
        if (!member) return { success: false, reason: 'NOT_MEMBER' };

        const period = currentPeriod();
        const inPeriod = member.monthlyPeriod === period;
        const used = inPeriod ? member.monthlyUsed : 0;
        if (member.monthlyQuota > 0 && used + cost > member.monthlyQuota) {
          return { success: false, reason: 'QUOTA_EXCEEDED' };
        }

        if (intentGuard) {
          const gate = await tx.generationIntent.updateMany({
            where: { id: intentGuard.intentRowId, creditsConsumed: 0 },
            data: { creditsConsumed: cost },
          });
          if (gate.count === 0) return { success: true, alreadyCharged: true };
        }

        let retries = 0;
        while (retries < MAX_RETRIES) {
          const current = await tx.teamBalance.findUnique({ where: { teamId } });
          // 门后失败必须 throw（return=提交孤儿门：creditsConsumed 已置而钱未扣，重试 alreadyCharged 永不扣费）
          if (!current) throw new ConsumeAbort('TEAM_BALANCE_MISSING');
          if (current.credits + current.subscriptionCredits < cost) {
            throw new ConsumeAbort('CREDIT_INSUFFICIENT');
          }

          const subDeduct = Math.min(current.subscriptionCredits, cost);
          const regDeduct = cost - subDeduct;

          const updateData: Record<string, unknown> = { version: { increment: 1 } };
          if (subDeduct > 0) updateData.subscriptionCredits = { decrement: subDeduct };
          if (regDeduct > 0) updateData.credits = { decrement: regDeduct };

          const result = await tx.teamBalance.updateMany({
            where: { teamId, version: current.version },
            data: updateData,
          });
          if (result.count === 0) {
            retries++;
            continue;
          }

          // monthlyUsed 原子累加，禁止读-改-写；quota 并入 where 防同成员并发超限
          const usedWhere: Record<string, unknown> = { id: member.id };
          if (inPeriod) {
            usedWhere.monthlyPeriod = period;
            if (member.monthlyQuota > 0) usedWhere.monthlyUsed = { lte: member.monthlyQuota - cost };
          } else {
            usedWhere.OR = [{ monthlyPeriod: { not: period } }, { monthlyPeriod: null }];
          }
          const usedResult = await tx.teamMember.updateMany({
            where: usedWhere,
            data: { monthlyUsed: { increment: cost }, monthlyPeriod: period },
          });
          if (usedResult.count === 0) throw new ConsumeAbort('QUOTA_EXCEEDED');

          const updated = await tx.teamBalance.findUnique({ where: { teamId } });
          const ref = intentGuard ? `intent:${intentGuard.intentId}` : referenceId;
          const rows: Prisma.TeamCreditTransactionCreateManyInput[] = [];
          if (subDeduct > 0) {
            rows.push({
              teamId, operatorUserId: userId, amount: -subDeduct, type: 'consumption',
              creditType: 'subscription', referenceId: ref, balanceAfter: updated!.subscriptionCredits,
            });
          }
          if (regDeduct > 0) {
            rows.push({
              teamId, operatorUserId: userId, amount: -regDeduct, type: 'consumption',
              creditType: 'regular', referenceId: ref, balanceAfter: updated!.credits,
            });
          }
          if (rows.length > 0) await tx.teamCreditTransaction.createMany({ data: rows });
          return { success: true };
        }
        throw new ConsumeAbort('RETRY_EXHAUSTED');
      }, { timeout: 10_000, maxWait: 5_000 }); // 交互式事务默认 5s——乐观锁重试争用下会假失败
    } catch (e) {
      if (e instanceof ConsumeAbort) return { success: false, reason: e.reason };
      throw e;
    }
  }
}
