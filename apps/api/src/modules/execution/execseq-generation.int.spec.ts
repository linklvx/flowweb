// apps/api/src/modules/execution/execseq-generation.int.spec.ts —— Y1a+Y1b T9（spec v14.2 ①㉒㉓㉙）：
// execSeq 全局单调代际链路真库红绿——claim nextval 两处/同 job 重入三态（same-job-alive+takeover void）/
// rearm 只释放（只 voidInTx 不 re-reserve）/旧代资金与生命线写 0 命中 no-op/tickFence onTick 代际 abort/
// providerRequestId write-ahead+providerTaskId 落库+query-first 键序（真 HTTP mock provider）/
// processor skip 路径 moveToDelayed（真 BullMQ）。
// 红形态（改前可复现）：现状 claim 同 job 重入=rearm 续跑同代+reserve alreadyReserved→mayCall:false
// （team-credit:105 悬挂）；skip 后 return=ack→旧 worker 真死零交付；旧 worker 在接管后仍轮询 provider 白烧钱；
// providerTaskId/providerRequestId 全仓零写库点。
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from './generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ApiCallerService } from './api-caller.service';
import { ExecutionProcessor } from './execution.processor';
import { ExecutionService } from './execution.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit);

/** pollLoop 轮询间隔最小档 1000（envMs <1000 视为未设——query-first 用例需秒级轮询） */
process.env.EXEC_POLL_TIMEOUT_MS = '1000';

const PID = `int-t9-${Date.now()}`;
const UID = `int-t9-owner-${Date.now()}`;
let TID = '';
let PRICING: any;

/** 造陈旧心跳（接管判据：heartbeatAt 老于锁窗）——T9 心跳过期=旧 worker 死/失联的结构信号 */
const ageHeartbeat = (id: string, msAgo: number) =>
  prisma.generationIntent.update({ where: { id }, data: { heartbeatAt: new Date(Date.now() - msAgo) } });

const claimIntent = async (over: Record<string, unknown> = {}) =>
  intentSvc.claim({
    projectId: PID,
    nodeId: over.nodeId as string ?? `n-${randomUUID().slice(0, 8)}`,
    userId: UID,
    kind: 'image',
    paramsHash: `h-${randomUUID().slice(0, 8)}`,
    teamId: TID,
    pricing: PRICING,
    ...over,
  });

const rowOf = (id: string) => prisma.generationIntent.findUnique({ where: { id } });
const txOf = async (intentRowId: string, type: string) =>
  prisma.teamCreditTransaction.findMany({ where: { teamId: TID, referenceId: `intent:${intentRowId}`, type: type as any } });

(hasDb ? describe : describe.skip)('Y1a T9：execSeq 代际链路（真 PG+真 BullMQ）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t9-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-t9-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-t9-fund-${Date.now()}`,
    }));
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  });

  afterAll(async () => {
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } });   // T9 投影夹具清理
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } }).catch(() => undefined);
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  });

  describe('㉒ 同 job 重入三态（claim ⓪ 分支）', () => {
    it('态①心跳新鲜 → same-job-alive：零写行（execSeq/attempts/heartbeat 不动）——旧 worker 在飞本重排让位', async () => {
      const first = await claimIntent({ jobId: 't9-alive-job' });
      const before = await rowOf(first.intent.id);
      const reentry = await claimIntent({ nodeId: first.intent.nodeId, paramsHash: first.intent.paramsHash, gestureToken: first.intent.gestureKey ?? undefined, jobId: 't9-alive-job' });
      // 红：现状返回 created:true（rearm 续跑同代）——重排 worker 走 reserve 必 mayCall:false 悬挂
      expect(reentry.created).toBe(false);
      expect((reentry as any).result).toBe('same-job-alive');
      const after = await rowOf(first.intent.id);
      expect(after!.execSeq).toBe(before!.execSeq);       // 零换代
      expect(after!.heartbeatAt.getTime()).toBe(before!.heartbeatAt.getTime()); // 零重锚（行归旧 worker）
      await intentSvc.void_(first.intent.id, 't9 cleanup');
    });

    it('态②心跳过期 → takeover：nextval 新代+voidInTx 只释放旧冻结（不 re-reserve）+旧投影 superseded——恰好扣一次交付一次', async () => {
      const first = await claimIntent({ jobId: 't9-takeover-job' });
      const gen1 = first.intent.execSeq;
      // 旧 worker reserve（gen1 冻结）后死亡：心跳陈旧化
      const r1 = await teamCredit.reserve(UID, { intentRowId: first.intent.id, execSeq: gen1 });
      expect(r1.mayCall).toBe(true);
      await prisma.artifactProjection.create({
        data: { artifactId: `t9-fixture-art-${randomUUID().slice(0, 8)}`, artifactRev: 0, projectId: PID, nodeId: first.intent.nodeId, targetField: 'fileId', state: 'pending' },
      });
      await ageHeartbeat(first.intent.id, 61_000);
      // 新 worker 同 jobId 重入——过期接管
      const reentry = await claimIntent({ nodeId: first.intent.nodeId, paramsHash: first.intent.paramsHash, gestureToken: first.intent.gestureKey ?? undefined, jobId: 't9-takeover-job' });
      expect(reentry.created).toBe(true);
      expect((reentry.intent as any).execSeq).toBeGreaterThan(gen1); // nextval 新代（BigInt 比较非字典序）
      const after = await rowOf(first.intent.id);
      expect(after!.reservedCredits).toBe(0);      // 只释放（红：现状不 void——冻结滞留旧代）
      expect(after!.execProjectedExecSeq).toBeNull();
      const releaseRows = await txOf(first.intent.id, 'release');
      expect(releaseRows.length).toBeGreaterThan(0); // 台账 release 冲销在案
      const proj = await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: first.intent.nodeId } });
      expect(proj!.state).toBe('superseded');       // 旧投影 outbox superseded（红：现状无此写点）
      // 新代 reserve 重扣——红：现状 mayCall:false（team-credit:105 悬挂形态复现）
      const gen2 = (reentry.intent as any).execSeq;
      const r2 = await teamCredit.reserve(UID, { intentRowId: first.intent.id, execSeq: gen2 });
      expect(r2.mayCall, '接管后新代 reserve 必须 mayCall:true（旧冻结已被 voidInTx 释放）').toBe(true);
      // 交付链：complete（新代 CAS）→ settle（新代 CAS）——恰一次实扣
      expect(await intentSvc.complete(first.intent.id, 't9://result', gen2)).toBe(1);
      const settled = await teamCredit.settle({ intentRowId: first.intent.id, execSeq: gen2 });
      expect(settled.settled).toBe(true);
      const settleRows = await txOf(first.intent.id, 'settle');
      const cost = PRICING.creditCost;
      expect(settleRows.reduce((s, r) => s + Math.abs(r.amount), 0)).toBe(cost); // 恰一次实扣（settle 唯一）
      const bal = await prisma.teamBalance.findUnique({ where: { teamId: TID } });
      expect(bal!.credits).toBe(100 - cost);        // 旧冻结释放+新代一次实扣——净额恰 cost
    });

    it('态③ FAILED rearm → nextval 新代（重试=新执行段新代际）+旧投影 superseded', async () => {
      const first = await claimIntent({ jobId: 't9-rearm-job' });
      const gen1 = first.intent.execSeq;
      await intentSvc.fail(first.intent.id, 'boom', 't9-rearm-job', gen1);
      await prisma.artifactProjection.create({
        data: { artifactId: `t9-fixture-art2-${randomUUID().slice(0, 8)}`, artifactRev: 0, projectId: PID, nodeId: first.intent.nodeId, targetField: 'fileId', state: 'pending' },
      });
      const rearm = await claimIntent({ nodeId: first.intent.nodeId, paramsHash: first.intent.paramsHash, gestureToken: first.intent.gestureKey ?? undefined, jobId: 't9-rearm-job2' });
      expect(rearm.created).toBe(true);
      expect((rearm.intent as any).execSeq).toBeGreaterThan(gen1); // rearm=nextval 第二处（红：现状 execSeq 不动）
      const proj = await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: first.intent.nodeId, state: 'pending' } });
      expect(proj).toBeNull();                       // 旧 pending 投影已 superseded
      await intentSvc.void_(first.intent.id, 't9 cleanup2');
    });
  });

  describe('旧代生命线/资金写 0 命中 no-op（fail/tickFence/reanchor/settle/void）', () => {
    it('旧代 tickFence（心跳腿）+reanchorDeadline+fail 全 0 命中——新代行不受旧 worker 侵害', async () => {
      const first = await claimIntent({ jobId: 't9-noop-job' });
      const gen1 = first.intent.execSeq;
      await ageHeartbeat(first.intent.id, 61_000);
      const takeover = await claimIntent({ nodeId: first.intent.nodeId, paramsHash: first.intent.paramsHash, gestureToken: first.intent.gestureKey ?? undefined, jobId: 't9-noop-job' });
      const gen2 = (takeover.intent as any).execSeq;
      await teamCredit.reserve(UID, { intentRowId: first.intent.id, execSeq: gen2 });
      const before = await rowOf(first.intent.id);
      // 旧代三写（红：现状方法忽略代际——heartbeat 被旧 worker 刷新/fail 杀新代行）
      // T9 收尾：tickFence 已合并 touchHeartbeat 为 UPDATE..RETURNING 单往返——旧代 0 命中即 abort，心跳腿零刷新
      expect(await intentSvc.tickFence(first.intent.id, gen1)).toBe('abort');
      expect((await rowOf(first.intent.id))!.heartbeatAt.getTime()).toBe(before!.heartbeatAt.getTime()); // 旧代心跳 0 命中
      expect(await intentSvc.reanchorDeadline(first.intent.id, 'image', gen1)).toBe(0);                 // 旧代重锚 0 命中
      await intentSvc.fail(first.intent.id, 'old worker late fail', 't9-noop-job', gen1);
      expect((await rowOf(first.intent.id))!.status).toBe('RUNNING');                                    // 旧代 fail 不杀新代
      // 旧代资金写 0 命中：settle/void 对新代冻结零动作
      expect((await teamCredit.settle({ intentRowId: first.intent.id, execSeq: gen1 })).settled).toBe(false);
      await teamCredit.void_({ intentRowId: first.intent.id, execSeq: gen1 });
      expect((await rowOf(first.intent.id))!.reservedCredits).toBe(PRICING.creditCost);                  // 新代冻结完好
      await intentSvc.void_(first.intent.id, 't9 cleanup3', gen2);
    });

    it('tickFence（onTick 双职+代际）：旧代/终态 → abort 停外呼；新代 RUNNING → 继续轮询', async () => {
      const first = await claimIntent({ jobId: 't9-fence-job' });
      const gen1 = first.intent.execSeq;
      await ageHeartbeat(first.intent.id, 61_000);
      const takeover = await claimIntent({ nodeId: first.intent.nodeId, paramsHash: first.intent.paramsHash, gestureToken: first.intent.gestureKey ?? undefined, jobId: 't9-fence-job' });
      const gen2 = (takeover.intent as any).execSeq;
      // 旧代 worker 的 onTick：行 RUNNING 但 execSeq 已换代 → abort（红：现状只查 status——undefined 继续轮询白烧钱）
      expect(await (intentSvc as any).tickFence(first.intent.id, gen1)).toBe('abort');
      expect(await (intentSvc as any).tickFence(first.intent.id, gen2)).toBeUndefined(); // 新代继续
      await intentSvc.void_(first.intent.id, 't9 fence terminal', gen2);
      expect(await (intentSvc as any).tickFence(first.intent.id, gen2)).toBe('abort');   // 终态（reaper 收敛语义维持）
    });
  });

  describe('provider 锚：write-ahead+落库（红：现状全仓零写库点）', () => {
    it('ensureProviderRequestId：铸造+落库+幂等返回同值；recordProviderTaskId：落库+旧代拒写', async () => {
      const first = await claimIntent({ jobId: 't9-anchor-job' });
      const gen = first.intent.execSeq;
      const rid = await intentSvc.ensureProviderRequestId(first.intent.id, gen);
      expect(typeof rid).toBe('string');
      expect((await rowOf(first.intent.id))!.providerRequestId).toBe(rid);
      expect(await intentSvc.ensureProviderRequestId(first.intent.id, gen)).toBe(rid); // 幂等
      await intentSvc.recordProviderTaskId(first.intent.id, gen, 't9-task-1');
      expect((await rowOf(first.intent.id))!.providerTaskId).toBe('t9-task-1');         // submit 后落库（query-first 锚）
      // 换代后旧代拒写（防旧 worker 覆写新代锚）
      await ageHeartbeat(first.intent.id, 61_000);
      const takeover = await claimIntent({ nodeId: first.intent.nodeId, paramsHash: first.intent.paramsHash, gestureToken: first.intent.gestureKey ?? undefined, jobId: 't9-anchor-job' });
      await intentSvc.recordProviderTaskId(first.intent.id, gen, 't9-task-stale');
      expect((await rowOf(first.intent.id))!.providerTaskId).not.toBe('t9-task-stale');
      expect((takeover.intent as any).providerTaskId).toBe('t9-task-1');                // 接管保留任务锚（query-first 复用）
      await intentSvc.void_(first.intent.id, 't9 cleanup4', (takeover.intent as any).execSeq);
    });

    it('reserve 旧代票（edit/lighting 旧 job 重投形态）：mayCall:false 零冻结——死代不得偷冻结', async () => {
      const first = await claimIntent({ jobId: 't9-stale-ticket-job' });
      const gen1 = first.intent.execSeq;
      await ageHeartbeat(first.intent.id, 61_000);
      const takeover = await claimIntent({ nodeId: first.intent.nodeId, paramsHash: first.intent.paramsHash, gestureToken: first.intent.gestureKey ?? undefined, jobId: 't9-stale-ticket-job' });
      const gen2 = (takeover.intent as any).execSeq;
      // 旧 job 重投携 gen1 票 reserve——红：现状 gate 只看 reservedCredits:0 → 旧 job 抢到冻结（死代偷冻结）
      const r = await teamCredit.reserve(UID, { intentRowId: first.intent.id, execSeq: gen1 });
      expect(r.mayCall).toBe(false);
      expect((await rowOf(first.intent.id))!.reservedCredits).toBe(0);  // 零冻结
      expect((await rowOf(first.intent.id))!.reservedExecSeq).toBeNull();
      // 新代照常 reserve
      expect((await teamCredit.reserve(UID, { intentRowId: first.intent.id, execSeq: gen2 })).mayCall).toBe(true);
      await intentSvc.void_(first.intent.id, 't9 cleanup5', gen2);
    });
  });

  // T9 收尾（评审 Important①）：claim 前 throw 的旧 worker（GC/网络暂停>60s 苏醒）迟到失败钩子
  // vs 行已 takeover 换代（jobId 不变——findByActiveNode(jobId) 必命中新代行）。
  // 红形态：现状 onFailed 无票守卫，fail(..., running.execSeq) 自读自写=代际 CAS 虚设 → 新代行被误杀
  // （新 worker complete CAS 0 命中——产物丢弃+白烧外呼）。
  it('failed 钩子票守卫（真 BullMQ）：claim 前 throw 的旧 worker 迟到失败 → 不误杀 takeover 新代 RUNNING 行', async () => {
    const QN = `t9-hook-${randomUUID().slice(0, 8)}`;
    const JOBID = `t9-hook-job-${randomUUID().slice(0, 8)}`;
    // 本 job 的在飞新代行（takeover 换代后形态：jobId 不变、心跳新鲜、RUNNING）
    const claimed = await claimIntent({ jobId: JOBID });
    const gen = claimed.intent.execSeq;
    // 旧 worker 模拟：claim 前即 throw（readCanvas 503/validate 等）——job.data 无票（onClaimed 从未触发）
    const execSvc = { execute: vi.fn().mockRejectedValue(new Error('readCanvas 503（claim 前 throw 模拟）')) };
    const processor = new ExecutionProcessor(execSvc as unknown as ExecutionService, {} as any, intentSvc);
    const worker = new Worker(QN, (job) => processor.process(job as any), { connection: { url: REDIS_URL } });
    const q = new Queue(QN, { connection: { url: REDIS_URL } });
    try {
      await worker.waitUntilReady();
      // failed 事件手动绑钩子（@nestjs/bullmq explorer 同款直绑——banner-cleanup 先例）；hookDone 序列化断言前钩子已跑完
      const hookDone = new Promise<void>((resolve) =>
        worker.on('failed', async (job: any, err: Error) => { await processor.onFailed(job, err); resolve(); }));
      await q.add('execution', { projectId: PID, nodeId: claimed.intent.nodeId, userId: UID }, { jobId: JOBID });
      await hookDone;
      let state = '';
      const job = await q.getJob(JOBID);
      for (let i = 0; i < 40; i++) {
        state = String(await job!.getState());
        if (state === 'failed') break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(state, '模拟旧 worker 的 process 必须真失败（throw 路径走通）').toBe('failed');
      // 断言：新代行不被 fail（红：现状被钩子以新代 execSeq 误杀 → FAILED）
      expect((await rowOf(claimed.intent.id))!.status).toBe('RUNNING');
      await intentSvc.void_(claimed.intent.id, 't9 hook guard cleanup', gen);
    } finally {
      await worker.close();
      await q.obliterate({ force: true });
      await q.close();
    }
  });
});

// ── query-first（真 HTTP mock provider——AIModel 真行+本地 submit/query 端点计数）──
(hasDb ? describe : describe.skip)('Y1a T9：query-first 键序（kill after submit→重跑零重复 provider submit）', () => {
  let apiCaller: ApiCallerService;
  let server: Server;
  let submitCount = 0;
  let submitHeaders: Record<string, string | string[] | undefined> = {};
  let queriedIds: string[] = [];
  const PORT = 3890 + Math.floor(Math.random() * 90);
  let MODEL_ID = '';

  beforeAll(async () => {
    apiCaller = new ApiCallerService(prisma as unknown as PrismaService);
    // 本地 mock provider：/submit 计数+回 taskId；/query 按请求 id 分义（srv-alive→succeeded/dead-task→failed/fresh→succeeded）
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/submit') {
          submitCount++;
          submitHeaders = req.headers;
          res.end(JSON.stringify({ id: 'fresh-task' }));
          return;
        }
        if (req.url === '/query') {
          const id = JSON.parse(body || '{}').id;
          queriedIds.push(id);
          if (id === 'dead-task') { res.end(JSON.stringify({ status: 'failed', error: 'task failed at provider' })); return; }
          res.end(JSON.stringify({ status: 'succeeded', data: ['http://img/t9.png'] }));
          return;
        }
        res.statusCode = 404; res.end();
      });
    });
    await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
    const nodeType = await prisma.nodeType.findFirstOrThrow({ where: { key: 'image' } });
    const model = await prisma.aIModel.create({
      data: { id: `t9-model-${randomUUID().slice(0, 8)}`, nodeTypeId: nodeType.id, name: 't9-model', provider: 'tencent', apiUrl: `http://127.0.0.1:${PORT}`, apiModelName: 't9-m', apiKey: 't9-key', active: true },
    });
    MODEL_ID = model.id;
  });

  afterAll(async () => {
    await prisma.aIModel.deleteMany({ where: { id: MODEL_ID } }).catch(() => undefined);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('resumeTaskId 命中 → 直接轮询零重发（红：现状无 resume 参数——submit 必发=重复外呼）', async () => {
    submitCount = 0; queriedIds = [];
    const result = await apiCaller.callImageGen({
      prompt: 't9', model: MODEL_ID, resolution: '1024×1024',
      resumeTaskId: 'srv-alive', idempotencyKey: 't9-rid-1',
    });
    expect(submitCount).toBe(0);                        // 零重复 submit（红：现状 submitCount=1）
    expect(queriedIds).toContain('srv-alive');          // 按 taskId 直查
    expect(result.url).toBe('http://img/t9.png');
    expect(result.providerTaskId).toBe('srv-alive');
  });

  it('resume 任务终态失败 → 重呼新任务（键序 taskId 腿耗尽→重呼；红：现状不查旧任务直接 fresh submit）', async () => {
    submitCount = 0; queriedIds = [];
    const result = await apiCaller.callImageGen({
      prompt: 't9', model: MODEL_ID, resolution: '1024×1024',
      resumeTaskId: 'dead-task', idempotencyKey: 't9-rid-2',
    });
    expect(queriedIds[0]).toBe('dead-task');            // 先查旧任务（红：现状首查即 fresh-task）
    expect(submitCount).toBe(1);                        // 旧任务失败→恰一次重呼
    expect(result.providerTaskId).toBe('fresh-task');
  });

  it('无 resume 全新段 → submit 携 Idempotency-Key 头（write-ahead 锚随请求发 provider——第一档激活点）', async () => {
    submitCount = 0;
    await apiCaller.callImageGen({ prompt: 't9', model: MODEL_ID, resolution: '1024×1024', idempotencyKey: 't9-rid-3' });
    expect(submitCount).toBe(1);
    expect(submitHeaders['x-idempotency-key']).toBe('t9-rid-3'); // 红：现状无此头
  });

  it('能力矩阵第三档：opaque submit 型+ambiguous（requestId 在/taskId 无）→ 禁自动重投（人工裁决）', async () => {
    let hit: any;
    try { (apiCaller as any).assertRedriveAllowed('opaque', true); } catch (e) { hit = e; }
    expect(hit).toMatchObject({ errorCode: 'PROVIDER_REDRIVE_BLOCKED' });               // 第三档崩溃窗禁自动重投
    expect((apiCaller as any).assertRedriveAllowed('queryable', true)).toBeUndefined(); // 第二档重呼放行
    expect((apiCaller as any).assertRedriveAllowed('opaque', false)).toBeUndefined();   // 非崩溃窗（fresh）放行
  });
});

// ── moveToDelayed（真 BullMQ Worker 包真 ExecutionProcessor——skip 不 ack 结构性修复）──
(hasDb ? describe : describe.skip)('Y1a T9：processor skip 路径 moveToDelayed（真 BullMQ）', () => {
  it('skip 结果 → moveToDelayed+DelayedError 不 ack（红：现状 return=completed→旧 worker 真死零交付）', async () => {
    const QN = `t9-move-${randomUUID().slice(0, 8)}`;
    const execSvc = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        errors: [{ nodeId: 'n1', status: 'skipped' as const, error: '该节点正在生成中', errorCode: 'NODE_BUSY' }],
        results: [], totalCost: 0,
      }),
    };
    const processor = new ExecutionProcessor(execSvc as unknown as ExecutionService, {} as any, {} as any);
    const worker = new Worker(QN, (job) => processor.process(job as any), { connection: { url: REDIS_URL } });
    const q = new Queue(QN, { connection: { url: REDIS_URL } });
    try {
      await worker.waitUntilReady();
      const job = await q.add('execution', { projectId: PID, nodeId: 'n1', userId: UID });
      // 轮询至终态（delayed 非 completed——红：现状 completed）
      let state = '';
      for (let i = 0; i < 40; i++) {
        state = String(await job.getState());
        if (state === 'delayed' || state === 'completed' || state === 'failed') break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(state, 'skip 后 job 必须进入 delayed（不 ack——重排续跑）').toBe('delayed');
    } finally {
      await worker.close();
      await q.obliterate({ force: true });
      await q.close();
    }
  });

  it('非 skip（正常 error）→ 照常 completed（moveToDelayed 只收 skip 面）', async () => {
    const QN = `t9-done-${randomUUID().slice(0, 8)}`;
    const execSvc = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        errors: [{ nodeId: 'n1', status: 'error' as const, error: 'x', errorCode: 'EXECUTION_FAILED' }],
        results: [], totalCost: 0,
      }),
    };
    const processor = new ExecutionProcessor(execSvc as unknown as ExecutionService, {} as any, {} as any);
    const worker = new Worker(QN, (job) => processor.process(job as any), { connection: { url: REDIS_URL } });
    const q = new Queue(QN, { connection: { url: REDIS_URL } });
    try {
      await worker.waitUntilReady();
      const job = await q.add('execution', { projectId: PID, nodeId: 'n1', userId: UID });
      let state = '';
      for (let i = 0; i < 40; i++) {
        state = String(await job.getState());
        if (state === 'delayed' || state === 'completed' || state === 'failed') break;
        await new Promise((r) => setTimeout(r, 150));
      }
      expect(state).toBe('completed');
    } finally {
      await worker.close();
      await q.obliterate({ force: true });
      await q.close();
    }
  });
});
