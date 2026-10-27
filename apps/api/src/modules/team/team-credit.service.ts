import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';
import type { ExecutionNodePlanStatus, ExecutionRequestState } from '@flowweb/shared';

/** Y1c T23（T21 移交⑦收口——附言④）：ExecutionRequest/ExecutionNodePlan 状态值域单源引用
 *  （shared execution-request.ts §3b——写点字面量经类型绑定，值域漂移=本文件编译红）。 */
const REQ_STATE: Record<'ADMITTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'VOIDED', ExecutionRequestState> = {
  ADMITTED: 'ADMITTED', EXECUTING: 'EXECUTING', COMPLETED: 'COMPLETED', FAILED: 'FAILED', VOIDED: 'VOIDED',
};
const PLAN_STATE: Record<'PENDING' | 'EXECUTING' | 'SETTLED' | 'VOIDED' | 'SKIPPED', ExecutionNodePlanStatus> = {
  PENDING: 'PENDING', EXECUTING: 'EXECUTING', SETTLED: 'SETTLED', VOIDED: 'VOIDED', SKIPPED: 'SKIPPED',
};

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
   *  mayCall:false（alreadyReserved）=该意图已被他人冻结/结算（典型 stall 重排）——调用方须静默退出（Z35）。
   *  Y1a T9：guard.execSeq=当次执行代际票（worker 携 claim 返回值/job.data ticket）——①行已换代
   *  （takeover/rearm nextval）⇒ 旧代票 mayCall:false 静默退役（死代禁偷冻结）；②gate CAS 补
   *  execSeq 守卫+写 reservedExecSeq（settleInTx/voidInTx 代际 CAS 锚——旧代资金操作一律 0 命中）。 */
  async reserve(
    userId: string,
    guard: { intentRowId: string; execSeq?: bigint },
  ): Promise<{ success: boolean; reason?: string; alreadyReserved?: boolean; mayCall?: boolean }> {
    return this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
      const intent = await tx.generationIntent.findUniqueOrThrow({ where: { id: guard.intentRowId } });
      // T9 代际前置：读行即验票——行 execSeq 已换代 ⇒ 旧 worker 的 reserve 静默退役（零冻结零流水）
      if (guard.execSeq !== undefined && intent.execSeq !== guard.execSeq) {
        return { success: true, alreadyReserved: true, mayCall: false, reason: 'EXEC_SEQ_STALE' };
      }
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
      // 锁序②：gate CAS 持锁期间完成（四守卫保留——约束① CAS 锚 reservedCredits 0→amount，creditsConsumed:0 并守；
      // T9：execSeq 并守（读行后换代并发窗收口）+reservedExecSeq 落冻结代际锚；
      // T23 收口 I-1：**status:'RUNNING' 并守**——drainRefundObligations 终态化写 FAILED∧
      // reservedCredits=0∧reservedExecSeq=null（execSeq/creditsConsumed 不动）⇒ 缺 status 谓词时
      // 三谓词全匹配=迟到 reserve 对 FAILED 行再冻结+多烧一次外呼+FAILED∧reservedCredits>0
      // 不变量破坏（settle/void 无同洞——独 reserve 一面）。终态/停驻行一律禁冻结。）
      const gate = await tx.generationIntent.updateMany({
        where: {
          id: guard.intentRowId, status: 'RUNNING', reservedCredits: 0, creditsConsumed: 0,
          ...(guard.execSeq !== undefined ? { execSeq: guard.execSeq } : {}),
        },
        data: { reservedCredits: amount, ...(guard.execSeq !== undefined ? { reservedExecSeq: guard.execSeq } : {}) },
      });
      if (gate.count === 0) {
        const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
        // T9：gate 失因换代（读行后行被 takeover/rearm nextval）⇒ 旧代票静默退役（非 onReserveFail——行归新代）
        if (guard.execSeq !== undefined && row && row.execSeq !== guard.execSeq) {
          return { success: true, alreadyReserved: true, mayCall: false, reason: 'EXEC_SEQ_STALE' };
        }
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

  // ═══ Y1c T21（G4 门）：ExecutionRequest per-item 资金面（受理预留/逐 item void/逐 item 结算）═══
  // 纪律承袭：写路径全经 CreditLedgerService（Z12 品牌 tx+Z13 锁序①lockBalance 先行+§1.4bis 真值表
  // reserve(-c,+c)/release(+c,-c)/settle(0,-c)）；受理事务一体化（tx 注入——任一失败整体回滚零半行）；
  // requestId 幂等重试不重复预留（受理幂等前置在 ExecutionRequestService——本层无重复进入面）。

  /** 受理预留：per-item 冻结（ExecutionNodePlan.reservedCredit 载体；台账 referenceId=
   *  `execreq:<id>#<nodeId>`——资金审计 join 键）。余额不足=失败（受理整体回滚）。 */
  async reserveForExecutionRequest(
    userId: string,
    req: { executionRequestId: string; teamId: string; items: Array<{ nodeId: string; amount: number }> },
    tx?: Prisma.TransactionClient,
  ): Promise<{ success: boolean; reason?: string }> {
    const run = async (raw: Prisma.TransactionClient) => {
      const ltx = await this.ledger.ledgerTx(raw);
      await this.ledger.lockBalance(ltx, req.teamId);   // 锁序①（契约 20）
      const balance = await ltx.teamBalance.findUnique({ where: { teamId: req.teamId } });
      if (!balance) return { success: false, reason: 'TEAM_BALANCE_MISSING' };
      const member = await ltx.teamMember.findUnique({ where: { teamId_userId: { teamId: req.teamId, userId } } });
      if (!member) return { success: false, reason: 'NOT_MEMBER' };
      const total = req.items.reduce((s, i) => s + i.amount, 0);
      if (total === 0) return { success: true };
      if (balance.credits + balance.subscriptionCredits < total) return { success: false, reason: 'CREDIT_INSUFFICIENT' };
      // I-3（T21 收口）：月度配额——execreq 在飞预留计入月度用量（同 reserve() 配额段形态）；
      // 在飞面=ExecutionRequest.reservedCredit（ADMITTED/EXECUTING——TTL≤15min 近月度窗口语义）
      const used = await this.derivedMonthlyUsed(ltx, req.teamId, userId);
      const inflightAgg = await ltx.executionRequest.aggregate({
        _sum: { reservedCredit: true },
        where: { teamId: req.teamId, userId, reservedCredit: { gt: 0 }, state: { in: [REQ_STATE.ADMITTED, REQ_STATE.EXECUTING] } },
      });
      const execreqInFlight = inflightAgg._sum.reservedCredit ?? 0;
      if (member.monthlyQuota > 0 && used + execreqInFlight + total > member.monthlyQuota) {
        return { success: false, reason: 'QUOTA_EXCEEDED' };
      }
      let subLeft = balance.subscriptionCredits;
      for (const item of req.items) {
        if (item.amount <= 0) continue;
        const sub = Math.min(subLeft, item.amount);
        subLeft -= sub;
        const reg = item.amount - sub;
        if (sub > 0) await this.ledger.mutate(ltx, {
          teamId: req.teamId, operatorUserId: userId, type: 'reserve', creditType: 'subscription',
          balanceDelta: -sub, frozenDelta: sub, referenceId: `execreq:${req.executionRequestId}#${item.nodeId}`,
          idempotencyKey: `execreq-reserve:${req.executionRequestId}#${item.nodeId}`,
        });
        if (reg > 0) await this.ledger.mutate(ltx, {
          teamId: req.teamId, operatorUserId: userId, type: 'reserve', creditType: 'regular',
          balanceDelta: -reg, frozenDelta: reg, referenceId: `execreq:${req.executionRequestId}#${item.nodeId}`,
          idempotencyKey: `execreq-reserve:${req.executionRequestId}#${item.nodeId}:reg`,
        });
        await ltx.executionNodePlan.updateMany({
          where: { requestId: req.executionRequestId, nodeId: item.nodeId },
          data: { reservedCredit: item.amount },
        });
      }
      return { success: true };
    };
    return tx ? run(tx) : this.prisma.$transaction((raw) => run(raw), { timeout: 15_000, maxWait: 5_000 });
  }

  /** execreq 域 reserve 行 anti-join 锁内读取（I1：NOT EXISTS reversesId 在场=已逆转行不二动
   *  +FOR UPDATE 行锁——settleInTx patchRows 先例同构，idempotencyKey 幂等之外的结构面双保险）。 */
  private async execreqReserveRowsForUpdate(
    ltx: Prisma.TransactionClient,
    teamId: string,
    referenceId: string,
  ): Promise<Array<{ id: string; creditType: 'subscription' | 'regular'; amount: number }>> {
    const rows = await ltx.$queryRaw<Array<{ id: string; creditType: string; balanceDelta: number }>>`
      SELECT r."id" AS id, r."creditType" AS "creditType", r."balanceDelta" AS "balanceDelta"
      FROM "TeamCreditTransaction" r
      WHERE r."teamId" = ${teamId}::text AND r."referenceId" = ${referenceId}::text AND r."type" = 'reserve'
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r."id")
      FOR UPDATE OF r`;
    return rows.map((r) => ({ id: r.id, creditType: r.creditType as 'subscription' | 'regular', amount: Math.abs(r.balanceDelta) }));
  }

  /** 逐 item void（sweeper 过期/受理失败回滚/执行失败）：release(+c,-c) 逆转 reserve；幂等
   *  （reservedCredit=0 的 item 不再逆转）；全部 item 清零后父行 state=VOIDED。 */
  async voidForExecutionRequest(executionRequestId: string, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (raw) => {
      const ltx = await this.ledger.ledgerTx(raw);
      // I1（T21 收口）：CAS 抢占——只对 ADMITTED 行生效；0 行=claim 抢先（EXECUTING）或已终态
      // →让位 return false（不释放执行中资金——交错(b)：sweeper 选中后 claim 抢先=void 让位）。
      const claimed = await ltx.executionRequest.updateMany({
        where: { id: executionRequestId, state: REQ_STATE.ADMITTED },
        data: { state: REQ_STATE.VOIDED, reservedCredit: 0 },
      });
      if (claimed.count === 0) return false;
      const req = await ltx.executionRequest.findUniqueOrThrow({ where: { id: executionRequestId } });
      await this.ledger.lockBalance(ltx, req.teamId);   // 锁序①：先于 items 复读（I1 锁内复读）
      const items = await ltx.executionNodePlan.findMany({ where: { requestId: executionRequestId } });
      void reason;   // 失败原因归调用方审计/日志面（本表无 error 列）
      for (const item of items) {
        if (item.reservedCredit <= 0) continue;
        const reserveRows = await this.execreqReserveRowsForUpdate(ltx, req.teamId, `execreq:${executionRequestId}#${item.nodeId}`);
        for (const r of reserveRows) {
          await this.ledger.mutate(ltx, {
            teamId: req.teamId, operatorUserId: req.userId, type: 'release', creditType: r.creditType,
            balanceDelta: r.amount, frozenDelta: -r.amount,
            referenceId: `execreq:${executionRequestId}#${item.nodeId}`,
            reversesId: r.id,   // release 真值表：(+c,−c) 且 reversesId 指向 exact reserve 行（Z6 配对）
            idempotencyKey: `execreq-release:${executionRequestId}#${item.nodeId}:${r.id}`,
          });
        }
        await ltx.executionNodePlan.updateMany({
          where: { requestId: executionRequestId, nodeId: item.nodeId, reservedCredit: item.reservedCredit },   // I1：item CAS 谓词
          data: { reservedCredit: 0, status: PLAN_STATE.VOIDED },
        });
      }
      return true;
    }, { timeout: 15_000, maxWait: 5_000 });
  }

  /** 逐 item void（执行失败单节点）：release 逆转该 item 的 reserve 行（幂等——reservedCredit=0
   *  不再逆转）；父行 reservedCredit 同步递减。 */
  async voidForExecutionRequestItem(input: { executionRequestId: string; nodeId: string }): Promise<boolean> {
    return this.prisma.$transaction(async (raw) => {
      const ltx = await this.ledger.ledgerTx(raw);
      const item = await ltx.executionNodePlan.findUnique({
        where: { requestId_nodeId: { requestId: input.executionRequestId, nodeId: input.nodeId } },
      });
      if (!item || item.reservedCredit <= 0) return false;
      const req = await ltx.executionRequest.findUnique({ where: { id: input.executionRequestId }, select: { teamId: true, userId: true } });
      if (!req) return false;
      await this.ledger.lockBalance(ltx, req.teamId);
      const reserveRows = await this.execreqReserveRowsForUpdate(ltx, req.teamId, `execreq:${input.executionRequestId}#${input.nodeId}`);
      for (const r of reserveRows) {
        await this.ledger.mutate(ltx, {
          teamId: req.teamId, operatorUserId: req.userId, type: 'release', creditType: r.creditType,
          balanceDelta: r.amount, frozenDelta: -r.amount,
          referenceId: `execreq:${input.executionRequestId}#${input.nodeId}`,
          reversesId: r.id,
          idempotencyKey: `execreq-release:${input.executionRequestId}#${input.nodeId}:${r.id}`,
        });
      }
      await ltx.executionNodePlan.updateMany({
        where: { requestId: input.executionRequestId, nodeId: input.nodeId, reservedCredit: item.reservedCredit },   // I1：item CAS 谓词
        data: { reservedCredit: 0, status: PLAN_STATE.VOIDED },
      });
      await ltx.executionRequest.updateMany({
        where: { id: input.executionRequestId },
        data: { reservedCredit: { decrement: item.reservedCredit } },
      });
      return true;
    }, { timeout: 15_000, maxWait: 5_000 });
  }

  /** 逐 item 结算（执行成功）：settle(0,-c) 冻结转实扣——reversesId 指向该 item 的 reserve 台账行
   *  （exact settle row 配对）；幂等（reservedCredit=0 不再结算）。 */
  async settleForExecutionRequestItem(
    userId: string,
    input: { executionRequestId: string; nodeId: string; teamId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ success: boolean; settled: boolean; amount: number }> {
    const run = async (raw: Prisma.TransactionClient) => {
      const ltx = await this.ledger.ledgerTx(raw);
      const item = await ltx.executionNodePlan.findUnique({
        where: { requestId_nodeId: { requestId: input.executionRequestId, nodeId: input.nodeId } },
      });
      if (!item || item.reservedCredit <= 0) return { success: true, settled: false, amount: 0 };
      await this.ledger.lockBalance(ltx, input.teamId);
      const reserveRows = await this.execreqReserveRowsForUpdate(ltx, input.teamId, `execreq:${input.executionRequestId}#${input.nodeId}`);
      // R1（二轮·金额守卫）：anti-join 空=该 item 的 reserve 行全已冲销（裸重放/stale 读源）——不改判
      // SETTLED、零 ledger 动作、**零 request decrement**（取舍注记：守卫优于改判 void——裸重放非失败
      // 语义，void 会把已核销面错标 VOIDED；item 留原状交 sweeper/对账）。item CAS 命中后才 decrement
      // （防 stale plan 重放减负）。
      if (reserveRows.length === 0) return { success: true, settled: false, amount: 0 };
      const claimed = await ltx.executionNodePlan.updateMany({
        where: { requestId: input.executionRequestId, nodeId: input.nodeId, reservedCredit: item.reservedCredit },   // I1：item CAS 谓词
        data: { reservedCredit: 0, status: PLAN_STATE.SETTLED },
      });
      if (claimed.count === 0) return { success: true, settled: false, amount: 0 };   // 他者已收口（CAS miss）——零 decrement
      let settledAmount = 0;
      for (const r of reserveRows) {
        settledAmount += r.amount;
        await this.ledger.mutate(ltx, {
          teamId: input.teamId, operatorUserId: userId, type: 'settle', creditType: r.creditType,
          balanceDelta: 0, frozenDelta: -r.amount,
          referenceId: `execreq:${input.executionRequestId}#${input.nodeId}`,
          reversesId: r.id,
          idempotencyKey: `execreq-settle:${input.executionRequestId}#${input.nodeId}:${r.id}`,
        });
      }
      await ltx.executionRequest.updateMany({
        where: { id: input.executionRequestId },
        data: { reservedCredit: { decrement: item.reservedCredit } },   // 仅 item CAS 命中后（R1）
      });
      return { success: true, settled: true, amount: settledAmount };
    };
    return tx ? run(tx) : this.prisma.$transaction((raw) => run(raw), { timeout: 15_000, maxWait: 5_000 });
  }

  /** settle：外呼成功后核销——冻结转实扣（reservedCredits 清零+creditsConsumed 置位+settle 记账行）。
   *  台账锚（F1）+anti-join（Z6）+锁序①（lockBalance 先于 intent CAS）+reversesId 配对。
   *  CAS 后崩溃修补（报2 P1-1）：reservedCredits 已归零但 settle 行未写——anti-join 补写（reversesId 唯一=幂等安全）。
   *  幂等：已结清（无未冲销 reserve 行）⇒ settled:false 零动作。
   *  Y1a T9：guard.execSeq=代际票——与行 reservedExecSeq 不匹配（takeover/rearm 换代后新代已重冻结）
   *  ⇒ 旧代结算 0 命中（settled:false 零动作——不得核销新代冻结）。settleInTx=T10 finalize 事务内消费形态。 */
  async settle(guard: { intentRowId: string; execSeq?: bigint }): Promise<{ success: boolean; settled: boolean }> {
    return this.prisma.$transaction((raw) => this.settleInTx(raw, guard), { timeout: 15_000, maxWait: 5_000 });
  }

  // ═══ Y1c T23（spec §6.3 退款义务——EXEC_FINALIZE 消费面）：RefundObligation collect/drain ═══
  // 纪律（shared execution-chain.ts §5 LIFECYCLE_OBLIGATION_REFUND_PATH）：删除节点的在飞
  // GenerationIntent 资金收口=精确业务记录逆转——unique(intentRowId,execSeq) 幂等+reversesId 指向
  // exact 台账行；**不依据客户端 doc 字段或过期 worker 状态**（资金记录=台账行本身）。

  /** collect（EXEC_FINALIZE 义务落地）：节点在飞（RUNNING）意图逐行义务化——创建 PENDING
   *  RefundObligation（pinned execSeq=执行代际族锚；creditAmount=creditCost 快照〔提示值——
   *  实际逆转金额恒以台账 exact reserve 行为准〕；reversesId 先落 `intent:<id>` 占位、drain 时回填
   *  exact 台账行 id）。幂等：unique(intentRowId,execSeq)+skipDuplicates——重复 collect 零新行。 */
  async collectExecFinalize(projectId: string, nodeId: string): Promise<number> {
    const running = await this.prisma.generationIntent.findMany({
      where: { projectId, nodeId, status: 'RUNNING' },
      select: { id: true, execSeq: true, creditCost: true },
    });
    if (running.length === 0) return 0;
    const r = await this.prisma.refundObligation.createMany({
      data: running.map((i) => ({
        intentRowId: i.id,
        execSeq: i.execSeq,
        reversesId: `intent:${i.id}`,   // 占位（幂等键族纪律同 `intent:` 前缀）——drain 回填 exact 行
        creditAmount: i.creditCost,
        state: 'PENDING',
      })),
      skipDuplicates: true,   // unique(intentRowId,execSeq)——重扫/崩溃窗重放恰一次
    });
    return r.count;
  }

  /** drain（PENDING 义务逐行收口）：pinned (intentRowId,execSeq) 对行现态分义——
   *  ①命中（行仍 RUNNING∧execSeq==pinned：义务生成时的那一代在飞）⇒ 单事务：lockBalance→
   *    intent CAS RUNNING→FAILED（execSeq 守卫）→anti-join 逆转 exact reserve 行（release(+c,−c)+
   *    reversesId 配对）→义务 SETTLED+reversesId 回填 exact 台账行 id。交付不可能（节点已删）
   *    =FAILED 终态+冻结释放。
   *  ②让位（行已终态/换代〔rearm 新代在飞〕/行灭失）⇒ 零资金动作、义务 SETTLED（迟到旧义务
   *    pinned execSeq 对换代行 0 命中=让位——新代冻结纹丝不动）。
   *  返回 {settled=让位收口数, collected=真退款收口数}。 */
  async drainRefundObligations(batch = 50): Promise<{ settled: number; collected: number }> {
    const pending = await this.prisma.refundObligation.findMany({
      where: { state: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: batch,
    });
    let settled = 0;
    let collected = 0;
    for (const ob of pending) {
      const outcome = await this.drainRefundObligation(ob);
      if (outcome === 'collected') collected += 1; else settled += 1;
    }
    return { settled, collected };
  }

  /** 单义务收口（事务内三步：CAS 终态化→精确逆转→义务 SETTLED；CAS 0 命中=并发让位零资金动作）。 */
  private async drainRefundObligation(ob: { id: string; intentRowId: string; execSeq: bigint }): Promise<'collected' | 'settled'> {
    const intent = await this.prisma.generationIntent.findUnique({ where: { id: ob.intentRowId } });
    if (!intent || intent.status !== 'RUNNING' || intent.execSeq !== ob.execSeq) {
      // 让位（迟到旧义务）：行已终态/换代/灭失——pinned 0 命中，零资金动作直收口
      await this.prisma.refundObligation.updateMany({ where: { id: ob.id, state: 'PENDING' }, data: { state: 'SETTLED' } });
      return 'settled';
    }
    const reason = 'EXEC_FINALIZE:节点已删除——在飞意图收口（交付不可能）'.slice(0, 500);
    let reversesRowId: string | null = null;
    let casHit = false;
    await this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);
      await this.ledger.lockBalance(tx, intent.teamId);   // 锁序①（契约 20）
      // intent CAS（RUNNING∧pinned execSeq→FAILED）：0 命中=并发终态化/换代——让位零资金动作
      const cas = await tx.generationIntent.updateMany({
        where: { id: ob.intentRowId, status: 'RUNNING', execSeq: ob.execSeq },
        data: { status: 'FAILED', reservedCredits: 0, reservedExecSeq: null, error: reason, completedAt: new Date() },
      });
      if (cas.count === 0) return;
      casHit = true;
      // 精确逆转：anti-join 未冲销 reserve 行——release(+c,−c)+reversesId 配对（Z6 真值表；
      // 池别/金额逐台账行——不依据 ob.creditAmount 提示值）
      const reserveRows = await tx.$queryRaw<Array<{ id: string; creditType: 'subscription' | 'regular'; balanceDelta: number }>>`
        SELECT r."id" AS id, r."creditType" AS "creditType", r."balanceDelta" AS "balanceDelta"
        FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${intent.teamId}::text AND r."referenceId" = ${'intent:' + ob.intentRowId}::text AND r."type" = 'reserve'
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r."id")
        FOR UPDATE OF r`;
      for (const r of reserveRows) {
        reversesRowId = r.id;
        await this.ledger.mutate(tx, {
          teamId: intent.teamId, operatorUserId: intent.userId, type: 'release', creditType: r.creditType,
          balanceDelta: Math.abs(r.balanceDelta), frozenDelta: -Math.abs(r.balanceDelta),
          referenceId: `intent:${ob.intentRowId}`, reversesId: r.id,
          idempotencyKey: `refund-ob:${ob.id}:${r.id}`,
        });
      }
      await tx.refundObligation.updateMany({
        where: { id: ob.id, state: 'PENDING' },
        data: { state: 'SETTLED', ...(reversesRowId ? { reversesId: reversesRowId } : {}) },
      });
    }, { timeout: 15_000, maxWait: 5_000 });
    return casHit ? 'collected' : 'settled';
  }

  /** T9 settleInTx：调用方事务内核销（ledgerTx 内部装饰幂等——SET LOCAL 重执行无害）。 */
  async settleInTx(rawTx: Prisma.TransactionClient, guard: { intentRowId: string; execSeq?: bigint }): Promise<{ success: boolean; settled: boolean }> {
    const tx = await this.ledger.ledgerTx(rawTx);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
    const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
    if (!row?.teamId) return { success: false, settled: false };
    // T9 代际前置：携票且行冻结锚已换代（或已释放归 null）⇒ 旧代结算 0 命中（新代冻结禁动）
    if (guard.execSeq !== undefined && row.reservedExecSeq !== guard.execSeq) {
      return { success: true, settled: false };
    }
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
    // T9：CAS 补 reservedExecSeq 锚（无票调用=reconcile 终态路径——按行自身锚，与携票等价安全）
    const seqAnchor = guard.execSeq ?? row.reservedExecSeq;
    const cas = await tx.generationIntent.updateMany({
      where: {
        id: guard.intentRowId, reservedCredits: row.reservedCredits,
        ...(seqAnchor !== null ? { reservedExecSeq: seqAnchor } : {}),
      },
      data: { reservedCredits: 0, creditsConsumed: row.reservedCredits, reservedExecSeq: null },
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
  }

  /** void_：解冻（外呼失败/组执行第 N+1 放弃）——约束②：reserve 的冲销=release（真值表 (+c,−c)+reversesId，
   *  Z6 正名），不得走反向正账（旧记账法退役）。CAS reservedCredits>0→0 抢解冻权：已 settle/已解冻零动作（幂等）。
   *  Y0b-2 T0：quota 无需回滚——used 已派生（release 后 frozen 腿自然回落）。
   *  Y1a T9：guard.execSeq=代际票——CAS 补 reservedExecSeq 锚（旧代票对换代后新代冻结 0 命中）；
   *  voidInTx=claim rearm/takeover 事务内只释放形态（v9「release+re-reserve」废止——重扣费归新段 reserve）。 */
  async void_(guard: { intentRowId: string; execSeq?: bigint }): Promise<void> {
    await this.prisma.$transaction((raw) => this.voidInTx(raw, guard), { timeout: 15_000, maxWait: 5_000 });
  }

  /** T9 voidInTx：调用方事务内解冻（claimTx rearm/takeover 消费——ledgerTx 内部装饰幂等）。 */
  async voidInTx(rawTx: Prisma.TransactionClient, guard: { intentRowId: string; execSeq?: bigint }): Promise<void> {
    const tx = await this.ledger.ledgerTx(rawTx);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
    const row = await tx.generationIntent.findUnique({ where: { id: guard.intentRowId } });
    if (!row?.teamId) return;
    await this.ledger.lockBalance(tx, row.teamId);   // 锁序①：先于 intent CAS（契约 20 全序）
    const seqAnchor = guard.execSeq ?? row.reservedExecSeq;
    const cas = await tx.generationIntent.updateMany({
      where: {
        id: guard.intentRowId, reservedCredits: { gt: 0 },
        ...(seqAnchor !== null ? { reservedExecSeq: seqAnchor } : {}),
      },
      data: { reservedCredits: 0, reservedExecSeq: null },
    });
    if (cas.count === 0) return; // 已解冻/已结算/代际锚不匹配（旧代票 vs 新代冻结）——幂等零动作
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
  }

  /** Z64/Z75/Z92/Z102：资金回滚单实现三入口。锁序=契约 20：读 intent（无锁）→lockBalance（TB 行锁）
   *  →GI CAS→逐行冲销（事务原子——冲销中途抛错整体回滚，行留原态交重扫）。
   *  Z92 竞态封死（入口语义拆分）：rollbackRunning（CAS 严格 RUNNING）=reaper/deadline 唯一——
   *    complete 先行（SUCCEEDED）后迟归的 reaper 在此零命中，"退款后仍交付"结构性关闭；
   *  rollbackDeliveryFailed（CAS SUCCEEDED——交付凭据 written:false 由调用方持有）=交付路径唯一；
   *  rollbackStranded（CAS SUCCEEDED∧reservedCredits>0∧判龄——Z102 第三入口）=R3 终态悬留批唯一：
   *    判龄是安全要件（"无活 worker 持有"的结构证明——也是它可被 reaper 侧调用而不重开 Z92 竞态的原因）。
   *  返回值：CAS 是否命中（false=并发已抢/判龄不满足——幂等零动作）。 */
  async rollbackRunning(intentRowId: string, reason: string, cutoff?: Date): Promise<boolean> {
    return this.doRollback(intentRowId, reason, { status: 'RUNNING', ...(cutoff ? { heartbeatAt: { lt: cutoff } } : {}) });
  }

  async rollbackDeliveryFailed(intentRowId: string, reason: string): Promise<boolean> {
    return this.doRollback(intentRowId, reason, { status: 'SUCCEEDED' });
  }

  async rollbackStranded(intentRowId: string, reason: string, cutoff: Date): Promise<boolean> {
    return this.doRollback(intentRowId, reason, { status: 'SUCCEEDED', reservedCredits: { gt: 0 }, completedAt: { lt: cutoff } });
  }

  private async doRollback(
    intentRowId: string, reason: string,
    from: { status: 'RUNNING' | 'SUCCEEDED'; reservedCredits?: { gt: 0 }; completedAt?: { lt: Date }; heartbeatAt?: { lt: Date } },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (raw) => {
      const tx = await this.ledger.ledgerTx(raw);   // Z89：首句取通行证（lock_timeout+app.ledger_tx 双 SET LOCAL）
      const intent = await tx.generationIntent.findUnique({ where: { id: intentRowId } });
      if (!intent || intent.status !== from.status) return false;
      await this.ledger.lockBalance(tx, intent.teamId);   // ← TB 行锁先于 GI 写（契约 20）
      const guard = await tx.generationIntent.updateMany({
        where: { id: intentRowId, ...from },
        data: { status: 'VOIDED', reservedCredits: 0, creditsConsumed: 0, error: reason.slice(0, 500), completedAt: new Date() },
      });
      if (guard.count === 0) return false;   // 并发已抢/判龄不满足（幂等）
      // anti-join：未被冲销的 reserve/settle 行——按行类型分义冲销（settle→refund(+c,0) / reserve→release(+c,−c)+reversesId）
      const rows = await tx.$queryRaw<any[]>`
        SELECT r.* FROM "TeamCreditTransaction" r
        WHERE r."teamId" = ${intent.teamId} AND r."referenceId" = ${'intent:' + intentRowId}
          AND r.type IN ('reserve', 'settle') AND r.amount < 0
          AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = r.id)
        FOR UPDATE OF r`;
      for (const r of rows) {
        await this.ledger.mutate(tx, r.type === 'settle'
          ? {
            teamId: r.teamId, operatorUserId: intent.userId, type: 'refund', creditType: r.creditType,
            balanceDelta: Math.abs(r.amount), frozenDelta: 0, referenceId: r.referenceId, reversesId: r.id,
          }
          : {
            teamId: r.teamId, operatorUserId: intent.userId, type: 'release', creditType: r.creditType,
            balanceDelta: Math.abs(r.amount), frozenDelta: -Math.abs(r.amount), referenceId: r.referenceId, reversesId: r.id,
          });
      }
      return true;
    }, { timeout: 15_000, maxWait: 5_000 });
  }
}
