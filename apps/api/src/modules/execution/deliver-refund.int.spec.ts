// apps/api/src/modules/execution/deliver-refund.int.spec.ts —— Y0b-2 T5 红用例主件（真库）
// rollback 三入口（Z92/Z102）+交付退款单事务（Z64/Z75）+settleStranded 三分支收窄（Z76/Z98/Z102）
// +第三不变量（Z102）+A-1 lighting 双 reserve 白扣费根修（T4 审计确认资金缺陷）。
// 纪律：reconcile 的 collab 面按 deadline-reaper 形态 stub（探针/投影可编程——Z98/Z106/Z112）；
// 台账/意图行全真链（TeamCreditService/GenerationIntentService 直构真 prisma）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from './generation-intent.service';
import { IntentReconcileService, SETTLE_STRANDED_GRACE_MS } from './intent-reconcile.service';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { PricingResolverService } from './pricing-resolver.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { balanceDriftTotal } from './intent-reconcile.metrics';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// A-1 装置：axios mock（processor/consumer 产物下载面——vi.mock 提升覆盖两处 import）
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import { AiImageEditProcessor } from '../ai-image-edit/ai-image-edit.processor';
import { LightingConsumer } from '../ai-image-edit/lighting/lighting.consumer';
import { normalizeIntentParams } from './normalize-intent-params';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService);

/** reconcile 装置：collabDoc stub 可编程（probeArtifacts/isDocResident/writeExecStatus 记录器）。 */
const makeReconcile = (collabDoc: any) => new IntentReconcileService(
  prisma as unknown as any, collabDoc, ledger,
  { getJob: async () => null } as any, { getJob: async () => null } as any,
  {} as any, teamCredit,
);

/** 无标签 Counter 总值 helper（prom-client 15 的 hashMap 扫描——deadline-reaper 同款纪律）。 */
const totalOf = (m: any): number => Object.values(m.hashMap ?? {}).reduce((s: number, v: any) => s + (v.value ?? 0), 0);

const PID = `int-dr2-${Date.now()}`;
const UID = `int-dr2-owner-${Date.now()}`;
let TID = '';
let PRICING: { pricingRuleId: string; modelId: string | null; resolutionId: string | null; durationId: string | null; creditCost: number };

/** claim 真链——nodeId/paramsHash/gestureToken 逐用例唯一（防 partial unique/idemKey 跨用例冲突）。 */
const claimIntent = async (over: Record<string, unknown> = {}) =>
  intentSvc.claim({
    projectId: PID,
    nodeId: `n-${randomUUID().slice(0, 8)}`,
    userId: UID,
    gestureToken: `dr2-${randomUUID().slice(0, 8)}`,
    kind: 'image',
    paramsHash: `h-${randomUUID().slice(0, 8)}`,
    teamId: TID,
    pricing: PRICING,
    ...over,
  });

const rowOf = async (id: string) => prisma.generationIntent.findUnique({ where: { id } });
const status = async (id: string) => (await rowOf(id))!.status;
const ledgerRows = async (intentRowId: string, type: string) =>
  prisma.teamCreditTransaction.findMany({ where: { teamId: TID, referenceId: `intent:${intentRowId}`, type: type as any } });
/** 判龄造行：completedAt 推过 SETTLE_STRANDED_GRACE_MS（Z102 判龄是真值——不 fake 时钟）。 */
const agePastGrace = async (id: string) =>
  prisma.generationIntent.update({ where: { id }, data: { completedAt: new Date(Date.now() - SETTLE_STRANDED_GRACE_MS - 60_000) } });

(hasDb ? describe : describe.skip)('Y0b-2 T5：交付退款单事务+rollback 三入口（Z64/Z75/Z92/Z102，真库）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-dr2-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-dr2-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-dr2-fund-${Date.now()}`,
    }));
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-dr2', userId: UID, teamId: TID } }); // 交付退款/A-1 段共用真项目行
  }, 20_000);

  afterAll(async () => {
    await prisma.lightingTask.deleteMany({ where: { teamId: TID } });
    await prisma.media.deleteMany({ where: { teamId: TID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('Z92 竞态封死：complete→settle 之后 rollbackRunning → CAS=0；行仍 SUCCEEDED、无 refund 行（改前红：无三入口）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    expect(await intentSvc.complete(intent.id, 'http://r/1.png')).toBe(1); // complete 先行（SUCCEEDED）
    expect((await teamCredit.settle({ intentRowId: intent.id })).success).toBe(true); // 已核销（真实链序 complete→settle）
    const rolled = await teamCredit.rollbackRunning(intent.id, '迟归 reaper', new Date(Date.now() + 60_000));
    expect(rolled).toBe(false); // CAS 严格 RUNNING——SUCCEEDED 行拒收（Z92：退款后仍交付结构性关闭）
    expect(await status(intent.id)).toBe('SUCCEEDED');
    await expect(ledgerRows(intent.id, 'refund')).resolves.toHaveLength(0);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1); // 已核销保持
  });

  it('rollbackRunning（RUNNING 行）：VOIDED+两金额归零+按流水分义冲销（settle→refund / reserve→release）+两池各自拆分冲销', async () => {
    // 两池拆分（原 unit ⑦ 的真库化——doRollback 按流水行 creditType 逐行冲销）：订阅池灌 c-1、常规池灌足
    const c = PRICING.creditCost;
    if (c > 1) {
      await ledger.runInTx((tx) => ledger.mutate(tx, {
        teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'subscription',
        balanceDelta: c - 1, frozenDelta: 0, referenceId: `it-dr2-sub-${Date.now()}`,
      }));
    }
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await teamCredit.settle({ intentRowId: intent.id }); // 已扣（settle 腿——refund 冲销）
    const rolled = await teamCredit.rollbackRunning(intent.id, 'reaper 收敛', new Date(Date.now() + 60_000));
    expect(rolled).toBe(true);
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('VOIDED');
    expect(row!.reservedCredits).toBe(0);
    expect(row!.creditsConsumed).toBe(0); // 两金额归零——重试照常扣费
    const refunds = await ledgerRows(intent.id, 'refund');
    if (c > 1) {
      expect(refunds).toHaveLength(2); // 订阅 c-1 + 常规 1——各按原流水行数额（禁拿 creditsConsumed 单值猜）
      expect(refunds.filter((r: any) => r.creditType === 'subscription').reduce((s: number, r: any) => s + r.amount, 0)).toBe(c - 1);
      expect(refunds.filter((r: any) => r.creditType === 'regular').reduce((s: number, r: any) => s + r.amount, 0)).toBe(1);
    } else {
      expect(refunds).toHaveLength(1);
    }
  });

  it('reaper×settle 交错：reaper 先手 VOIDED → 迟归 complete CAS=0（不变量：VOIDED 吸收）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    expect(await teamCredit.rollbackRunning(intent.id, '先手 reaper', new Date(Date.now() + 60_000))).toBe(true);
    expect(await intentSvc.complete(intent.id, 'http://late.png')).toBe(0); // 迟归 complete 零命中
    expect(await status(intent.id)).toBe('VOIDED');
  });

  it('原子性：注入 refund 抛错 → 整体回滚行仍 RUNNING（方向安全交 reaper 重扫）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await teamCredit.settle({ intentRowId: intent.id });
    const orig = ledger.mutate.bind(ledger);
    const spy = vi.spyOn(ledger, 'mutate').mockImplementation(async (tx: any, input: any) => {
      if (input?.type === 'refund') throw new Error('refund inject boom');
      return orig(tx, input);
    });
    try {
      await expect(teamCredit.rollbackRunning(intent.id, 'x', new Date(Date.now() + 60_000)))
        .rejects.toThrow('refund inject boom');
    } finally {
      spy.mockRestore();
    }
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('RUNNING'); // 单事务原子回滚——半程状态不落库
    expect(row!.creditsConsumed).toBeGreaterThan(0); // 金额未动
    await expect(ledgerRows(intent.id, 'refund')).resolves.toHaveLength(0);
  });

  it('Z76 套利防回归：SUCCEEDED∧consumed>0∧reservedCredits=0 超窗 → settleStranded 不退款', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await intentSvc.complete(intent.id, 'http://ok/1.png');
    await teamCredit.settle({ intentRowId: intent.id }); // 正常链终点：SUCCEEDED∧consumed>0∧reserved=0
    await agePastGrace(intent.id);
    await makeReconcile({ probeArtifacts: async () => [] }).verifyActive();
    expect(await status(intent.id)).toBe('SUCCEEDED'); // 历史成功单永不进回滚腿
    await expect(ledgerRows(intent.id, 'refund')).resolves.toHaveLength(0);
  });

  it('Z76/Z102 真悬留：SUCCEEDED∧reservedCredits>0∧超窗∧doc 无产物 → rollbackStranded ⇒ VOIDED+两金额归零+release 行（改前红=恒补 settle 白扣）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await intentSvc.complete(intent.id, 'http://crash.png'); // settle 失败崩溃窗——SUCCEEDED∧冻结在
    await agePastGrace(intent.id);
    const probeArtifacts = vi.fn(async () => [{ nodeId: intent.nodeId, kind: intent.kind, found: false }]);
    await makeReconcile({ probeArtifacts }).verifyActive();
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('VOIDED'); // 无产物=未交付——退款非补 settle
    expect(row!.reservedCredits).toBe(0);
    expect(row!.creditsConsumed).toBe(0);
    await expect(ledgerRows(intent.id, 'release')).resolves.toHaveLength(1); // reserve 冻结释放
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(0); // 白扣堵死（改前红：补 settle）
    expect(probeArtifacts).toHaveBeenCalled();
  });

  it('Z102 三分支表驱动①：SUCCEEDED∧有产物 ⇒ 补 settle 非 refund', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await intentSvc.complete(intent.id, 'http://ok/2.png');
    await agePastGrace(intent.id);
    await makeReconcile({
      probeArtifacts: async () => [{ nodeId: intent.nodeId, kind: intent.kind, found: true }],
    }).verifyActive();
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('SUCCEEDED'); // 产物已交付——账补齐非退款
    expect(row!.reservedCredits).toBe(0);
    expect(row!.creditsConsumed).toBe(PRICING.creditCost);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);
    await expect(ledgerRows(intent.id, 'refund')).resolves.toHaveLength(0);
  });

  it('Z102 三分支表驱动②：FAILED 行只 void_（不进 settle 腿）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await intentSvc.fail(intent.id, 'crash before settle');
    await agePastGrace(intent.id);
    await makeReconcile({ probeArtifacts: async () => { throw new Error('不应探测 FAILED 行'); } }).verifyActive();
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('FAILED'); // void_ 只清冻结不改状态
    expect(row!.reservedCredits).toBe(0);
    await expect(ledgerRows(intent.id, 'release')).resolves.toHaveLength(1);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(0);
  });

  it('探针失败=不知道≠无产物：SUCCEEDED∧reserved>0∧超窗∧probe 503 → 本轮跳过（不退款不补 settle）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await intentSvc.complete(intent.id, 'http://unknown.png');
    await agePastGrace(intent.id);
    await makeReconcile({
      probeArtifacts: async () => { throw new Error('503 collab not serving'); },
    }).verifyActive();
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('SUCCEEDED'); // 不裁决——次轮重试
    expect(row!.reservedCredits).toBeGreaterThan(0);
  });

  it('第三不变量：人工 VOIDED∧creditsConsumed>0 无 refund 行 → drift 计数（Z102）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id });
    await intentSvc.complete(intent.id, 'http://ok/3.png');
    await teamCredit.settle({ intentRowId: intent.id });
    await prisma.generationIntent.update({ where: { id: intent.id }, data: { status: 'VOIDED' } }); // 人工漂移（无 refund 行）
    const before = totalOf(balanceDriftTotal);
    await (makeReconcile({}) as any).verifyLedgerInvariants();
    expect(totalOf(balanceDriftTotal)).toBeGreaterThan(before); // VOIDED∧consumed>0∧无 refund=台账漂移
  });

  // ── 交付退款（written:false → rollbackDeliveryFailed——Z64/Z92）+A-1 lighting 双 reserve ──
  // 嵌套 describe 共享外层脚手架（单一 beforeAll/afterAll——外层 cleanup 后内层重建必炸 FK）。
  // ExecutionService 真链装置（funds-four-way 形态）：真 prisma/validation/teamCredit/perm/intentService；
  // stub 仅 collabDoc（writeNodeData 可编程 written:false——交付判据）/gateway/downloadQueue/apiCaller。
  describe('交付退款+A-1 lighting', () => {
    const resolver = new PricingResolverService(prisma as unknown as PrismaService);
    const validation = new ValidationService(prisma as unknown as PrismaService, resolver);
    const perm = new ProjectPermissionService(prisma as unknown as PrismaService);
    const PROJECT_ID = PID;

    const makeExecSvc = (collabDoc: any) => {
      const apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
      vi.spyOn(apiCaller, 'callImageGen').mockResolvedValue({ url: 'http://x/deliver.png' } as any);
      return new ExecutionService(
        prisma as unknown as PrismaService,
        new TopologyService(),
        validation,
        apiCaller,
        teamCredit,
        perm,
        collabDoc as any,
        { emitNodeStatus: vi.fn() } as any,
        { add: vi.fn() } as any,
        intentSvc,
      );
    };

    /** 夹具节点（funds-four-way 同款——真 seed 规则键） */
    const imageNode = (id: string) => ({ id, type: 'imageGen', data: { model: 'seed-model-hy-image', resolution: 'seed-res-hy-1024' } });

  it('交付失败退款：外呼期间节点被删（writeNodeData {written:false}）→ rollbackDeliveryFailed ⇒ VOIDED+两金额归零+refund 行（改前红=行停留 SUCCEEDED 无退款）', async () => {
    const node = imageNode(`n-del-${randomUUID().slice(0, 6)}`);
    const nodes = [node];
    const collabDoc = {
      readCanvas: async () => ({ nodes, edges: [] }),
      isLeaseServing: () => true,
      writeNodeData: vi.fn(async () => ({ written: false, reason: 'node-deleted' as const })),
      writeExecStatus: vi.fn(async () => {}),
    };
    const svc = makeExecSvc(collabDoc);
    const r = await svc.execute(PROJECT_ID, undefined, UID, nodes.map((n) => n.id), undefined, `dr2-del-${randomUUID().slice(0, 6)}`);
    expect(r.success).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ nodeId: node.id, status: 'error' });
    const row = await prisma.generationIntent.findFirst({ where: { projectId: PROJECT_ID, nodeId: node.id } });
    expect(row!.status).toBe('VOIDED'); // 交付凭据 written:false → SUCCEEDED 也能退（交付路径唯一入口）
    expect(row!.reservedCredits).toBe(0);
    expect(row!.creditsConsumed).toBe(0);
    await expect(ledgerRows(row!.id, 'refund')).resolves.toHaveLength(1); // 已核销 settle 逆向冲销
    expect(collabDoc.writeNodeData).toHaveBeenCalled(); // 交付尝试确已发生
  }, 30_000);

  it('A-1 lighting 双 reserve 白扣费根修：团队任务全链（processor→consumer）⇒ 恰一次 reserve 流水+外呼发生+终态 SUCCEEDED 非 skipped（改前红=processor fileId 缺位即炸/二次 reserve 恒 skipped 零外呼）', async () => {
    // 真实规则解析 lighting 定价（kind 级 modelId IS NULL——Z5）
    const pricing = await resolver.resolveByNodeTypeKey('lighting');
    expect(pricing.creditCost).toBeGreaterThan(0); // 付费档前提（实查=1 credit）
    const projectId = PROJECT_ID;
    const nodeId = `n-light-${randomUUID().slice(0, 6)}`;
    // 源图 Media + LightingTask 真行（consumer 归属校验/业务状态面）
    const media = await prisma.media.create({
      data: {
        userId: UID, teamId: TID, key: `it-dr2-src-${Date.now()}`, originalName: 'src.png',
        mimeType: 'image/png', size: 8, projectId, nodeId, type: 'upload', status: 'completed',
      },
    });
    const task = await prisma.lightingTask.create({
      data: {
        userId: UID, teamId: TID, nodeId, projectId,
        originalImageUrl: media.id,
        params: { position: { x: 0, y: 0, z: 6 }, brightness: 50, colorTemperature: 5600, rimLight: false } as any,
        status: 'pending', costCredits: pricing.creditCost,
      },
    });
    const { intent } = await intentSvc.claim({
      projectId, nodeId, userId: UID, gestureToken: `dr2-l-${randomUUID().slice(0, 6)}`,
      kind: 'lighting', paramsHash: normalizeIntentParams('lighting', { prompt: '打光' }),
      pricing, teamId: TID,
    });
    // processor/consumer 直构：真 prisma/teamCredit/intentService；minio/apiCaller/collabDoc/gateway stub
    const minio: any = {
      generatePresignedGetUrl: async () => 'https://minio/signed',
      buildKey: () => 'generated/key',
      upload: async () => {},
    };
    const gateway: any = { emitNodeStatus: vi.fn() };
    const apiCaller: any = { callRelighting: vi.fn(async () => ({ url: 'https://ai/relit.png' })) };
    const collabDoc: any = { writeNodeData: vi.fn(async () => ({ written: true })), writeExecStatus: vi.fn(async () => {}) };
    const consumer = new LightingConsumer(
      prisma as unknown as PrismaService, minio, gateway, apiCaller,
      teamCredit, collabDoc, intentSvc,
    );
    const processor = new AiImageEditProcessor(
      prisma as unknown as PrismaService, minio, gateway, apiCaller,
      teamCredit, collabDoc, consumer, intentSvc,
    );
    (axios.get as any).mockResolvedValue({ data: Buffer.from('img'), headers: { 'content-type': 'image/png' } });
    // 队列入口 job（lighting.service.createTask 真实形态——无 fileId 键）
    const job = {
      id: `job-l-${Date.now()}`,
      data: {
        taskType: 'lighting' as const, userId: UID, nodeId, projectId,
        taskId: task.id, originalImageId: media.id,
        params: { position: { x: 0, y: 0, z: 6 }, brightness: 50, colorTemperature: 5600, rimLight: false },
        intentRowId: intent.id, intentId: intent.intentId,
      },
    };
    const result = await processor.process(job as any);
    expect(result.status).toBe('completed'); // 改前红：skipped（INTENT_DUPLICATE_ATTEMPT）或 processor 早炸
    expect(apiCaller.callRelighting).toHaveBeenCalledTimes(1); // 外呼确已发生（改前红=零外呼）
    await expect(ledgerRows(intent.id, 'reserve')).resolves.toHaveLength(1); // 恰一次 reserve 流水
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('SUCCEEDED');
    expect(row!.creditsConsumed).toBe(pricing.creditCost); // 真核销（非 reconcile 补 settle 白扣）
    expect(row!.reservedCredits).toBe(0);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);
    expect(collabDoc.writeNodeData).toHaveBeenCalledWith(projectId, nodeId, { fileId: expect.any(String) }); // 产物投递
  }, 30_000);
});
});
