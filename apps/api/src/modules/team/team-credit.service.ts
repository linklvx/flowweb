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

  /** 批0.5-9 reserve→settle 两阶段扣费——消灭两个沉没成本面：①余额不足在外呼之后才发现（白付外呼，
   *  第三方照计费）→ reserve 前置外呼，不足即拒=零外呼；②组执行前 N 已扣、第 N+1 不足整批 return
   *  （部分成功沉没）→ 每节点独立 reserve/settle，前 N 产物保留。
   *  记账法（最小 schema 侵入——TeamBalance 无 frozen 列，纯记账）：reserve=扣余额+type=reserve 流水
   *  （amount 负）；settle=补 settle 正账流水+意图行迁移；void=反向加回+反向 reserve 流水。
   *  reservedCredits 列只作意图行状态标记（约束①：CAS 锚——不用 PENDING 状态）。
   *  扣减核心与 consume 同构（两套并存，五扣费点切换后 consume 退役登记）。 */
  async reserve(
    teamId: string,
    userId: string,
    amount: number,
    guard: { intentRowId: string; intentId: string },
  ): Promise<{ success: boolean; reason?: string; alreadyReserved?: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const balance = await tx.teamBalance.findUnique({ where: { teamId } });
        if (!balance) return { success: false, reason: 'TEAM_BALANCE_MISSING' };
        if (balance.credits + balance.subscriptionCredits < amount) {
          return { success: false, reason: 'CREDIT_INSUFFICIENT' }; // 外呼之前即拒——零外呼零沉没
        }

        const member = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId, userId } },
        });
        if (!member) return { success: false, reason: 'NOT_MEMBER' };

        const period = currentPeriod();
        const inPeriod = member.monthlyPeriod === period;
        const used = inPeriod ? member.monthlyUsed : 0;
        if (member.monthlyQuota > 0 && used + amount > member.monthlyQuota) {
          return { success: false, reason: 'QUOTA_EXCEEDED' };
        }

        // 约束①：CAS 置位 reservedCredits 0→amount（creditsConsumed:0 并守——已 settle 行不得重冻结）。
        //  不置位则 stalled 同 job 重入二次过门=双冻结；count===0 = 已冻结/已结算（重入幂等续跑）或门丢失。
        const gate = await tx.generationIntent.updateMany({
          where: { id: guard.intentRowId, reservedCredits: 0, creditsConsumed: 0 },
          data: { reservedCredits: amount },
        });
        if (gate.count === 0) {
          const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
          if (row && (row.reservedCredits > 0 || row.creditsConsumed > 0)) {
            return { success: true, alreadyReserved: true }; // 冻结只发生一次（约束①锚）
          }
          return { success: false, reason: 'RESERVE_GATE_LOST' }; // 归零态（void 后）不得白嫖外呼
        }

        let retries = 0;
        while (retries < MAX_RETRIES) {
          const current = await tx.teamBalance.findUnique({ where: { teamId } });
          if (!current) throw new ConsumeAbort('TEAM_BALANCE_MISSING');
          if (current.credits + current.subscriptionCredits < amount) {
            throw new ConsumeAbort('CREDIT_INSUFFICIENT');
          }

          const subDeduct = Math.min(current.subscriptionCredits, amount);
          const regDeduct = amount - subDeduct;

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

          const usedWhere: Record<string, unknown> = { id: member.id };
          if (inPeriod) {
            usedWhere.monthlyPeriod = period;
            if (member.monthlyQuota > 0) usedWhere.monthlyUsed = { lte: member.monthlyQuota - amount };
          } else {
            usedWhere.OR = [{ monthlyPeriod: { not: period } }, { monthlyPeriod: null }];
          }
          const usedResult = await tx.teamMember.updateMany({
            where: usedWhere,
            data: { monthlyUsed: { increment: amount }, monthlyPeriod: period },
          });
          if (usedResult.count === 0) throw new ConsumeAbort('QUOTA_EXCEEDED');

          const updated = await tx.teamBalance.findUnique({ where: { teamId } });
          const ref = `intent:${guard.intentId}`;
          const rows: Prisma.TeamCreditTransactionCreateManyInput[] = [];
          if (subDeduct > 0) {
            rows.push({
              teamId, operatorUserId: userId, amount: -subDeduct, type: 'reserve',
              creditType: 'subscription', referenceId: ref, balanceAfter: updated!.subscriptionCredits,
            });
          }
          if (regDeduct > 0) {
            rows.push({
              teamId, operatorUserId: userId, amount: -regDeduct, type: 'reserve',
              creditType: 'regular', referenceId: ref, balanceAfter: updated!.credits,
            });
          }
          if (rows.length > 0) await tx.teamCreditTransaction.createMany({ data: rows });
          return { success: true };
        }
        throw new ConsumeAbort('RETRY_EXHAUSTED');
      }, { timeout: 10_000, maxWait: 5_000 });
    } catch (e) {
      if (e instanceof ConsumeAbort) return { success: false, reason: e.reason };
      throw e;
    }
  }

  /** settle：外呼成功后核销——冻结转实扣（reservedCredits 清零+creditsConsumed 置位+settle 正账流水）。
   *  幂等：reservedCredits===0 且 creditsConsumed>0 ⇒ 已 settle（stalled 重入/重跑只结一次，零流水）；
   *  流水镜像 reserve 行两池拆分（禁拿单值猜池——F13 同款纪律）。 */
  async settle(guard: { intentRowId: string; intentId: string }): Promise<{ success: boolean; settled: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
      if (!row) return { success: false, settled: false };
      if (row.reservedCredits === 0 && row.creditsConsumed > 0) return { success: true, settled: false };
      if (row.reservedCredits === 0) return { success: false, settled: false }; // 无冻结（正常链路 reserve 先行——防御）

      const cas = await tx.generationIntent.updateMany({
        where: { id: guard.intentRowId, reservedCredits: row.reservedCredits },
        data: { reservedCredits: 0, creditsConsumed: row.reservedCredits },
      });
      if (cas.count === 0) return { success: true, settled: false }; // 并发 settle 已抢——只结一次

      const reserveRows = await tx.teamCreditTransaction.findMany({
        where: { referenceId: `intent:${guard.intentId}`, type: 'reserve', amount: { lt: 0 } },
      });
      for (const r of reserveRows) {
        const bal = await tx.teamBalance.findUnique({ where: { teamId: r.teamId! } });
        const isSub = r.creditType === 'subscription';
        await tx.teamCreditTransaction.create({
          data: {
            teamId: r.teamId!,
            operatorUserId: row.userId,
            amount: r.amount, // 与 reserve 行同额负——终态消费正账
            type: 'settle',
            creditType: r.creditType,
            referenceId: r.referenceId,
            balanceAfter: isSub ? bal!.subscriptionCredits : bal!.credits,
          },
        });
      }
      return { success: true, settled: true };
    }, { timeout: 10_000, maxWait: 5_000 });
  }

  /** void_：解冻（外呼失败/组执行第 N+1 放弃）——约束②：reserve-only 的退款=解冻非补记，
   *  反向 reserve 流水（amount 正），不得走 refund 正向记账（否则双倍回滚）。
   *  CAS reservedCredits>0→0 抢解冻权：已 settle/已解冻零动作（幂等）。 */
  async void_(guard: { intentRowId: string; intentId: string }): Promise<void> {
    const row = await this.prisma.generationIntent.findUnique({ where: { id: guard.intentRowId } });
    if (!row) return;
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.generationIntent.updateMany({
        where: { id: guard.intentRowId, reservedCredits: { gt: 0 } },
        data: { reservedCredits: 0 },
      });
      if (cas.count === 0) return; // 已解冻/已结算——幂等零动作

      const reserveRows = await tx.teamCreditTransaction.findMany({
        where: { referenceId: `intent:${guard.intentId}`, type: 'reserve', amount: { lt: 0 } },
      });
      let total = 0;
      for (const r of reserveRows) {
        const amt = Math.abs(r.amount);
        const isSub = r.creditType === 'subscription';
        total += amt;
        await tx.teamBalance.update({
          where: { teamId: r.teamId! },
          data: isSub ? { subscriptionCredits: { increment: amt } } : { credits: { increment: amt } },
        });
        const bal = await tx.teamBalance.findUnique({ where: { teamId: r.teamId! } });
        await tx.teamCreditTransaction.create({
          data: {
            teamId: r.teamId!,
            operatorUserId: row.userId,
            amount: amt, // 反向 reserve 流水（amount 正）——type 仍 reserve，与 refund 分义
            type: 'reserve',
            creditType: r.creditType,
            referenceId: r.referenceId,
            balanceAfter: isSub ? bal!.subscriptionCredits : bal!.credits,
          },
        });
      }
      if (reserveRows.length > 0) {
        await tx.teamMember.updateMany({
          where: { teamId: reserveRows[0].teamId!, userId: row.userId, monthlyPeriod: currentPeriod() }, // 仅当月回滚（月界翻转不污染新月）
          data: { monthlyUsed: { decrement: total } },
        });
      }
    }, { timeout: 10_000, maxWait: 5_000 });
  }
}
