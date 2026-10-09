import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';

/** 月界单源（Y0b-2 T0/Z96）：业务时区=Asia/Shanghai 固定 +8 无 DST——纯 UTC 会使配额在每月 1 日 08:00
 *  重置，产品语义错；Date.UTC 计算后平移 -8h，消灭 Node 本地时区 vs Prisma naive UTC 的错位。 */
export function currentPeriodBounds(now = new Date()): [Date, Date] {
  const bj = new Date(now.getTime() + 8 * 3600_000);                     // 平移到东八区视角
  const y = bj.getUTCFullYear(), m = bj.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - 8 * 3600_000);              // 北京月首 0 点
  const next = new Date(Date.UTC(y, m + 1, 1) - 8 * 3600_000);
  return [start, next];
}

@Injectable()
export class TeamCreditService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
  ) {}

  /** 双池+总额+该成员 quota/used（Y0b-2 T0：used 改道台账派生——TeamMember.monthlyUsed 列暂留〔仅 generation-intent.int.spec:216 遗留读点，T1 删列时同批清理〕）。
   *  bounds 可选参=跨月视图直读（月界参数注入——默认当月）。 */
  async getBalanceView(teamId: string, userId: string, bounds?: [Date, Date]) {
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId } });
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('非团队成员');

    const used = await this.derivedMonthlyUsed(this.prisma, teamId, userId, bounds);
    const credits = balance?.credits ?? 0;
    const subscriptionCredits = balance?.subscriptionCredits ?? 0;
    return {
      credits,
      subscriptionCredits,
      total: credits + subscriptionCredits,
      quota: member.monthlyQuota,
      used,
    };
  }

  /** Z70/Z86/Z96：月度用量派生（批量）——settle+refund 净额（GROUP BY operatorUserId）+frozen（GROUP BY userId）两腿。
   *  CTE 单语句（JOIN 内联免 Prisma.join/参数上限）；settle 归因=settle.createdAt（禁经 reversesId 改挂 reserve
   *  时间——跨月订单会归错月）；refund 冲销归因被冲销 settle 行月份〔refund 无时间条件〕。
   *  frozen 腿谓词=reservedCredits>0（列语义，与 generation_intent_frozen_partial 同谓词）非 status——
   *  complete→settle 窗口 status 已 SUCCEEDED 而钱仍冻结，按状态门控会让 used 瞬间回落；且 frozen 腿不受
   *  bounds 约束恒计当前在飞（有意的不对称）。listMembers 聚合与单成员读共用本方法=谓词单源。
   *  事务内必须传 tx（交互式事务内 this.prisma 另开连接=死锁+看不到未提交写）。 */
  async derivedMonthlyUsedMap(tx: Prisma.TransactionClient, teamId: string, bounds?: [Date, Date]): Promise<Map<string, number>> {
    const [start, next] = bounds ?? currentPeriodBounds();
    const netRows = await tx.$queryRaw<{ uid: string | null; net: bigint }[]>`
      WITH s AS (SELECT id, amount, "operatorUserId" FROM "TeamCreditTransaction"
                 WHERE "teamId" = ${teamId} AND type = 'settle'
                   AND "createdAt" >= ${start} AND "createdAt" < ${next} AND amount < 0),
      settle_sum AS (SELECT "operatorUserId" AS uid, SUM(-amount) AS settled FROM s GROUP BY 1),
      refund_sum AS (SELECT s."operatorUserId" AS uid, COALESCE(SUM(t.amount), 0) AS refunded
                     FROM "TeamCreditTransaction" t JOIN s ON t."reversesId" = s.id
                     WHERE t.type = 'refund' GROUP BY 1)
      SELECT ss.uid, ss.settled - COALESCE(r.refunded, 0) AS net
      FROM settle_sum ss LEFT JOIN refund_sum r ON r.uid = ss.uid`;
    const frozenRows = await tx.$queryRaw<{ uid: string; s: bigint }[]>`
      SELECT "userId" AS uid, COALESCE(SUM("reservedCredits"), 0) AS s FROM "GenerationIntent"
      WHERE "teamId" = ${teamId} AND "reservedCredits" > 0 GROUP BY 1`;
    const map = new Map<string, number>();
    for (const r of netRows) if (r.uid !== null) map.set(r.uid, Math.max(Number(r.net), 0));
    for (const r of frozenRows) map.set(r.uid, (map.get(r.uid) ?? 0) + Number(r.s));
    return map;
  }

  /** 单成员读=批量读特例（Z96：一个方法返回 Map——谓词/SQL 单源）。 */
  private async derivedMonthlyUsed(tx: Prisma.TransactionClient, teamId: string, userId: string, bounds?: [Date, Date]): Promise<number> {
    return (await this.derivedMonthlyUsedMap(tx, teamId, bounds)).get(userId) ?? 0;
  }

  /** reserve：外呼前冻结——余额不足即拒=零外呼零沉没（批0.5-9 语义保持）。
   *  Y0b-1（Z10）：金额单源 intent 行（plan 固化快照）——调用方无"定多少钱"的权力；TOCTOU 结构性消失。
   *  写路径全经 CreditLedgerService（Z12 品牌 tx+Z13 锁序①lockBalance 先于 gate CAS+§1.4bis 真值表）。
   *  mayCall:false（alreadyReserved）=该意图已被他人冻结/结算（典型 stall 重排）——调用方须静默退出（Z35）。 */
  async reserve(
    userId: string,
    guard: { intentRowId: string },
  ): Promise<{ success: boolean; reason?: string; alreadyReserved?: boolean; mayCall?: boolean }> {
    return this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
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
      // Y0b-2 T0：月度用量改道派生（lockBalance 之后读——FOR UPDATE 持有下台账写与本读串行化，无 TOCTOU）
      const used = await this.derivedMonthlyUsed(tx, teamId, userId);
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
  }

  /** settle：外呼成功后核销——冻结转实扣（reservedCredits 清零+creditsConsumed 置位+settle 记账行）。
   *  台账锚（F1）+anti-join（Z6）+锁序①（lockBalance 先于 intent CAS）+reversesId 配对。
   *  CAS 后崩溃修补（报2 P1-1）：reservedCredits 已归零但 settle 行未写——anti-join 补写（reversesId 唯一=幂等安全）。
   *  幂等：已结清（无未冲销 reserve 行）⇒ settled:false 零动作。 */
  async settle(guard: { intentRowId: string }): Promise<{ success: boolean; settled: boolean }> {
    return this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
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
   *  Y0b-2 T0：quota 无需回滚——used 已派生（release 后 frozen 腿自然回落）。 */
  async void_(guard: { intentRowId: string }): Promise<void> {
    await this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
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
      for (const r of reserveRows) {
        await this.ledger.mutate(tx, {
          teamId: r.teamId, operatorUserId: row.userId, type: 'release', creditType: r.creditType,
          balanceDelta: -r.amount, frozenDelta: r.amount, referenceId: r.referenceId, reversesId: r.id,
        });
      }
    }, { timeout: 15_000, maxWait: 5_000 });
  }
}
