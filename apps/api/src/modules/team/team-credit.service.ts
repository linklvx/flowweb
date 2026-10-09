import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';

/** F13：扣费事务内中止——throw 即整体回滚（余额/扣费门/流水同生共死）；catch 翻译回 reason。
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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
  ) {}

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

  /** reserve：外呼前冻结——余额不足即拒=零外呼零沉没（批0.5-9 语义保持）。
   *  Y0b-1（Z10）：金额单源 intent 行（plan 固化快照）——调用方无"定多少钱"的权力；TOCTOU 结构性消失。
   *  写路径全经 CreditLedgerService（Z12 品牌 tx+Z13 锁序①lockBalance 先于 gate CAS+§1.4bis 真值表）。
   *  mayCall:false（alreadyReserved）=该意图已被他人冻结/结算（典型 stall 重排）——调用方须静默退出（Z35）。 */
  async reserve(
    userId: string,
    guard: { intentRowId: string },
  ): Promise<{ success: boolean; reason?: string; alreadyReserved?: boolean; mayCall?: boolean }> {
    try {
      return await this.prisma.$transaction(async (raw) => {
        const tx = this.ledger.tx(raw);
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
        const intent = await tx.generationIntent.findUniqueOrThrow({ where: { id: guard.intentRowId } });
        const teamId = intent.teamId;
        const amount = intent.creditCost;   // 单源：plan 快照
        await this.ledger.lockBalance(tx, teamId);   // 锁序①（契约 20）
        const balance = await tx.teamBalance.findUnique({ where: { teamId } });
        if (!balance) return { success: false, reason: 'TEAM_BALANCE_MISSING' };
        const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
        if (!member) return { success: false, reason: 'NOT_MEMBER' };   // member 检查先于零额早退（reserve 是钱的入口守卫全集——防非成员免费外呼）
        if (amount === 0) return { success: true, mayCall: true };   // 唯一合法免费——零冻结零流水
        if (balance.credits + balance.subscriptionCredits < amount) return { success: false, reason: 'CREDIT_INSUFFICIENT' };
        const period = currentPeriod();
        const inPeriod = member.monthlyPeriod === period;
        const used = inPeriod ? member.monthlyUsed : 0;
        if (member.monthlyQuota > 0 && used + amount > member.monthlyQuota) return { success: false, reason: 'QUOTA_EXCEEDED' };
        // 锁序②：gate CAS 持锁期间完成（四守卫保留——约束① CAS 锚 reservedCredits 0→amount，creditsConsumed:0 并守）
        const gate = await tx.generationIntent.updateMany({
          where: { id: guard.intentRowId, reservedCredits: 0, creditsConsumed: 0 },
          data: { reservedCredits: amount },
        });
        if (gate.count === 0) {
          const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
          if (row && (row.reservedCredits > 0 || row.creditsConsumed > 0)) {
            return { success: true, alreadyReserved: true, mayCall: false };   // Z10/H7：幂等续跑但禁再外呼（同 intent 双 worker 只烧一次钱）
          }
          return { success: false, reason: 'RESERVE_GATE_LOST' };
        }
        // monthlyUsed CAS（守卫式 updateMany——FOR UPDATE 持有下无竞态）
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
        // 两池拆分——逐池经 mutate（balanceAfter=池分量 §1.4bis①；F1 锚 referenceId=intent:<intentRowId>）
        const subDeduct = Math.min(balance.subscriptionCredits, amount);
        const regDeduct = amount - subDeduct;
        if (subDeduct > 0) await this.ledger.mutate(tx, {
          teamId, operatorUserId: userId, type: 'reserve', creditType: 'subscription',
          balanceDelta: -subDeduct, frozenDelta: subDeduct, referenceId: `intent:${guard.intentRowId}`,
        });
        if (regDeduct > 0) await this.ledger.mutate(tx, {
          teamId, operatorUserId: userId, type: 'reserve', creditType: 'regular',
          balanceDelta: -regDeduct, frozenDelta: regDeduct, referenceId: `intent:${guard.intentRowId}`,
        });
        return { success: true, mayCall: true };
      }, { timeout: 15_000, maxWait: 5_000 });
    } catch (e) {
      if (e instanceof ConsumeAbort) return { success: false, reason: e.reason };
      throw e;
    }
  }

  /** settle：外呼成功后核销——冻结转实扣（reservedCredits 清零+creditsConsumed 置位+settle 记账行）。
   *  台账锚（F1）+anti-join（Z6）+锁序①（lockBalance 先于 intent CAS）+reversesId 配对。
   *  CAS 后崩溃修补（报2 P1-1）：reservedCredits 已归零但 settle 行未写——anti-join 补写（reversesId 唯一=幂等安全）。
   *  幂等：已结清（无未冲销 reserve 行）⇒ settled:false 零动作。 */
  async settle(guard: { intentRowId: string }): Promise<{ success: boolean; settled: boolean }> {
    return this.prisma.$transaction(async (raw) => {
      const tx = this.ledger.tx(raw);
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
      if (!row?.teamId) return { success: false, settled: false };
      if (row.reservedCredits === 0 && row.creditsConsumed > 0) {
        // CAS 后崩溃的中间态——reservedCredits 已归零但 settle 行未写（未冲销 reserve 行仍在）。
        // anti-join 查未冲销行：存在则补写；空才是正常的已结清早退。
        // 不修补 ⇒ 不变量②永久破+每日对账 "creditsConsumed vs Σ|settle|" 永久告警（告警疲劳）。
        // 锁序与正常路径统一：lockBalance 先于台账行锁（T4 质量审 I-2——mutate 内重锁同事务幂等无害）
        await this.ledger.lockBalance(tx, row.teamId);
        const patchRows = await tx.$queryRaw<any[]>`
          SELECT r.* FROM "TeamCreditTransaction" r
          WHERE r."teamId" = ${row.teamId} AND r."referenceId" = ${'intent:' + guard.intentRowId} AND r.type = 'reserve'
            AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
          FOR UPDATE OF r`;
        for (const r of patchRows) {
          await this.ledger.mutate(tx, {
            teamId: r.teamId, operatorUserId: row.userId, type: 'settle', creditType: r.creditType,
            balanceDelta: 0, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id,
          });
        }
        return { success: true, settled: patchRows.length > 0 };
      }
      if (row.reservedCredits === 0) return { success: false, settled: false }; // 无冻结（正常链路 reserve 先行——防御）
      await this.ledger.lockBalance(tx, row.teamId);   // 锁序①：先于 intent CAS（契约 20 全序）
      const cas = await tx.generationIntent.updateMany({
        where: { id: guard.intentRowId, reservedCredits: row.reservedCredits },
        data: { reservedCredits: 0, creditsConsumed: row.reservedCredits },
      });
      if (cas.count === 0) return { success: true, settled: false }; // 并发 settle 已抢——只结一次
      // anti-join：未被 settle/release 冲销的 reserve 行——逐行配对核销
      const reserveRows = await tx.$queryRaw<any[]>`
        SELECT r.* FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${row.teamId} AND r."referenceId" = ${'intent:' + guard.intentRowId} AND r.type = 'reserve'
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        FOR UPDATE OF r`;
      for (const r of reserveRows) {
        await this.ledger.mutate(tx, {
          teamId: r.teamId, operatorUserId: row.userId, type: 'settle', creditType: r.creditType,
          balanceDelta: 0, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id,
        });
      }
      return { success: true, settled: true };
    }, { timeout: 15_000, maxWait: 5_000 });
  }

  /** void_：解冻（外呼失败/组执行第 N+1 放弃）——约束②：reserve 的冲销=release（真值表 (+c,−c)+reversesId，
   *  Z6 正名），不得走反向正账（旧记账法退役）。CAS reservedCredits>0→0 抢解冻权：已 settle/已解冻零动作（幂等）。
   *  quota 回滚=Σ|release 行 amount| 仅当月（月界翻转不污染新月）。 */
  async void_(guard: { intentRowId: string }): Promise<void> {
    await this.prisma.$transaction(async (raw) => {
      const tx = this.ledger.tx(raw);
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
      if (!row?.teamId) return;
      await this.ledger.lockBalance(tx, row.teamId);   // 锁序①：先于 intent CAS（契约 20 全序）
      const cas = await tx.generationIntent.updateMany({
        where: { id: guard.intentRowId, reservedCredits: { gt: 0 } },
        data: { reservedCredits: 0 },
      });
      if (cas.count === 0) return; // 已解冻/已结算——幂等零动作
      // anti-join：未被冲销的 reserve 行——逐行 release 解冻
      const reserveRows = await tx.$queryRaw<any[]>`
        SELECT r.* FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${row.teamId} AND r."referenceId" = ${'intent:' + guard.intentRowId} AND r.type = 'reserve'
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        FOR UPDATE OF r`;
      let total = 0;
      for (const r of reserveRows) {
        total += Math.abs(r.amount);
        await this.ledger.mutate(tx, {
          teamId: r.teamId, operatorUserId: row.userId, type: 'release', creditType: r.creditType,
          balanceDelta: -r.amount, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id,
        });
      }
      if (reserveRows.length > 0) {
        await tx.teamMember.updateMany({
          where: { teamId: row.teamId, userId: row.userId, monthlyPeriod: currentPeriod() },
          data: { monthlyUsed: { decrement: total } },
        });
      }
    }, { timeout: 15_000, maxWait: 5_000 });
  }
}
