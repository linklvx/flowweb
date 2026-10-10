// apps/api/src/modules/execution/funds-four-way.int.spec.ts —— Y0b-1（G-1/Z18/Z20）：四处相等
// ①定价同源：validation.totalCost ≡ Σ resolver(node)（含 text 腿+video duration 维）
// ②扣费自洽：Σ settle 流水 ≡ Σ intent.creditCost（首跑限定——重放分支 if(!created) continue 不计费）
// T7 收口：真实执行链混合组（text+image）+video 死亡线（实扣≡预检≡10）。api-caller stub 零真外呼。
import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationService } from './validation.service';
import { PricingResolverService } from './pricing-resolver.service';
import { resolvePricingKey } from './pricing-input.util';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ApiCallerService } from './api-caller.service';
import { GenerationIntentService } from './generation-intent.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

// G-1 真实执行链共享依赖（真 prisma/resolver/validation/teamCredit/perm/intentService——
// stub 仅 collabDoc/gateway/downloadQueue/apiCaller 外呼面：零真外呼+零真协作面）
const resolver = new PricingResolverService(prisma as unknown as PrismaService);
const validation = new ValidationService(prisma as unknown as PrismaService, resolver);
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const perm = new ProjectPermissionService(prisma as unknown as PrismaService);
const intentService = new GenerationIntentService(prisma as unknown as PrismaService);

// 夹具登记（afterAll 清理——id 全部后缀化防上轮失败残留自撞，ledger-invariants.int.spec 同纪律）
const g1 = { userIds: [] as string[], teamIds: [] as string[], projectIds: [] as string[] };

/** 真脚手架：Team(ACTIVE)+TeamMember(OWNER)+TeamBalance 100+CanvasProject。
 *  T5 教训：钱包唯一创建口=ensureBalance+register_grant（裸 create 破不变量①巡检——ΣbalanceDelta≢池余额）。 */
async function scaffoldG1Funds(): Promise<{ userId: string; teamId: string; projectId: string }> {
  const ts = `${Date.now()}-${g1.userIds.length + 1}`;
  const userId = `it-g1-u-${ts}`;
  const teamId = `it-g1-t-${ts}`;
  const projectId = `it-g1-p-${ts}`;
  await prisma.user.create({ data: { id: userId, name: 'it-g1', email: `${userId}@x.invalid`, emailVerified: false } });
  await prisma.team.create({ data: { id: teamId, name: 'it-g1', ownerId: userId, status: 'ACTIVE' } });
  await prisma.teamMember.create({ data: { teamId, userId, role: 'OWNER' } });
  await ledger.runInTx(async (ltx) => {
    await ledger.ensureBalance(ltx, teamId);
    await ledger.lockBalance(ltx, teamId);
    await ledger.mutate(ltx, {
      teamId, operatorUserId: userId, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `register:${teamId}`,
    });
  });
  await prisma.canvasProject.create({ data: { id: projectId, name: 'it-g1', userId, teamId } });
  g1.userIds.push(userId);
  g1.teamIds.push(teamId);
  g1.projectIds.push(projectId);
  return { userId, teamId, projectId };
}

/** resolver 聚合（与 validation 同键——经 resolvePricingKey 单源，①定价同源的右侧真值） */
async function resolverTotalOf(nodes: { id: string; type: string; data?: Record<string, unknown> }[]): Promise<number> {
  let total = 0;
  for (const n of nodes) {
    const key = await resolvePricingKey(prisma as unknown as PrismaService, n);
    const p = key.modelId
      ? await resolver.resolve({ modelId: key.modelId, resolutionId: key.resolutionId, durationId: key.durationId })
      : await resolver.resolveByNodeTypeKey(key.pricingKey!);
    total += p.creditCost;
  }
  return total;
}

(hasDb ? describe : describe.skip)('Y0b-1 G-1（拆两条断言）', () => {
  afterAll(async () => {
    // Y0b-2（触发器/Z116）：台账清理带证（ledgerWipe）+team 级联删带证——catch 掩码删（触发器报错被吞=假绿）
    for (const tid of g1.teamIds) await ledgerWipe(ledger, { teamId: tid });
    await prisma.generationIntent.deleteMany({ where: { projectId: { in: g1.projectIds } } });
    await prisma.canvasProject.deleteMany({ where: { id: { in: g1.projectIds } } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, g1.teamIds);
    await prisma.user.deleteMany({ where: { id: { in: g1.userIds } } });
    await prisma.$disconnect();
  });

  it('①定价同源：validation.totalCost 含 text 节点（红相=旧实现 continue 跳过恒少算——T2 已修，此处为守护）', async () => {
    const resolver = new PricingResolverService(prisma as unknown as PrismaService);
    const svc = new ValidationService(prisma as unknown as PrismaService, resolver);
    // 按库内真实规则行反推节点参数（规则形状固定断言会随 seed 漂移——text=null∧null / image 带分辨率行 id）
    // Y0b-2 裁定 5：三无外呼模型 active=false——规则查询限定 active 模型（resolver 门 model.active，规则行留档不可达）
    const textRule = await prisma.pricingRule.findFirst({
      where: { active: true, nodeType: { key: 'text' }, modelId: { not: null }, creditCost: { gt: 0 }, model: { active: true } },
    });
    const imgRule = await prisma.pricingRule.findFirst({
      where: { active: true, nodeType: { key: 'image' }, modelId: { not: null }, resolutionId: { not: null }, creditCost: { gt: 0 }, model: { active: true } },
    });
    if (!textRule) return; // 覆盖度门禁另测——本用例只守护 text 腿入账
    const nodes = [
      { id: 'n-text', type: 'textInput', data: { model: textRule.modelId } },
      ...(imgRule ? [{ id: 'n-img', type: 'imageGen', data: { model: imgRule.modelId, resolution: imgRule.resolutionId } }] : []),
    ];
    const r = await svc.validateAll(nodes, 'team-x', 'user-x');
    // 'team-x' 无余额——唯一允许的 errors 是余额不足档（解析错误=键形状破坏，fail-loud）
    expect(r.errors.every((e: string) => e.startsWith('余额不足'))).toBe(true);
    expect(r.totalCost).toBeGreaterThan(0);
    expect(r.plans).toHaveLength(nodes.length); // 余额不足档 plans 照常累计（三轮 M2——构成可见性）
    const textPlan = r.plans.find((p) => p.nodeId === 'n-text');
    expect(textPlan?.creditCost).toBe(textRule.creditCost); // text 节点计入 totalCost 的直接证据
  });

  it('G-1 收口：①定价同源+②扣费自洽（text+image 混合组，首跑限定——重放分支不计费 Z18）', async () => {
    const f = await scaffoldG1Funds();
    // 夹具=客户端真实载荷形态（seed 固定 id+image 分辨率行 id）；聚合腿与 validation 同键（resolvePricingKey 单源）
    // Y0b-2 裁定 5：gpt4/sdxl 已随迁移钉 active=false（无外呼实现=不可售）——夹具切 kimi/hy-image（active 模型）
    const nodes = [
      { id: 'g1-text', type: 'textInput', data: { model: 'seed-model-kimi' } },
      { id: 'g1-img', type: 'imageGen', data: { model: 'seed-model-hy-image', resolution: 'seed-res-hy-1024' } },
    ];
    // Y0b-2 T2：api-caller 注入 prisma（resolveModel 单源）——外呼面 spyOn 打死不变；
    // 夹具 kimi/hy-image 为 executable 行（Z101：executable 无密钥维度——CI 零密钥下夹具照跑）
    const apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
    vi.spyOn(apiCaller, 'callTextGen').mockResolvedValue({ content: 'r' } as any);
    vi.spyOn(apiCaller, 'callImageGen').mockResolvedValue({ url: 'http://x/1.png' } as any);
    // writeNodeData 走 CollabDocumentService stub（execute 的 collabDoc 依赖位——租约面+文档面零真依赖）
    const collabDoc = {
      readCanvas: async () => ({ nodes, edges: [] }),
      writeNodeData: async () => {},
      writeExecStatus: async () => {},
      isLeaseServing: () => true,
    };
    const svc = new ExecutionService(
      prisma as unknown as PrismaService,
      new TopologyService(),
      validation,
      apiCaller,
      teamCredit,
      perm,
      collabDoc as any,
      { emitNodeStatus: () => {}, emitExecutionComplete: () => {} } as any,
      { add: async () => {} } as any,
      intentService,
    );
    const v = await validation.validateAll(nodes as any[], f.teamId, f.userId);
    const resolverTotal = await resolverTotalOf(nodes);
    const r = await svc.execute(f.projectId, undefined, f.userId, nodes.map((n) => n.id), undefined);
    expect(r.success).toBe(true);
    const intents = await prisma.generationIntent.findMany({ where: { projectId: f.projectId, status: 'SUCCEEDED' } });
    const intentSum = intents.reduce((s, i) => s + i.creditCost, 0);
    const settles = await prisma.teamCreditTransaction.findMany({ where: { teamId: f.teamId, type: 'settle' } });
    const settleSum = settles.reduce((s, t) => s + Math.abs(t.amount), 0);
    expect(v.totalCost).toBe(resolverTotal); // ①定价同源：validation ≡ resolver 聚合（含 text 腿）
    expect(v.totalCost).toBe(intentSum); // ①延伸：validation ≡ Σintent 快照
    expect(settleSum).toBe(intentSum); // ②扣费自洽：Σsettle ≡ Σintent.creditCost
    expect(v.totalCost).toBeGreaterThan(0);
  }, 60000);

  it('video 死亡线（Z20+四轮 Z36）：videoGen 实扣 ≡ 预检 ≡ 10（seed-pricing-hy-video-5=10；resolution 被声明参与制忽略）', async () => {
    const f = await scaffoldG1Funds();
    // 真实载荷形态：resolution:'1080p' 是 UI 预设——hy-video 未声明分辨率维度 ⇒ 定价忽略（Z36 声明参与制）
    const nodes = [{ id: 'g1-video', type: 'videoGen', data: { model: 'seed-model-hy-video', duration: 5, resolution: '1080p' } }];
    const apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
    vi.spyOn(apiCaller, 'callVideoGen').mockResolvedValue({ url: 'http://x/v.mp4' } as any);
    const collabDoc = {
      readCanvas: async () => ({ nodes, edges: [] }),
      writeNodeData: async () => {},
      writeExecStatus: async () => {},
      isLeaseServing: () => true,
    };
    const svc = new ExecutionService(
      prisma as unknown as PrismaService,
      new TopologyService(),
      validation,
      apiCaller,
      teamCredit,
      perm,
      collabDoc as any,
      { emitNodeStatus: () => {}, emitExecutionComplete: () => {} } as any,
      { add: async () => {} } as any,
      intentService,
    );
    const v = await validation.validateAll(nodes as any[], f.teamId, f.userId);
    const r = await svc.execute(f.projectId, undefined, f.userId, nodes.map((n) => n.id), undefined);
    expect(r.success).toBe(true);
    const intents = await prisma.generationIntent.findMany({ where: { projectId: f.projectId, status: 'SUCCEEDED' } });
    const intentSum = intents.reduce((s, i) => s + i.creditCost, 0);
    const settles = await prisma.teamCreditTransaction.findMany({ where: { teamId: f.teamId, type: 'settle' } });
    const settleSum = settles.reduce((s, t) => s + Math.abs(t.amount), 0);
    expect(v.totalCost).toBe(10); // 预检=seed-pricing-hy-video-5 行价（duration:5→seed-dur-5 同键归一）
    expect(intentSum).toBe(10); // 意图快照=同键同价
    expect(settleSum).toBe(10); // 实扣=冻结核销（预检≡实扣死亡线——旧实现两形状分叉根修守护）
  }, 60000);
});
