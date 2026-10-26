// apps/api/src/modules/execution/execution-frozen.t21-c1.int.spec.ts
// Y1c T21 双评审收口（Controller 裁定批——C1/I-2/I-3/I1/I2/I3/I4/幂等域/M-3/M-4 真库用例）：
// C1 冻结执行×F1 资金硬门（付费/免费/部分失败三态端到端——settlement mode 'execreq' 档）+
// I-2 冻结路径运行时全链（claim 回写 requestId+ADMITTED→EXECUTING CAS+remaining 收口）+
// I4 upsertNodeExecutionGuarded 真库 SQL≡nodeExecutionUpdateAllowed 真值表+unused import 消费 +
// I-3 配额（execreq 在飞计入月度）+I1 交错（void 后迟到 execute 拒/sweeper 让位）+I2 settle 失败不悬挂 +
// I3 P2002 复读 replay+幂等身份域（docSeq+有序 nodeIds 等值）+M-4 非executable SKIPPED+M-3 上游 dedup。
// 红形态：本套件先于收口实现空转跑——付费三态=FundsInvariantError 回滚红/配额=绕过红/
// 幂等序=集合比对忽略序红/P2002=500 ADMIPTION_FAILED 泄漏 message 红/SKIPPED=remaining 卡 EXECUTING 红。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fillDoc, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
import { toDocLike } from '../collab/doc-like.util';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionRequestService } from './execution-request.service';
import { ExecutionService } from './execution.service';
import { ValidationService } from './validation.service';
import { TopologyService } from './topology.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { PricingResolverService } from './pricing-resolver.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { GenerationIntentService } from './generation-intent.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { ArtifactCommitService } from '../artifact-core/artifact-commit.service';
import { UpstreamMediaService } from './upstream-media.service';
import { ApiCallerService } from './api-caller.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const PID = `int-t21c1-${Date.now()}`;
const UID = `int-t21c1-owner-${Date.now()}`;
const REQ = (s: string) => `c1x-${s}`;   // ≥8 字符（requestId 长度界 8-128）

const validation = new ValidationService(prisma as unknown as PrismaService, new PricingResolverService(prisma as unknown as PrismaService));
const execRequests = new ExecutionRequestService(
  prisma as unknown as PrismaService, validation, new TopologyService(), teamCredit,
  null as never, new CanvasDocUpdateRepository(prisma as unknown as PrismaService),
);
const nodeArtifacts = new NodeArtifactService();
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, nodeArtifacts);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 0x42)]);
const fakeMinio = { upload: vi.fn(async () => undefined) };
const fakeFetch = { fetchBuffer: vi.fn(async () => ({ buffer: PNG, contentType: 'image/png' })) };
const registration = new MediaRegistrationService(prisma as unknown as PrismaService, fakeMinio as never);
const artifactCommit = new ArtifactCommitService(
  prisma as unknown as PrismaService, ledger, teamCredit, intentSvc, fakeMinio as never, fakeFetch as never, nodeArtifacts, registration,
);
// fake apiCaller（callTextGen 可控成功/失败——外呼面注入；资金/事务/finalize 面全真）
const fakeApiCaller = { callTextGen: vi.fn(), callImageGen: vi.fn(), callVideoGen: vi.fn() };
const fakeCollabDoc = { isLeaseServing: () => true, readCanvas: vi.fn(), writeExecStatus: vi.fn(async () => {}) };
const fakeEmit = { emitNodeStatus: vi.fn() };
const perm = new ProjectPermissionService(prisma as unknown as PrismaService);
const upstreamMedia = new UpstreamMediaService(prisma as unknown as PrismaService, fakeMinio as never);
const execService = new ExecutionService(
  prisma as unknown as PrismaService, new TopologyService(), validation, fakeApiCaller as never, teamCredit,
  perm, fakeCollabDoc as never, fakeEmit as never, intentSvc, upstreamMedia, artifactCommit, execRequests,
);

let TID = '';
let freeRuleResId = '';   // 免费态用例建的全局 0 成本规则维度（afterAll 删）
let ND: Record<string, unknown> = {};
let serverDoc: Y.Doc = new Y.Doc();

const fillBaseline = (doc: Y.Doc, extra: StoredNode[] = []) => {
  fillDoc(toDocLike(doc), [
    { id: 'n1', type: 'textInput', data: { ...ND, prompt: { text: 'c1-prompt-n1' } } },
    { id: 'n2', type: 'textInput', data: { ...ND, prompt: { text: 'c1-prompt-n2' } } },
    ...extra,
  ], [{ id: 'e1', source: 'n1', target: 'n2' }]);
};
type StoredNode = { id: string; type: string; data: Record<string, unknown> };

/** 唯一化节点 prompt（追加变更帧）——解耦跨请求 idemKey（同内容 claim=SUCCEEDED 重放不烧
 *  mock 序列/不进 finalize；每执行型用例先唯一化再受理）。 */
async function uniquePrompt(nodeId: string, tag: string) {
  const node = serverDoc.getMap('nodes').get(nodeId) as Y.Map<unknown>;
  const data = node.get('data') as Y.Map<unknown>;
  const prompt = data.get('prompt') as Y.Map<unknown>;
  (prompt.get('text') as Y.Text).insert(0, `[${tag}] `);
  const upd = Buffer.from(Y.encodeStateAsUpdate(serverDoc));
  const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true } });
  const seq = (head?.pgSeq ?? 0n) + 1n;
  await prisma.canvasDocUpdate.create({ data: { projectId: PID, generation: 0, seq, firstWalSeq: seq, frameCount: 1, updateHash: randomUUID().replace(/-/g, ''), update: upd } });
  await prisma.canvasDoc.update({ where: { projectId: PID }, data: { pgSeq: seq, walCheckpointSeq: seq } });
}

const admit = (s: string, nodeIds: string[], docSeq = 0n) =>
  execRequests.admit({ projectId: PID, requestId: REQ(s), nodeIds, docSeq, userId: UID });
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

async function balanceCredits(): Promise<number> {
  const b = await prisma.teamBalance.findUnique({ where: { teamId: TID } });
  return b?.credits ?? 0;
}

(hasDb ? describe : describe.skip)('Y1c T21 收口批 C1/I-2/I-3/I1/I2/I3/幂等域（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: UID }, create: { id: UID, name: UID, email: `${UID}@t.local`, emailVerified: false }, update: {} });
    const team = await prisma.team.create({ data: { name: `c1-team-${Date.now()}`, ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER', monthlyQuota: 10 } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, { teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular', balanceDelta: 500, frozenDelta: 0, referenceId: `c1-fund-${Date.now()}` }));
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, model: { active: true, apiModelName: { not: null } }, creditCost: { gt: 0 } }, orderBy: { creditCost: 'asc' } });
    if (!rule) throw new Error('真库无 active 付费规则');
    ND = { model: rule.modelId, ...(rule.resolutionId ? { resolution: rule.resolutionId } : {}), ...(rule.durationId ? { duration: rule.durationId } : {}) };
    await prisma.canvasProject.create({ data: { id: PID, name: PID, teamId: TID, userId: UID } });
    await prisma.projectMember.create({ data: { projectId: PID, userId: UID, role: 'PROJECT_OWNER' } });
    fillBaseline(serverDoc);
    const state = Buffer.from(Y.encodeStateAsUpdate(serverDoc));
    await prisma.canvasDocSnapshot.create({ data: { projectId: PID, generation: 0, snapshotRev: 0n, stateSeq: 0n, state, stateHash: '0'.repeat(64), vacuumEpoch: 0, schemaVersion: CANVAS_DOC_SCHEMA_VERSION } });
    await prisma.canvasDoc.create({ data: { projectId: PID, generation: 0, pgSeq: 0n, walCheckpointSeq: 0n, currentSnapshotRev: 0n } });
  });

  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { projectId: PID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.nodeExecution.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await prisma.projectMember.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    if (freeRuleResId) {
      await prisma.pricingRule.deleteMany({ where: { resolutionId: freeRuleResId } });
      await prisma.modelResolution.deleteMany({ where: { id: freeRuleResId } });
    }
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    serverDoc.destroy();
    await prisma.$disconnect();
  });

  it('C1-付费态：冻结执行付费节点——finalize 内 per-item 结算（settlement mode execreq）零 FundsInvariantError 回滚', async () => {
    const a = await admit('paid', ['n1']);
    expect(a.ok, j(a)).toBe(true);
    if (!a.ok) return;
    fakeApiCaller.callTextGen.mockResolvedValueOnce({ content: 'paid-ok-result' });
    const r = await execService.execute(PID, undefined, UID, undefined, undefined, undefined, undefined, undefined, REQ('paid'));
    // 红（收口前）：F1 硬门——settleInTx settled:false+凭据不成立 → FundsInvariantError → catch → errors 非空
    expect(r.errors).toEqual([]);
    expect(r.success).toBe(true);
    // 资金核销唯一走 per-item：plan 行 SETTLED+ledger settle 行（reversesId=reserve 行）
    const plan = await prisma.executionNodePlan.findUnique({ where: { requestId_nodeId: { requestId: a.id, nodeId: 'n1' } } });
    expect(plan?.status).toBe('SETTLED');
    expect(plan?.reservedCredit).toBe(0);
    const settles = await prisma.teamCreditTransaction.findMany({ where: { teamId: TID, referenceId: `execreq:${a.id}#n1`, type: 'settle' } });
    expect(settles.length).toBeGreaterThan(0);
    expect(settles.every((s) => s.reversesId !== null)).toBe(true);   // reversesId 配对 exact reserve 行
    const row = await prisma.executionRequest.findUnique({ where: { id: a.id } });
    expect(row?.state).toBe('COMPLETED');
    // intent 侧零冻结（禁镜像预留——双账本禁令）
    const intent = await prisma.generationIntent.findFirst({ where: { projectId: PID, nodeId: 'n1' }, orderBy: { createdAt: 'desc' } });
    expect(intent?.reservedCredits).toBe(0);
    expect(intent?.executionRequestId).toBe(a.id);   // I-2：claim 回写 requestId 关联
  });

  it('C1-免费态：creditCost=0 模型节点——settled:false 合法（零额档）+计划 COMPLETED 零台账动作', async () => {
    // 0 成本规则：付费模型的全新维度组合（自然键不撞）——resolveExact 精确键可解析
    const paidRule = (await prisma.pricingRule.findFirst({ where: { active: true, creditCost: { gt: 0 }, modelId: { not: null }, model: { active: true, apiModelName: { not: null } } }, orderBy: { creditCost: 'asc' } }))!;
    const m = await prisma.aIModel.findUniqueOrThrow({ where: { id: paidRule.modelId! }, select: { id: true, nodeTypeId: true } });
    const res = await prisma.modelResolution.create({ data: { modelId: m.id, label: `c1-free-${Date.now()}`, width: 64, height: 64 } });
    await prisma.pricingRule.create({ data: { nodeTypeId: m.nodeTypeId, modelId: m.id, resolutionId: res.id, durationId: null, creditCost: 0, active: true } });
    freeRuleResId = res.id;   // 全局种子里具名清理（共享 dev 库——零残留纪律）
    fillDoc(toDocLike(serverDoc), [{ id: 'n-free', type: 'textInput', data: { model: m.id, resolution: res.id, prompt: { text: 'free-node' } } }], []);
    const upd = Buffer.from(Y.encodeStateAsUpdate(serverDoc));
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true } });
    const seq = (head?.pgSeq ?? 0n) + 1n;
    await prisma.canvasDocUpdate.create({ data: { projectId: PID, generation: 0, seq, firstWalSeq: seq, frameCount: 1, updateHash: randomUUID().replace(/-/g, ''), update: upd } });
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { pgSeq: seq, walCheckpointSeq: seq } });

    const bal = await balanceCredits();
    const a = await admit('free', ['n-free']);
    expect(a.ok, j(a)).toBe(true);
    if (!a.ok) return;
    expect(a.reservedCredit).toBe(0);   // 零成本零预留
    fakeApiCaller.callTextGen.mockResolvedValueOnce({ content: 'free-ok' });
    const r = await execService.execute(PID, undefined, UID, undefined, undefined, undefined, undefined, undefined, REQ('free'));
    expect(r.errors, j(r.errors)).toEqual([]);   // 免费档不撞 F1 门（零额档 settled:false 合法）
    expect(r.totalCost).toBe(0);
    expect(await balanceCredits()).toBe(bal);   // 零台账动作
    const row = await prisma.executionRequest.findUnique({ where: { id: a.id } });
    expect(row?.state).toBe('COMPLETED');
  });

  it('C1-部分失败态：两节点第二失败——第一 per-item settle+第二 per-item void+请求 FAILED 资金不悬挂', async () => {
    const pre = await balanceCredits();
    await uniquePrompt('n1', 'partial');
    const a = await admit('partial', ['n1', 'n2']);
    expect(a.ok, j(a)).toBe(true);
    if (!a.ok) return;
    const cost = a.totalCredit;
    fakeApiCaller.callTextGen
      .mockResolvedValueOnce({ content: 'first-ok' })     // n1 成功
      .mockRejectedValueOnce(new Error('provider down')); // n2 失败
    const r = await execService.execute(PID, undefined, UID, undefined, undefined, undefined, undefined, undefined, REQ('partial'));
    expect(r.success).toBe(false);
    expect(r.errors.map((e) => e.nodeId)).toEqual(['n2']);   // 只有 n2 error（n1 committed）
    const plans = await prisma.executionNodePlan.findMany({ where: { requestId: a.id }, orderBy: { order: 'asc' } });
    expect(plans[0]?.status).toBe('SETTLED');
    expect(plans[1]?.status).toBe('VOIDED');
    expect(plans.every((p) => p.reservedCredit === 0)).toBe(true);   // 资金不悬挂（逐 item 收口）
    const row = await prisma.executionRequest.findUnique({ where: { id: a.id } });
    expect(row?.state).toBe('FAILED');
    // 净消耗=第一节点成本（settle）——第二已还原（pre=受理前基线：预留-4→settle 恒持有+void 还原 2）
    expect(pre - (await balanceCredits())).toBe(cost - (plans[1]?.creditCost ?? 0));
  });

  it('I2-settle 失败不吞：结算抛错→finalize 整体回滚+catch void per-item（资金不悬挂）', async () => {
    await uniquePrompt('n1', 'settlefail');
    const preAdmit = await balanceCredits();   // 回滚+void 语义=全额还原至受理前（非悬挂=冻结零残留）
    const a = await admit('settlefail', ['n1']);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    fakeApiCaller.callTextGen.mockResolvedValueOnce({ content: 'ok-but-settle-boom' });
    // 注入：per-item 结算首调抛错（Proxy 包装 teamCredit——真实资金面其余不动）
    // C1 后结算在 finalize 事务内（artifactCommit 持有的 teamCredit）——注入面随之迁移
    const ac = artifactCommit as unknown as { teamCredit: unknown };
    const orig = ac.teamCredit;
    let injected = false;
    ac.teamCredit = new Proxy(teamCredit, {
      get(t, k) {
        if (k === 'settleForExecutionRequestItem' && !injected) {
          return async () => { injected = true; throw new Error('ledger settle exploded'); };
        }
        return Reflect.get(t, k);
      },
    });
    try {
      const r = await execService.execute(PID, undefined, UID, undefined, undefined, undefined, undefined, undefined, REQ('settlefail'));
      expect(r.success).toBe(false);            // 红（收口前）：settle 被吞→success:true+资金悬挂
      const plan = await prisma.executionNodePlan.findUnique({ where: { requestId_nodeId: { requestId: a.id, nodeId: 'n1' } } });
      expect(plan?.reservedCredit).toBe(0);     // catch void per-item——预留还原
      expect(await balanceCredits()).toBe(preAdmit);   // 资金不悬挂（全额还原——冻结零残留）
    } finally {
      ac.teamCredit = orig;
    }
  });

  it('I1-交错(a)：过期 void 完成后迟到 execute→409 EXEC_REQUEST_VOIDED（拒执行零外呼）', async () => {
    const a = await admit('lateexec', ['n1']);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    await prisma.executionRequest.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    const swept = await execRequests.sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(1);
    fakeApiCaller.callTextGen.mockClear();
    await expect(execService.execute(PID, undefined, UID, undefined, undefined, undefined, undefined, undefined, REQ('lateexec')))
      .rejects.toThrow(/已过期作废|EXEC_REQUEST_VOIDED/);
    expect(fakeApiCaller.callTextGen).not.toHaveBeenCalled();   // 拒执行零外呼
  });

  it('I1-交错(b)：claim 抢先（ADMITTED→EXECUTING CAS）→sweeper void 让位不释放（0 行 return false）', async () => {
    const a = await admit('race', ['n1']);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const before = await balanceCredits();
    // claim 侧先 CAS：ADMITTED→EXECUTING（executeFrozenRequest 首步）
    await prisma.executionRequest.updateMany({ where: { id: a.id, state: 'ADMITTED' }, data: { state: 'EXECUTING' } });
    // sweeper 选中（拨过期）→void CAS 0 行让位——资金不动
    await prisma.executionRequest.update({ where: { id: a.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    const swept = await execRequests.sweepExpired();
    // 红（收口前）：void 无 CAS 抢占——EXECUTING 行照 void（释放执行中资金）
    const row = await prisma.executionRequest.findUnique({ where: { id: a.id } });
    expect(row?.state).toBe('EXECUTING');               // 让位（终态不变）
    expect(row?.reservedCredit).toBe(a.reservedCredit); // 资金不动
    expect(await balanceCredits()).toBe(before);   // before=受理后（预留已扣）——让位语义=资金纹丝不动
    expect(swept).toBe(0);
    // 清理：让位行手工回落 ADMITTED→sweep 释放（后续配额用例的月度占用归零）
    await prisma.executionRequest.updateMany({ where: { id: a.id }, data: { state: 'ADMITTED', expiresAt: new Date(Date.now() - 1) } });
    await execRequests.sweepExpired();
  });

  it('I-3 配额：execreq 在飞预留计入月度——超 monthlyQuota 受理 4xx（QUOTA_EXCEEDED）', async () => {
    // 确定性装置：quota 动态设为「used+在飞 a1 占用」恰等值——a1 过/续授必拒（与执行序无关）
    const a1 = await admit('quota-hold', ['n2']);
    expect(a1.ok, j(a1)).toBe(true);
    if (!a1.ok) return;
    const usedAgg = await prisma.$queryRaw<Array<{ s: number }>>`
      SELECT COALESCE(SUM(-t.amount), 0)::int AS s FROM "TeamCreditTransaction" t
      WHERE t."teamId" = ${TID}::text AND t."operatorUserId" = ${UID}::text AND t.type = 'settle'
        AND NOT EXISTS (SELECT 1 FROM "TeamCreditTransaction" x WHERE x."reversesId" = t."id" AND x.type = 'refund')`;
    const used = usedAgg[0]?.s ?? 0;
    const inflight = await prisma.executionRequest.aggregate({ _sum: { reservedCredit: true }, where: { teamId: TID, userId: UID, reservedCredit: { gt: 0 }, state: { in: ['ADMITTED', 'EXECUTING'] } } });
    const inflightSum = inflight._sum.reservedCredit ?? 0;
    await prisma.teamMember.update({
      where: { teamId_userId: { teamId: TID, userId: UID } },
      data: { monthlyQuota: used + inflightSum },   // 恰好卡在 a1 占满——任何新预留即超
    });
    try {
      const over = await admit('quota-over', ['n2']);
      expect(over.ok).toBe(false);
      if (!over.ok) {
        expect(over.status).toBe(429);
        expect(over.code).toBe('QUOTA_EXCEEDED');
      }
    } finally {
      // 清理：还原配额+a1 拨过期 sweep（月度占用/余额归位——后续用例零残留）
      await prisma.teamMember.update({ where: { teamId_userId: { teamId: TID, userId: UID } }, data: { monthlyQuota: 10_000 } });
      await prisma.executionRequest.updateMany({ where: { projectId: PID, state: 'ADMITTED' }, data: { expiresAt: new Date(Date.now() - 1) } });
      await execRequests.sweepExpired();
    }
  });

  it('I3+M2/M-5 幂等身份域：同键异序 nodeIds→409 IDEMPOTENCY_CONFLICT；P2002 复读→replay 幂等+detail 固定不泄漏', async () => {
    const a = await admit('idem', ['n1', 'n2']);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    // 同键异序（有序比对=order 敏感——与 planHash 决定域一致）
    const reordered = await admit('idem', ['n2', 'n1']);
    expect(reordered.ok).toBe(false);
    if (!reordered.ok) {
      expect(reordered.status).toBe(409);
      expect(reordered.code).toBe('IDEMPOTENCY_CONFLICT');
    }
    // 同键同序同 docSeq→replay
    const replay = await admit('idem', ['n1', 'n2']);
    expect(replay.ok && replay.replayed).toBe(true);
    // P2002：插入竞窗（existing 检查后 create 撞唯一）→复读 replay 幂等+固定 detail
    const proxied = new Proxy(execRequests as unknown as Record<string, unknown>, {
      get(t, k) {
        if (k === 'prisma') {
          const real = Reflect.get(t, k) as Record<string, unknown>;
          return new Proxy(real, {
            get(p2, k2) {
              if (k2 === 'executionRequest') {
                const er = Reflect.get(p2, k2) as Record<string, unknown>;
                return new Proxy(er, {
                  get(e2, k3) {
                    if (k3 === 'create') {
                      return async (args: unknown) => {
                        throw Object.assign(new Error('Unique constraint failed on the fields: (`projectId`,`requestId`) SECRET-DETAILS'), { code: 'P2002' });
                      };
                    }
                    return Reflect.get(e2, k3);
                  },
                });
              }
              return Reflect.get(p2, k2);
            },
          });
        }
        return Reflect.get(t, k);
      },
    });
    const svc2 = proxied as unknown as ExecutionRequestService;
    const r = await svc2.admit({ projectId: PID, requestId: REQ('idem'), nodeIds: ['n1', 'n2'], docSeq: 0n, userId: UID });
    expect(r.ok).toBe(true);              // 红（收口前）：500 ADMISSION_FAILED
    if (r.ok) expect(r.replayed).toBe(true);
    if (!r.ok) expect(r.detail).not.toContain('SECRET-DETAILS');   // detail 固定禁泄漏 (err).message
  });

  it('I3-requestId 界：requestId 超长/过短→400（长度界守卫）', async () => {
    const tooLong = await execRequests.admit({ projectId: PID, requestId: 'x'.repeat(200), nodeIds: ['n1'], docSeq: 0n, userId: UID });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.status).toBe(400);
    const tooShort = await execRequests.admit({ projectId: PID, requestId: 'ab', nodeIds: ['n1'], docSeq: 0n, userId: UID });
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.status).toBe(400);
  });

  it('M-4 非 executable plan 行置 SKIPPED：含非执行节点的请求 remaining 收口可达终态', async () => {
    // 非 executable 类型=group（EXECUTABLE_TYPES 外）——slice 含它但零执行分支
    fillDoc(toDocLike(serverDoc), [{ id: 'n-group', type: 'group', data: {} }], []);
    const upd = Buffer.from(Y.encodeStateAsUpdate(serverDoc));
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true } });
    const seq = (head?.pgSeq ?? 0n) + 1n;
    await prisma.canvasDocUpdate.create({ data: { projectId: PID, generation: 0, seq, firstWalSeq: seq, frameCount: 1, updateHash: randomUUID().replace(/-/g, ''), update: upd } });
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { pgSeq: seq, walCheckpointSeq: seq } });
    await uniquePrompt('n1', 'skiprow');
    const a = await admit('skiprow', ['n1', 'n-group']);
    expect(a.ok, j(a)).toBe(true);
    if (!a.ok) return;
    fakeApiCaller.callTextGen.mockResolvedValueOnce({ content: 'skip-ok' });
    const r = await execService.execute(PID, undefined, UID, undefined, undefined, undefined, undefined, undefined, REQ('skiprow'));
    expect(r.errors).toEqual([]);
    const row = await prisma.executionRequest.findUnique({ where: { id: a.id } });
    // 红（收口前）：n-group 行恒 PENDING→remaining>0→卡 EXECUTING 不达终态
    expect(row?.state).toBe('COMPLETED');
    const groupPlan = await prisma.executionNodePlan.findUnique({ where: { requestId_nodeId: { requestId: a.id, nodeId: 'n-group' } } });
    expect(groupPlan?.status).toBe('SKIPPED');
  });

  it('M-3 上游 dedup：共享上游文本 sha256 单份存（sharedTexts）+引用——N 节点共享不虚涨 raw', async () => {
    const big = '共享上游长文本-'.repeat(200);   // ~1.6KB
    fillDoc(toDocLike(serverDoc), [
      { id: 'up', type: 'textInput', data: { ...ND, prompt: { text: 'x' } } },
    ], []);
    // 直接灌上游正文到 up.data.content（Y.Text 域——textInput content=XmlFragment 域：用 prompt 通道替代验证 dedup 语义）
    const upNode = serverDoc.getMap('nodes').get('up') as Y.Map<unknown>;
    (upNode.get('data') as Y.Map<unknown>).set('prompt', { text: big });
    const upd = Buffer.from(Y.encodeStateAsUpdate(serverDoc));
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true } });
    const seq = (head?.pgSeq ?? 0n) + 1n;
    await prisma.canvasDocUpdate.create({ data: { projectId: PID, generation: 0, seq, firstWalSeq: seq, frameCount: 1, updateHash: randomUUID().replace(/-/g, ''), update: upd } });
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { pgSeq: seq, walCheckpointSeq: seq } });
    const a = await admit('dedup', ['n1', 'n2']);
    expect(a.ok, j(a)).toBe(true);
    if (!a.ok) return;
    const inputRow = await prisma.executionInput.findUnique({ where: { requestId: a.id } });
    const rawStr = require('node:zlib').brotliDecompressSync(Buffer.from(inputRow!.content)).toString('utf8');
    // 红（收口前）：每节点 upstreamTexts/promptText 全量重复存——正文出现多次
    const occurrences = rawStr.split(big).length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);   // 共享文本单份（sha256 引用形态）
    // worker 读面不破：loadForExecution 解引用后 promptText 可用
    const loaded = await execRequests.loadForExecution(PID, REQ('dedup'));
    expect(loaded?.input.nodes['n1']).toBeDefined();
    expect(typeof loaded?.input.nodes['n1']?.promptText).toBe('string');
  });

  it('I4：upsertNodeExecutionGuarded 真库——SQL 谓词≡nodeExecutionUpdateAllowed 真值表（旧代拒/同 execSeq 拒/单调过）', async () => {
    // 造基线行：generation=0, execSeq=100
    await prisma.nodeExecution.upsert({
      where: { projectId_nodeId: { projectId: PID, nodeId: 'i4-node' } },
      create: { projectId: PID, nodeId: 'i4-node', generation: 0, execSeq: 100n, nodeVersion: 0n, status: 'RUNNING' },
      update: { generation: 0, execSeq: 100n },
    });
    const svc = execService as unknown as { upsertNodeExecutionGuarded: (i: { projectId: string; nodeId: string; generation: number; execSeq: bigint; status: string }) => Promise<boolean> };
    // 单调过：101 代同
    expect(await svc.upsertNodeExecutionGuarded({ projectId: PID, nodeId: 'i4-node', generation: 0, execSeq: 101n, status: 'RUNNING' })).toBe(true);
    // 同 execSeq 拒
    expect(await svc.upsertNodeExecutionGuarded({ projectId: PID, nodeId: 'i4-node', generation: 0, execSeq: 101n, status: 'RUNNING' })).toBe(false);
    // 回退拒
    expect(await svc.upsertNodeExecutionGuarded({ projectId: PID, nodeId: 'i4-node', generation: 0, execSeq: 90n, status: 'RUNNING' })).toBe(false);
    // 换代拒（generation 不匹配——旧代票全拒）
    expect(await svc.upsertNodeExecutionGuarded({ projectId: PID, nodeId: 'i4-node', generation: 1, execSeq: 200n, status: 'RUNNING' })).toBe(false);
    // 纯函数真值表一致性（shared 单源——SQL 谓词与其等价断言）
    const { nodeExecutionUpdateAllowed } = await import('@flowweb/shared');
    for (const [cur, inc, want] of [
      [{ generation: 0, execSeq: 101n }, { generation: 0, execSeq: 102n }, true],
      [{ generation: 0, execSeq: 102n }, { generation: 0, execSeq: 102n }, false],
      [{ generation: 0, execSeq: 102n }, { generation: 0, execSeq: 101n }, false],
      [{ generation: 0, execSeq: 102n }, { generation: 1, execSeq: 300n }, false],
    ] as const) {
      expect(nodeExecutionUpdateAllowed(cur as never, inc as never), `${j(inc)} vs ${j(cur)}`).toBe(want);
    }
    const row = await prisma.nodeExecution.findUnique({ where: { projectId_nodeId: { projectId: PID, nodeId: 'i4-node' } } });
    expect(row?.execSeq).toBe(101n);   // 只有首次单调过写成功
  });
});
