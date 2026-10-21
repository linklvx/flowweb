// apps/api/src/modules/execution/group-idempotency.int.spec.ts —— Y0b-2 T6 红用例（真库，裁定 4 验收）
// 十三用例+B-1 settle 后交付死区+重放补投影+intents 真库读面（Z78 信封清剿的 api 侧前提）。
// 装置=exec-partial-success.int 同款直构：真库真 team 真余额真 claim/reaper 面，外呼 apiCaller spy、
// collab 面=记录器 stub；enqueue 管道用例（⑪）以 execute 第 6/7 参（regenToken/jobId）模拟——
// processor→execute 透传有 unit 锚（execution.processor.spec.ts regenToken 用例），int 不起真 BullMQ。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService, IntentExhaustedError } from './generation-intent.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { makeArtifactCommit } from '../../test-utils/artifact-commit-fixture';
import { ExecutionService } from './execution.service';
import { TopologyService } from './topology.service';
import { ValidationService } from './validation.service';
import { ApiCallerService } from './api-caller.service';
import { PricingResolverService } from './pricing-resolver.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { normalizeIntentParams } from './normalize-intent-params';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';
import { requestTraceStorage } from '../../middleware/request-trace.middleware';

// 无 DATABASE_URL（CI 未起库）自动 skip
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, new NodeArtifactService());
const resolver = new PricingResolverService(prisma as unknown as PrismaService);
const validation = new ValidationService(prisma as unknown as PrismaService, resolver);
const perm = new ProjectPermissionService(prisma as unknown as PrismaService);

const UID = `int-gi6-owner-${Date.now()}`;
const PID = `int-gi6-${Date.now()}`;
let TID = '';
/** 手工 claim 用定价快照（真库 active 付费规则行——FK 真源）。 */
let PAID: { pricingRuleId: string; modelId: string | null; resolutionId: string | null; durationId: string | null; creditCost: number };

/** 台账计数器（真库 TeamCreditTransaction——外呼/扣费/退款的判别面；nodeId 给定时按该节点意图行
 *  分账——绝对值断言不受同 team 前序用例污染）。 */
async function ledgerOf(nodeId?: string) {
  const rows = await prisma.teamCreditTransaction.findMany({
    where: { teamId: TID }, select: { type: true, referenceId: true },
  });
  let mine = rows;
  if (nodeId) {
    const ids = new Set((await rowsOf(nodeId)).map((r) => `intent:${r.id}`));
    mine = rows.filter((r) => ids.has(String(r.referenceId ?? '')));
  }
  return {
    settle: mine.filter((r) => r.type === 'settle').length,
    refund: mine.filter((r) => r.type === 'refund').length,
    release: mine.filter((r) => r.type === 'release').length,
  };
}

/** 夹具节点（funds-four-way 同款——真 seed 规则键：text=kimi / image=hy-image 1024）。 */
const textNode = (id: string) => ({ id, type: 'textInput', data: { model: 'seed-model-kimi' } });
const imageNode = (id: string) => ({ id, type: 'imageGen', data: { model: 'seed-model-hy-image', resolution: 'seed-res-hy-1024' } });
const nid = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;

/** ExecutionService 直构（exec-partial-success 形态）：collab 面=记录器 stub，外呼 spy 默认成功。 */
function makeExec(nodes: any[], collabOverrides: Record<string, unknown> = {}) {
  const apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
  vi.spyOn(apiCaller, 'callImageGen').mockResolvedValue({ url: 'http://x/1.png' } as any);
  vi.spyOn(apiCaller, 'callTextGen').mockResolvedValue({ content: '文本结果' } as any);
  const writeExecCalls: Array<{ nodeId: string; patch: any }> = [];
  const writeNodeCalls: Array<{ nodeId: string; patch: any }> = [];
  const collabDoc: any = {
    readCanvas: async () => ({ nodes, edges: [] }),
    isLeaseServing: () => true,
    writeNodeData: vi.fn(async (_p: string, nodeId: string, patch: any) => {
      writeNodeCalls.push({ nodeId, patch });
      return { written: true };
    }),
    writeExecStatus: vi.fn(async (_p: string, nodeId: string, patch: any) => {
      writeExecCalls.push({ nodeId, patch });
    }),
    ...collabOverrides,
  };
  const svc = new ExecutionService(
    prisma as unknown as PrismaService,
    new TopologyService(),
    validation,
    apiCaller,
    teamCredit,
    perm,
    collabDoc,
    { emitNodeStatus: vi.fn() } as any,
    intentSvc,
    { readUpstreamMediaId: async () => null, canonicalizeMediaRef: async (v?: string) => v || undefined, resolveCallUrl: async (v?: string) => v || undefined } as any,   // Y1a T8 upstreamMedia（本夹具无上游产物/手工 URL——行为与真实服务空场景等价）
    makeArtifactCommit(prisma as unknown as PrismaService, ledger, teamCredit, intentSvc).artifactCommit,   // T10：image/text finalize（真资金链——MinIO/fetch 注入）
  );
  return { svc, collabDoc, writeExecCalls, writeNodeCalls, apiCaller };
}

const rowsOf = async (nodeId: string) =>
  prisma.generationIntent.findMany({ where: { projectId: PID, nodeId }, orderBy: { createdAt: 'asc' } });


(hasDb ? describe : describe.skip)('Y0b-2 T6：regenToken 幂等全协议（十三用例+B-1，真库）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-gi6-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-gi6-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 500, frozenDelta: 0, referenceId: `it-gi6-fund-${Date.now()}`,
    }));
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-gi6', userId: UID, teamId: TID } });
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PAID = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  }, 20_000);

  afterAll(async () => {
    // P1（spec 评审）：NodeArtifact/ArtifactProjection 必须显式清（无 project FK 不随 cascade 删）——
    // 残留 dangling 锚会填满 sweepProjectionBackfill 的 oldest-first LIMIT 50，饿死同批 R3 spec
    // 的窗③/Important#2 用例（int-r3 两用例同批假红的实证根因；deliver-refund afterAll 同款）。
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.reconcileAction.deleteMany({
      where: { intentRowId: { in: (await prisma.generationIntent.findMany({ where: { projectId: PID }, select: { id: true } })).map((r: any) => r.id) } },
    }).catch(() => undefined);
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('① 同参数二次 execute（无 token）→ 第二次零外呼零新增扣费+done 投影补齐（最新回放）', async () => {
    const n = nid('a1'); const nodes = [textNode(n)];
    const e1 = makeExec(nodes);
    const r1 = await e1.svc.execute(PID, undefined, UID, [n]);
    expect(r1.success).toBe(true);
    const led1 = await ledgerOf();
    const e2 = makeExec(nodes); // 全新装置=全新"客户端上下文"（writeNodeData 独立计数）
    const r2 = await e2.svc.execute(PID, undefined, UID, [n]);
    expect(r2.success).toBe(true);
    // 判别：外呼恰 1（第二次零外呼——装置 2 的 spy 计数 0）
    expect(e2.apiCaller.callTextGen).not.toHaveBeenCalled();
    // 台账 settle 不增（零新增扣费）
    const led2 = await ledgerOf();
    expect(led2.settle).toBe(led1.settle);
    // 行数恰 1
    expect((await rowsOf(n)).length).toBe(1);
    // T15 收口：回放零 doc 写（done 投影/fileId 交付=投影 poller deliverArtifact 专写——投影行在案
    // 驱动交付；旧 T5 Minor#5「回放补 done 投影」面随直写退役）
    const donePatch = e2.writeExecCalls.filter((c) => c.patch.status === 'done');
    expect(donePatch.length).toBe(0);
    expect(e2.writeNodeCalls.length).toBe(0); // worker 零 data 写（text 截断占位禁写面自然消解）
  });

  it('② 跨客户端上下文（同参数新请求全新装置）→ 同上结构性生效（idemKey 服务端派生非客户端记忆）', async () => {
    const n = nid('a2'); const nodes = [imageNode(n)];
    const e1 = makeExec(nodes);
    await e1.svc.execute(PID, undefined, UID, [n]);
    const led1 = await ledgerOf();
    const e2 = makeExec(nodes);
    await e2.svc.execute(PID, undefined, UID, [n]);
    expect(e2.apiCaller.callImageGen).not.toHaveBeenCalled(); // 零外呼
    expect((await ledgerOf()).settle).toBe(led1.settle);       // 零新增扣费
    expect((await rowsOf(n)).length).toBe(1);                  // 同一行
    // T15 收口：回放零 doc 写（fileId 交付=投影 poller——pending 投影行随首轮 finalize 落库，
    // poller 按 mediaId 交付；旧「replay 补写 fileId」面随直写退役）
    expect(e2.writeExecCalls.filter((c) => c.patch.status === 'done')).toHaveLength(0);
    expect(e2.writeNodeCalls).toHaveLength(0);
    // 交付有 owner：首轮落的 pending 投影行在案（fileId=mediaId 权威锚）
    const proj = await prisma.artifactProjection.findMany({ where: { projectId: PID, nodeId: n, state: 'pending' } });
    expect(proj.length).toBe(1);
    expect(String(proj[0].mediaId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('③ 同参数 enqueue 管道（带 jobId）与 execute 直达交叉 → 同行一次扣费（跨路径）', async () => {
    const n = nid('a3'); const nodes = [textNode(n)];
    const e1 = makeExec(nodes);
    // 直达路径（无 jobId）
    await e1.svc.execute(PID, undefined, UID, [n]);
    const led1 = await ledgerOf();
    // enqueue 管道路径（jobId='job-e3'——processor 透传形态）
    const e2 = makeExec(nodes);
    await e2.svc.execute(PID, undefined, UID, [n], undefined, 'job-e3');
    expect(e2.apiCaller.callTextGen).not.toHaveBeenCalled(); // 零外呼
    expect((await ledgerOf()).settle).toBe(led1.settle);
    expect((await rowsOf(n)).length).toBe(1);
  });

  it('④ 改 prompt 重试 → 新行新扣费（改前红 409 死路——异 idemKey=新意图）', async () => {
    const n1 = nid('a4a'); const n2 = nid('a4b'); // text 链 prompt 由上游/节点 data 决定——用两节点模拟改参
    const e = makeExec([textNode(n1), textNode(n2)]);
    await e.svc.execute(PID, undefined, UID, [n1]);
    const led1 = await ledgerOf();
    await e.svc.execute(PID, undefined, UID, [n2]); // 不同 nodeId=不同内容键=新意图
    const led2 = await ledgerOf();
    expect(led2.settle).toBe(led1.settle + 1); // 新扣费
    expect(e.apiCaller.callTextGen).toHaveBeenCalledTimes(2); // 新外呼
  });

  it('⑤ 显式 token（done 后重新生成）→ 新行新外呼新扣费', async () => {
    const n = nid('a5'); const nodes = [imageNode(n)];
    const e = makeExec(nodes);
    await e.svc.execute(PID, undefined, UID, [n]); // 普通执行 done
    const led1 = await ledgerOf();
    const rows1 = await rowsOf(n);
    await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0005');
    const led2 = await ledgerOf();
    expect(e.apiCaller.callImageGen).toHaveBeenCalledTimes(2); // 新外呼
    expect(led2.settle).toBe(led1.settle + 1);                 // 新扣费
    expect((await rowsOf(n)).length).toBe(rows1.length + 1);   // 新行
  });

  it('⑥ 同 token 丢响应重试 ×3 → 恰一次外呼一次扣费+后两次零动作回放', async () => {
    const n = nid('a6'); const nodes = [textNode(n)];
    const e = makeExec(nodes);
    for (let i = 0; i < 3; i++) {
      await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0006');
    }
    expect(e.apiCaller.callTextGen).toHaveBeenCalledTimes(1); // 恰一次外呼
    const led = await ledgerOf(n);
    expect(led.settle).toBeGreaterThanOrEqual(1);
    expect((await rowsOf(n)).length).toBe(1);                 // 同一行
    expect(led.refund).toBe(0);                               // 无退款（非失败路径）
  });

  it('⑦ token 撞 RUNNING 行（异 jobId）→ NodeBusy 零新行', async () => {
    const n = nid('a7');
    // 占位在飞（手势键 A，真 claim——同步路径 jobId null）
    await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, gestureToken: 'occ-a7-token',
      kind: 'image', paramsHash: 'h7',
      teamId: TID, pricing: PAID,
    });
    const rowsBefore = (await rowsOf(n)).length;
    const e = makeExec([imageNode(n)]);
    const r = await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0007', 'job-a7');
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatchObject({ status: 'skipped', errorCode: 'NODE_BUSY' });
    expect(e.apiCaller.callImageGen).not.toHaveBeenCalled(); // 零外呼
    expect((await rowsOf(n)).length).toBe(rowsBefore);       // 零新行
  });

  it('⑧ EXHAUSTED 后新手势 token → 新行（attempts 不跨意图共享）', async () => {
    const n = nid('a8');
    // 手工铺 FAILED attempts=3 的手势键行（真 claim 失败三次的等价终态；token 字面量内联两处——gitleaks 泛型键规则按 const 赋值形态误报）
    const seeded = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, gestureToken: 'exhausted-seed-tok',
      kind: 'image', paramsHash: normalizeIntentParams('image', { prompt: 'p', model: 'seed-model-hy-image' }),
      teamId: TID, pricing: PAID,
    });
    await prisma.generationIntent.update({
      where: { id: seeded.intent.id }, data: { status: 'FAILED', attempts: 3, error: 'exhausted' },
    });
    // 同 token 第四击 → INTENT_EXHAUSTED（免费额度尽）
    await expect(intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, gestureToken: 'exhausted-seed-tok',
      kind: 'image', paramsHash: normalizeIntentParams('image', { prompt: 'p', model: 'seed-model-hy-image' }),
      teamId: TID, pricing: PAID,
    })).rejects.toBeInstanceOf(IntentExhaustedError);
    // 新 token（新手势）→ 新行照常（execute 全链）
    const e = makeExec([imageNode(n)]);
    await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0008');
    expect(e.apiCaller.callImageGen).toHaveBeenCalledTimes(1);
    const rows = await rowsOf(n);
    expect(rows.length).toBe(2); // 占位行+新行
    expect(rows[1].attempts).toBe(1); // attempts 不共享
  });

  it('⑨ erase 不同 maskFileId → 新 idemKey 新行（改前红：空 whitelist 同键回放旧产物）', async () => {
    const n = nid('a9');
    const p1 = { fileId: 'f1', maskFileId: 'mask-a' };
    const p2 = { fileId: 'f1', maskFileId: 'mask-b' };
    const c1 = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, kind: 'erase',
      paramsHash: normalizeIntentParams('erase', p1), teamId: TID, pricing: PAID,
    });
    await prisma.generationIntent.update({ where: { id: c1.intent.id }, data: { status: 'SUCCEEDED', resultRef: 'media-a9' } });
    const c2 = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, kind: 'erase',
      paramsHash: normalizeIntentParams('erase', p2), teamId: TID, pricing: PAID,
    });
    expect(c2.created).toBe(true);            // 新键新行（改前=同 sha256('{}') 常量键回放 created:false）
    expect(c2.intent.id).not.toBe(c1.intent.id);
    expect(normalizeIntentParams('erase', p1)).not.toBe(normalizeIntentParams('erase', p2));
    await prisma.generationIntent.update({ where: { id: c2.intent.id }, data: { status: 'SUCCEEDED', resultRef: 'media-b9' } });
    // 同 mask 重试 → 回放 mask-b 最新（身份键命中）
    const c3 = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, kind: 'erase',
      paramsHash: normalizeIntentParams('erase', p2), teamId: TID, pricing: PAID,
    });
    expect(c3.created).toBe(false);
    expect(c3.intent.resultRef).toBe('media-b9');
  });

  it('⑩ token 形态非法（>64/非法字符）→ IDEMPOTENCY_TOKEN_INVALID 不静默（claim 400 在节点级被 A-3 降级 errors——errorCode 判别保留）+零外呼；regenerate 后无 token 普通点击→最新回放', async () => {
    const n = nid('a10'); const nodes = [textNode(n)];
    const e = makeExec(nodes);
    // 非法 token（>64）→ claim throw 400；组执行链 A-3 降级=errors 携 errorCode（unit 层 400 throw 已锚）
    const bad1 = await e.svc.execute(PID, undefined, UID, [n], 'x'.repeat(65));
    expect(bad1.errors[0]).toMatchObject({ errorCode: 'IDEMPOTENCY_TOKEN_INVALID', status: 'error' });
    // 非法字符 → 同
    const bad2 = await e.svc.execute(PID, undefined, UID, [n], 'bad token!');
    expect(bad2.errors[0]).toMatchObject({ errorCode: 'IDEMPOTENCY_TOKEN_INVALID' });
    expect(e.apiCaller.callTextGen).not.toHaveBeenCalled();
    // regenerate（合法 token）成功后，无 token 普通点击 → 回放最新（② 修复的 regenerate 倒退面）
    await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0010a');
    const rowsBefore = await rowsOf(n);
    const led1 = await ledgerOf();
    await e.svc.execute(PID, undefined, UID, [n]);
    expect(e.apiCaller.callTextGen).toHaveBeenCalledTimes(1); // 仅 regenerate 一次外呼
    expect((await ledgerOf()).settle).toBe(led1.settle);
    expect((await rowsOf(n)).length).toBe(rowsBefore.length);
  });

  it('⑪ 经 enqueue 管道的"重新生成"（regenToken 携 jobId 入队形态）→ 新行新外呼新扣费——非回放（Z91 改前红：token 丢失=静默回放）', async () => {
    const n = nid('a11'); const nodes = [imageNode(n)];
    const e = makeExec(nodes);
    // 第一版：直达无 token
    await e.svc.execute(PID, undefined, UID, [n]);
    const led1 = await ledgerOf();
    // 第二版：enqueue 管道（regenToken+jobId——processor 透传形态）
    await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0011', 'job-a11');
    const led2 = await ledgerOf();
    expect(e.apiCaller.callImageGen).toHaveBeenCalledTimes(2); // 新外呼（非回放）
    expect(led2.settle).toBe(led1.settle + 1);                 // 新扣费
    expect((await rowsOf(n)).length).toBe(2);                  // 新行
  });

  it('⑫ RUNNING 在飞+无 token 普通点击 → NodeBusy 非回放（doc 产物未被旧版覆盖）（Z94 改前红：内容键 SUCCEEDED 行回放旧产物）', async () => {
    const n = nid('a12'); const nodes = [imageNode(n)];
    const e = makeExec(nodes);
    // v1 成功（内容键行 SUCCEEDED resultRef v1）
    await e.svc.execute(PID, undefined, UID, [n]);
    const v1Calls = e.writeNodeCalls.length;
    // v2 regenerate 在飞（手势键 RUNNING——真 claim 占位后手工置 RUNNING 保持）
    const occ = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, gestureToken: 'occ-a12-token',
      kind: 'image', paramsHash: normalizeIntentParams('image', { prompt: 'p', model: 'seed-model-hy-image' }),
      teamId: TID, pricing: PAID,
    });
    expect(occ.intent.status).toBe('RUNNING');
    // 无 token 普通点击 → ⓪ 拦（改前=回放内容键 v1 旧产物+emit done 闪旧版）
    const led1 = await ledgerOf();
    const e2 = makeExec(nodes);
    const r = await e2.svc.execute(PID, undefined, UID, [n]);
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatchObject({ status: 'skipped', errorCode: 'NODE_BUSY' });
    expect(e2.apiCaller.callImageGen).not.toHaveBeenCalled();
    expect(e2.writeNodeCalls.length).toBe(0);  // doc 产物未被旧版覆盖（零交付）
    expect(e2.writeExecCalls.filter((c) => c.patch.status === 'done')).toHaveLength(0); // 无 done 闪旧
    expect((await ledgerOf()).settle).toBe(led1.settle);
  });

  it('⑭ stalled 重排 hash 漂移 → ⓪ 同 jobId 直接 rearm 续跑同行（非 NodeBusy——S3 e2e 实证修复：首段 model 补丁经 collab 去抖窗未落 PG，重启重放后 paramsHash 变，① 键查找 miss ⇒ create 撞 partial unique ⇒ NodeBusy ⇒ 意图悬挂至 deadline 批）', async () => {
    const n = nid('a14'); const nodes = [imageNode(n)];
    const e = makeExec(nodes);
    // 首段：经 enqueue 形态 claim（带 token+jobId）占位 RUNNING
    const first = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, gestureToken: 'a14-stall-token',
      kind: 'image', paramsHash: normalizeIntentParams('image', { prompt: 'p', model: 'seed-model-hy-image' }),
      teamId: TID, pricing: PAID, jobId: 'job-a14',
    });
    expect(first.intent.status).toBe('RUNNING');
    // 重排段（心跳新鲜——旧 worker 在飞）：**漂移后的 hash**+同 jobId ⇒ T9 态① same-job-alive 零写让位
    const alive = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, gestureToken: 'a14-stall-token',
      kind: 'image', paramsHash: normalizeIntentParams('image', { prompt: 'p', model: undefined as any }),
      teamId: TID, pricing: PAID, jobId: 'job-a14',
    });
    expect(alive.created).toBe(false);                        // T9：新鲜=让位（重排 worker moveToDelayed 不 ack）
    expect((alive as any).result).toBe('same-job-alive');
    // 心跳陈旧（旧 worker 真死）⇒ 态② takeover：漂移 hash+同 jobId 续跑同行（行身份=jobId+partial unique 非 hash）
    await prisma.generationIntent.update({ where: { id: first.intent.id }, data: { heartbeatAt: new Date(Date.now() - 61_000) } });
    const drifted = await intentSvc.claim({
      projectId: PID, nodeId: n, userId: UID, gestureToken: 'a14-stall-token',
      kind: 'image', paramsHash: normalizeIntentParams('image', { prompt: 'p', model: undefined as any }),
      teamId: TID, pricing: PAID, jobId: 'job-a14',
    });
    expect(drifted.created).toBe(true);
    expect(drifted.intent.id).toBe(first.intent.id);          // 同一行（takeover 换代续跑）
    expect(BigInt(drifted.intent.execSeq)).toBeGreaterThan(BigInt(first.intent.execSeq)); // T9：换代
    expect(drifted.intent.heartbeatAt.getTime()).toBeGreaterThan(first.intent.heartbeatAt.getTime()); // 重锚刷新
    const rows = await prisma.generationIntent.count({ where: { nodeId: n } });
    expect(rows).toBe(1);                                     // 零新行（改前=NodeBusy 静默悬挂）
  });

  it('⑬ error 后同 token 重试 → 命中 FAILED 行免费 rearm：同一行（row.id 不变）、attempts 1→2、零新增扣费（Z95 判别性断言=行身份）', async () => {
    const n = nid('a13'); const nodes = [textNode(n)];
    const e = makeExec(nodes);
    // 第一次：外呼失败 → FAILED attempts=1（fail 写 error 后行 attempts 保留 claim 时值 1）
    (e.apiCaller.callTextGen as any).mockRejectedValueOnce(new Error('provider 503'));
    const r1 = await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0013');
    expect(r1.success).toBe(false);
    const row1 = (await rowsOf(n))[0];
    expect(row1.status).toBe('FAILED');
    expect(row1.attempts).toBe(1);
    // 失败路径冻结已 void_ 解冻——零 settle（按本节点行分账）
    const led1 = await ledgerOf(n);
    expect(led1.settle).toBe(0);
    // 同 token 重试 → 同行 rearm（免费——FAILED 重试 alreadyCharged 语义）+外呼第 2 次成功
    const r2 = await e.svc.execute(PID, undefined, UID, [n], 'regen-token-0013');
    expect(r2.success).toBe(true);
    const row2 = (await rowsOf(n))[0];
    expect(row2.id).toBe(row1.id);          // 同一行（Z95 判别性断言）
    expect(row2.status).toBe('SUCCEEDED');
    expect(row2.attempts).toBe(2);          // 1→2
    expect((await rowsOf(n)).length).toBe(1); // 零新行
    expect(e.apiCaller.callTextGen).toHaveBeenCalledTimes(2); // 两执行段各一次（第二次=rearm 续跑）
    const led2 = await ledgerOf(n);
    expect(led2.settle).toBe(1);            // 恰一次实扣
    expect(led2.refund).toBe(0);
  });

  it('T15 B-1 形态迁移：finalize 后残余段抛错（emit 注入——交付已归投影链）⇒ 行 SUCCEEDED 保持+零退款（防御观测档：投影行在案=交付有 owner）', async () => {
    const n = nid('b1'); const nodes = [imageNode(n)];
    const emitThrow = vi.fn(((_p: string, payload: any) => { if (payload?.status === 'done') throw new Error('emit pipe down'); }) as any);
    const e = makeExec(nodes);
    (e.svc as any).emitPort.emitNodeStatus = emitThrow;   // finalize 后残余段（done emit 位）抛错注入（早段 emit 不受扰）
    const r = await e.svc.execute(PID, undefined, UID, [n]);
    expect(r.success).toBe(true);   // 交付不阻塞 worker 判定（旧 NODE_DELIVERY_FAILED 面退役）
    const row = (await rowsOf(n))[0];
    expect(row.status).toBe('SUCCEEDED');   // 资金面 finalize 已核销——零退款（orphaned 退款归 poller）
    const led = await ledgerOf(n);
    expect(led.settle).toBeGreaterThanOrEqual(1);
    expect(led.refund ?? 0).toBe(0);   // B-1 退款面移交投影链（双跑退款面根除）
    // 零 error 投影（error 会与 poller done 对撞——防御观测档只 WARN）
    expect(e.writeExecCalls.find((c) => c.patch.status === 'error')).toBeUndefined();
  });

  it('Z78 信封清剿 api 侧前提：listByNode 真库行=裸数组（attempts 列在投影——web 对齐消费）', async () => {
    const n = nid('env'); const nodes = [textNode(n)];
    const e = makeExec(nodes);
    await e.svc.execute(PID, undefined, UID, [n]);
    const rows = await intentSvc.listByNode(PID, n);
    expect(Array.isArray(rows)).toBe(true);      // controller 裸返回（拦截器单层包裹——手包双层已清剿）
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ kind: 'text', status: 'SUCCEEDED' });
    expect(typeof rows[0].attempts).toBe('number'); // T5 投影代次判据列
  });

  // Y0b-5 T13 出口⑮（组执行资金审计锚）：带 x-request-id 的三节点组执行 → 3 行 intent 同 traceId
  // 全落库 ∧ Σ冻结正确。载体分工：HTTP 200 ∧ x-request-id≡traceId 响应头由 request-trace/http-red
  // middleware unit 锚覆盖；本用例锚服务侧 claim 落库链（controller ALS 读取形态=requestTraceStorage.run
  // 内读 store 传 execute 第 7 参——与 execution.controller.execute 同构）。
  it('T13 出口⑮：三节点组执行（ALS 上下文带 traceId）→ success ∧ 3 行 intent 同 traceId 全落库 ∧ Σ冻结正确（settle 清零零退款）', async () => {
    const ns = [nid('t13a'), nid('t13b'), nid('t13c')];
    const nodes = [imageNode(ns[0]), imageNode(ns[1]), imageNode(ns[2])]; // 三付费节点——Σ冻结判别性最大
    const e = makeExec(nodes);
    const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
    let r: Awaited<ReturnType<ExecutionService['execute']>>;
    await requestTraceStorage.run({ traceId: trace }, async () => {
      r = await e.svc.execute(PID, undefined, UID, ns, undefined, undefined, requestTraceStorage.getStore()?.traceId);
    });
    expect(r!.success).toBe(true);            // HTTP 200 等价（直构出口——errors=[]）
    expect(r!.totalCost).toBeGreaterThan(0);
    let sumConsumed = 0;
    for (const n of ns) {
      const row = (await rowsOf(n))[0];
      expect(row.traceId).toBe(trace);        // 同 traceId 全落库（"该 trace 下所有 intent"审计读面成立）
      expect(row.status).toBe('SUCCEEDED');
      expect(row.reservedCredits).toBe(0);    // Σ冻结正确：settle 清零（冻结→实扣，无悬留冻结）
      expect(row.creditsConsumed).toBe(row.creditCost);
      sumConsumed += row.creditsConsumed;
      const led = await ledgerOf(n);
      expect(led.settle).toBe(1);             // 每节点恰一次实扣
      expect(led.refund).toBe(0);             // 零退款（零部分失败）
    }
    expect(r!.totalCost).toBe(sumConsumed);   // totalCost=实扣真值审计口径（P8）
  }, 30_000);

  // Y0c T33 D 出口⑯（stalled 重投三联——§0.6 偏离 51 构造性桩）：判据字面「在飞 ffmpeg」的测试
  // 落地形态=deferred 外呼构造在飞段（真实媒体双面不可用：本地零媒体链/服务器 FFMPEG_PATH Windows
  // 残留〔偏离 44〕；全仓 int 装置外呼恒 stub 同款口径）。三联判别对象=claim 重入/reserve CAS/投影链：
  // 段1 在飞（外呼 gate 挂起）→ 段2 同 jobId 重投（BullMQ stalled 语义——claim ⓪ rearm 重入 →
  // reserve CAS alreadyReserved → Z35 skipped 静默退出）→ 段1 完成。交叉引用：team-credit.atomic r3
  // （CAS 单元面）+generation-intent.service.spec ②（重入单元面）+⑭（rearm 同行真库面）。
  it('T33 出口⑯：stalled 重投三联（在飞段 deferred 外呼+同 jobId 重投段）→ 完成一次/零重复扣费/零虚假 error 投影', async () => {
    const n = nid('a16'); const nodes = [imageNode(n)];
    const e = makeExec(nodes);
    let providerCalls = 0;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((r) => { releaseProvider = r; });
    (e.apiCaller.callImageGen as any).mockImplementation(async () => {
      providerCalls += 1; await providerGate; return { url: 'http://x/16.png' };
    });
    // 段1：enqueue 形态在飞（regenToken+jobId——⑪ 同款 execute 第 5/6 参）
    const p1 = e.svc.execute(PID, undefined, UID, [n], 'stalled-tok-16', 'job-stalled-16');
    // 等段1 外呼真在飞（claim RUNNING+reserve 冻结+reanchor 已毕——外呼入口即 providerCalls=1；
    // 以此为重投段前置=避免 reserve CAS 竞态窗（段1 冻结未落时段2 CAS 可能抢到 count=1）
    const t0 = Date.now();
    while (providerCalls < 1) {
      if (Date.now() - t0 > 10_000) throw new Error('段1 外呼 10s 未进入在飞态——claim/reserve 链断？');
      await new Promise((r) => setTimeout(r, 50));
    }
    // 段2：stalled 重投（同 jobId 重进 execute——BullMQ maxStalledCount 重排语义的进程内构造）
    // T34 微修①（V31 对称）：段2 断言至 await p1 包 try/finally releaseProvider()——断言失败路径
    // 同样放行 gate，防 p1 永挂 30s 超时掩埋真红（collab-write-endpoint finally restoreLease 同款纪律）
    let r1: Awaited<ReturnType<ExecutionService['execute']>>;
    try {
      const r2 = await e.svc.execute(PID, undefined, UID, [n], 'stalled-tok-16', 'job-stalled-16');
      expect(providerCalls, '重投段零新增外呼（Z35 mayCall:false 禁再外呼）').toBe(1);
      expect(r2.errors.length, '重投段恰一条 skipped 分诊（非 error——Z99 skipped 族）').toBe(1);
      expect(r2.errors[0]).toMatchObject({ nodeId: n, status: 'skipped' });
      expect(r2.success, 'success=errors.length===0 单源——skipped 亦非 success（客户端轮换判据）').toBe(false);
      expect((await rowsOf(n)).length, '重投段零新行（claim ⓪ 同 jobId rearm 续跑同行）').toBe(1);
      // 段1 完成（"ffmpeg" 归——gate 放行）
      releaseProvider();
      r1 = await p1;
    } finally {
      releaseProvider();
    }
    expect(r1.success, '在飞段照常完成（Z88：skipped 非终态，done 由在飞段落）').toBe(true);
    // 三联①完成一次：单行 SUCCEEDED+外呼恰一次
    const rows = await rowsOf(n);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('SUCCEEDED');
    expect(providerCalls).toBe(1);
    // 三联②零重复扣费：settle 恰一次+零退款零释放（重投段零新冻结=r3 CAS alreadyReserved 承担）
    const led = await ledgerOf(n);
    expect(led).toEqual({ settle: 1, refund: 0, release: 0 });
    expect(rows[0].reservedCredits).toBe(0);   // 冻结已 settle 清零（无悬留）
    // 三联③零虚假 error 投影：本节点全部投影零 error 态；序列含 skipped（重投段）且终态 done（在飞段）
    const statuses = e.writeExecCalls.filter((c) => c.nodeId === n).map((c) => c.patch.status);
    expect(statuses, `投影序列不得含 error（实收 ${JSON.stringify(statuses)}）`).not.toContain('error');
    expect(statuses, '重投段 skipped 投影在档（Z35 非终态可观测面）').toContain('skipped');
    // T15：worker 写面终态序终指针=skipped（done=投影 poller deliverArtifact 专写——本装置零
    // poller，doc 终态收敛归 projection-outbox.poller.int.spec 真双端面）
    expect(statuses[statuses.length - 1], 'worker 投影面最后写=重投段 skipped（done 归投影 poller）').toBe('skipped');
  }, 30_000);
});
