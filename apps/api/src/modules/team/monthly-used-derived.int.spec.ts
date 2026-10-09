// apps/api/src/modules/team/monthly-used-derived.int.spec.ts —— Y0b-2 T0：monthlyUsed 派生化
// 口径翻案显式固化：TeamMember.monthlyUsed 列退役（T1 删列）——月度用量从 TeamCreditTransaction 台账派生。
// 红相三条：①成员移除后重加入（旧列实现行删重建归零=配额宽恕；派生按 operatorUserId 聚合=真实用量保留）
//          ②跨月归因（refund 冲销归因被冲销 settle 行月份——非 refund 自身 createdAt）
//          ③活跃冻结计入（谓词=reservedCredits>0 非 status='RUNNING'——complete→settle 窗口钱仍冻结）
// 夹具纪律（Z96）：一律 ledger.runInTx(ensureBalance/mutate) 通行证写法（funds-four-way 同款"T5 教训"）——
// 禁直写 teamBalance/禁裸 raw 台账写/禁给 monthlyUsed/monthlyPeriod 赋值（本 spec 要证明的恰是"派生值与旧列无关"）；
// 意图行用本地 helper（现有 schema 必填字段——heartbeatAt/deadlineAt/idemKey 系 T1 新列）；
// 跨月回填=月界参数注入（bounds 可选参）非裸 UPDATE createdAt；确需物理回填 createdAt 的跨月场景（用例②）
// 用 GUC 包裹 raw UPDATE（T1 前无触发器占位无害；WHERE 必须带 teamId）。
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLedgerService } from './credit-ledger.service';
import { TeamCreditService, currentPeriodBounds } from './team-credit.service';
import { TeamService } from './team.service';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
// listMembers 读点一致性（TeamService 其余依赖位 stub——listMembers 只触 prisma+teamCredit 两依赖）
const teamSvc = new TeamService(
  prisma as unknown as PrismaService, {} as any, {} as any, ledger, {} as any, {} as any, teamCredit,
);

// 夹具登记（afterAll 清理——id 全部后缀化防上轮失败残留自撞，funds-four-way 同纪律）
const reg = { userIds: [] as string[], teamIds: [] as string[], projectIds: [] as string[] };
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** 真脚手架：User+Team(ACTIVE)+TeamMember(OWNER, quota 1000)+钱包 1000（register_grant 通行证）+CanvasProject */
async function scaffold(): Promise<{ userId: string; teamId: string; projectId: string }> {
  const userId = `it-mu-u-${uniq}-${reg.userIds.length + 1}`;
  const teamId = `it-mu-t-${uniq}-${reg.userIds.length + 1}`;
  const projectId = `it-mu-p-${uniq}-${reg.userIds.length + 1}`;
  await prisma.user.create({ data: { id: userId, name: 'it-mu', email: `${userId}@x.invalid`, emailVerified: false } });
  await prisma.team.create({ data: { id: teamId, name: 'it-mu', ownerId: userId, status: 'ACTIVE' } });
  await prisma.teamMember.create({ data: { teamId, userId, role: 'OWNER', monthlyQuota: 1000 } });
  await ledger.runInTx(async (ltx) => {
    await ledger.ensureBalance(ltx, teamId);
    await ledger.lockBalance(ltx, teamId);
    await ledger.mutate(ltx, {
      teamId, operatorUserId: userId, type: 'register_grant', creditType: 'regular',
      balanceDelta: 1000, frozenDelta: 0, referenceId: `register:${teamId}`,
    });
  });
  await prisma.canvasProject.create({ data: { id: projectId, name: 'it-mu', userId, teamId } });
  reg.userIds.push(userId);
  reg.teamIds.push(teamId);
  reg.projectIds.push(projectId);
  return { userId, teamId, projectId };
}

/** settle 一腿（通行证）：建意图行（现有 schema 必填字段）+reserve+settle 两行台账——返回 settle 行锚 */
async function settleTx(teamId: string, userId: string, amount: number, projectId: string): Promise<{ rowId: string; referenceId: string }> {
  const intent = await prisma.generationIntent.create({
    data: {
      projectId, teamId, nodeId: `n-${uniq}-${reg.projectIds.length}`, userId,
      intentId: `it-mu-i-${uniq}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: amount, creditsConsumed: amount,
    },
  });
  const referenceId = `intent:${intent.id}`;
  const res = await ledger.runInTx((tx) => ledger.mutate(tx, {
    teamId, operatorUserId: userId, type: 'reserve', creditType: 'regular',
    balanceDelta: -amount, frozenDelta: amount, referenceId,
  }));
  const st = await ledger.runInTx((tx) => ledger.mutate(tx, {
    teamId, operatorUserId: userId, type: 'settle', creditType: 'regular',
    balanceDelta: 0, frozenDelta: -amount, referenceId, reversesId: res.rowId,
  }));
  return { rowId: st.rowId!, referenceId };
}

/** refund 一腿（通行证）：refund 行冲销指定 settle 行（(+c,0)+reversesId） */
async function refundTx(teamId: string, userId: string, settleRowId: string, referenceId: string, amount: number): Promise<void> {
  await ledger.runInTx((tx) => ledger.mutate(tx, {
    teamId, operatorUserId: userId, type: 'refund', creditType: 'regular',
    balanceDelta: amount, frozenDelta: 0, referenceId, reversesId: settleRowId,
  }));
}

/** 月度用量读点（getBalanceView.used；bounds 可选参直读跨月视图） */
async function viewUsed(teamId: string, userId: string, bounds?: [Date, Date]): Promise<number> {
  return (await teamCredit.getBalanceView(teamId, userId, bounds)).used;
}

(hasDb ? describe : describe.skip)('Y0b-2 T0：monthlyUsed 派生化', () => {
  afterAll(async () => {
    await prisma.teamCreditTransaction.deleteMany({ where: { teamId: { in: reg.teamIds } } }).catch(() => {});
    await prisma.generationIntent.deleteMany({ where: { teamId: { in: reg.teamIds } } }).catch(() => {});
    await prisma.canvasProject.deleteMany({ where: { id: { in: reg.projectIds } } }).catch(() => {});
    await prisma.teamMember.deleteMany({ where: { teamId: { in: reg.teamIds } } }).catch(() => {});
    await prisma.teamBalance.deleteMany({ where: { teamId: { in: reg.teamIds } } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: { in: reg.teamIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: reg.userIds } } }).catch(() => {});
    await prisma.$disconnect();
  }, 30000);

  it('①成员移除后重加入 → 派生保留本月已用量（改前红：TeamMember 行删重建 monthlyUsed 归零=配额宽恕；台账行按 operatorUserId 聚合——行还在）', async () => {
    const f = await scaffold();
    await settleTx(f.teamId, f.userId, 10, f.projectId);
    // 移除后重加入：TeamMember 行删重建（月度配额语义翻案——"计数残留"升级为"真实用量保留"）
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: f.teamId, userId: f.userId } } });
    await prisma.teamMember.create({ data: { teamId: f.teamId, userId: f.userId, role: 'MEMBER', monthlyQuota: 1000 } });
    expect(await viewUsed(f.teamId, f.userId)).toBe(10);
  }, 30000);

  it('②跨月归因判别性：上月 settle 本月 refund → 本月用量 0 且上月视图回落（refund 冲销归因被冲销 settle 行月份，非 refund 自身 createdAt——按后者实现上月视图=10 即红）', async () => {
    const f = await scaffold();
    const st = await settleTx(f.teamId, f.userId, 10, f.projectId);
    // 上月月中点（本月月首减 15 天必落上月）+其完整月界——跨月物理回填用 GUC 包裹 raw UPDATE（WHERE 带 teamId；T1 前无触发器占位无害）
    const [thisStart] = currentPeriodBounds();
    const lastMid = new Date(thisStart.getTime() - 15 * 86400_000);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.ledger_tx', 'on', true)`;
      await tx.$executeRaw`UPDATE "TeamCreditTransaction" SET "createdAt" = ${lastMid} WHERE "teamId" = ${f.teamId} AND id = ${st.rowId}`;
    });
    await refundTx(f.teamId, f.userId, st.rowId, st.referenceId, 10);
    expect(await viewUsed(f.teamId, f.userId, currentPeriodBounds())).toBe(0);                    // 本月：settle 不在本月，refund 归因上月
    expect(await viewUsed(f.teamId, f.userId, currentPeriodBounds(lastMid))).toBe(0);             // 上月视图：10-settle 被 refund 抵扣回落
  }, 30000);

  it('③活跃冻结计入（谓词=reservedCredits>0 非 status——complete→settle 窗口 status 已 SUCCEEDED 而钱仍冻结，按状态门控会让 used 瞬间回落）+complete 后 settle 前 used 不减+月界北京时区单源', async () => {
    const f = await scaffold();
    const intent = await prisma.generationIntent.create({
      data: {
        projectId: f.projectId, teamId: f.teamId, nodeId: 'n-frozen', userId: f.userId,
        intentId: `it-mu-f-${uniq}`, kind: 'text', paramsHash: 'h', creditCost: 4,
      },
    });
    const r = await teamCredit.reserve(f.userId, { intentRowId: intent.id });
    expect(r.success).toBe(true);
    expect(await viewUsed(f.teamId, f.userId)).toBe(4);   // 冻结立即计入（frozen 腿不受 bounds 约束恒计当前在飞——有意的不对称）
    // complete→settle 窗口：status 已 SUCCEEDED 而钱仍冻结——谓词按列（reservedCredits>0）非状态，used 不回落
    await prisma.generationIntent.update({ where: { id: intent.id }, data: { status: 'SUCCEEDED' } });
    expect(await viewUsed(f.teamId, f.userId)).toBe(4);
    // settle 核销后：冻结转实扣，used 语义连续（4 不回落——settle 净额接管同一数额）
    const s = await teamCredit.settle({ intentRowId: intent.id });
    expect(s.settled).toBe(true);
    expect(await viewUsed(f.teamId, f.userId)).toBe(4);
    // 月界恒北京时间月首 0 点（+8 固定无 DST）——固定 now 输入断言精确月界+TZ 注入 sanity（实现纯 UTC 计算不读 TZ）
    const now = new Date('2026-10-01T02:30:00.000Z');   // 北京 10-01 10:30（10 月）；纽约本地 9-30（若按本地时区即错月）
    const prevTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const [start, next] = currentPeriodBounds(now);
      expect(start.toISOString()).toBe('2026-09-30T16:00:00.000Z');   // 北京 10-01 00:00 = UTC 09-30 16:00
      expect(next.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    } finally {
      if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
    }
  }, 30000);

  it('④读点一致：getBalanceView.used ≡ listMembers 派生 used（两读点同源——批量聚合与单成员读共用同一 SQL）', async () => {
    const f = await scaffold();
    await settleTx(f.teamId, f.userId, 7, f.projectId);
    const bv = await teamCredit.getBalanceView(f.teamId, f.userId);
    const members = await teamSvc.listMembers(f.teamId);
    const row = members.items.find((m) => m.user.id === f.userId);
    expect(bv.used).toBe(7);
    expect(row?.monthlyUsed).toBe(7);
    expect(row).not.toHaveProperty('monthlyPeriod');   // 字段退役（T1 删列后无幽灵）
  }, 30000);

  it('附：amount 四 type 符号回归锚（reserve/settle 负、release/refund 正——防未来改真值表时静默改掉退款符号）', async () => {
    const f = await scaffold();
    const st = await settleTx(f.teamId, f.userId, 10, f.projectId);
    await refundTx(f.teamId, f.userId, st.rowId, st.referenceId, 10);
    const intent = await prisma.generationIntent.create({
      data: {
        projectId: f.projectId, teamId: f.teamId, nodeId: 'n-anchor', userId: f.userId,
        intentId: `it-mu-a-${uniq}`, kind: 'text', paramsHash: 'h', creditCost: 6, reservedCredits: 6,
      },
    });
    const res = await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: f.teamId, operatorUserId: f.userId, type: 'reserve', creditType: 'regular',
      balanceDelta: -6, frozenDelta: 6, referenceId: `intent:${intent.id}`,
    }));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: f.teamId, operatorUserId: f.userId, type: 'release', creditType: 'regular',
      balanceDelta: 6, frozenDelta: -6, referenceId: `intent:${intent.id}`, reversesId: res.rowId,
    }));
    const rows = await prisma.teamCreditTransaction.findMany({
      where: { teamId: f.teamId, type: { in: ['reserve', 'settle', 'release', 'refund'] } },
    });
    const byType = (t: string) => rows.filter((x) => x.type === t).map((x) => x.amount);
    expect(byType('reserve').every((a) => a < 0)).toBe(true);
    expect(byType('settle').every((a) => a < 0)).toBe(true);
    expect(byType('release').every((a) => a > 0)).toBe(true);
    expect(byType('refund').every((a) => a > 0)).toBe(true);
  }, 30000);
});
