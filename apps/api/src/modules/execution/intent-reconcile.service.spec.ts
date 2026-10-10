import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ServiceUnavailableException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { TeamCreditService } from '../team/team-credit.service';
import { EXECUTION_QUEUE_NAME } from './execution.constants';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit/ai-image-edit.constants';
import { IntentReconcileService } from './intent-reconcile.service';

/** 构造一行 RUNNING 意图（默认心跳超龄 20min——Y0b-2 T4 判据单源 heartbeatAt；deadlineAt 更旧
 *  （30min 前）⇒ 心跳新于 deadline=轮询活着——deadline 批跳过，本档只测 stale 批三查） */
const intent = (over: Record<string, unknown> = {}) => ({
  id: 'gi-1',
  projectId: 'p1',
  nodeId: 'n1',
  userId: 'u1',
  intentId: 'i1',
  kind: 'image',
  paramsHash: 'h1',
  status: 'RUNNING',
  jobId: null, // 默认同步路径（合法无 jobId）
  teamId: 't1',
  creditsConsumed: 10,
  attempts: 1,
  resultRef: null,
  error: null,
  createdAt: new Date(Date.now() - 40 * 60_000),
  heartbeatAt: new Date(Date.now() - 20 * 60_000),
  deadlineAt: new Date(Date.now() - 30 * 60_000),
  startedAt: null,
  completedAt: null,
  ...over,
});

/** 一条 settle 消费流水行（amount 负、referenceId=intent: 维度；Y0b-1 枚举删 consumption——终态流水即 settle） */
const chargeRow = (over: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  teamId: 't1',
  operatorUserId: 'u1',
  amount: -10,
  type: 'settle',
  creditType: 'regular',
  referenceId: 'intent:gi-1',
  balanceAfter: 90,
  ...over,
});

/** 一条 reserve 冻结流水行（批0.5-9——amount 负=正向冻结） */
const reserveRow = (over: Record<string, unknown> = {}) => ({
  id: 'tx-r1',
  teamId: 't1',
  operatorUserId: 'u1',
  amount: -10,
  type: 'reserve',
  creditType: 'regular',
  referenceId: 'intent:gi-1',
  balanceAfter: 90,
  ...over,
});

describe('IntentReconcileService（F12/F13 两档三查）', () => {
  let service: IntentReconcileService;
  let prisma: any;
  let ledger: any;
  let teamCredit: any;
  let queue: any;
  let imageEditQueue: any;
  let collabDoc: any;
  let redis: any;

  beforeEach(async () => {
    ledger = {
      ledgerTx: async (raw: any) => raw,   // Y0b-2 Z89：tx() 已删——mock 同步换 ledgerTx（通行证装饰 mock 为直通）
      lockBalance: vi.fn().mockResolvedValue(undefined),
      ensureBalance: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue({ rowId: 'lr-1', balanceAfter: 0 }),
    };
    teamCredit = {
      settle: vi.fn().mockResolvedValue({ success: true, settled: true }),
      void_: vi.fn().mockResolvedValue(undefined),
    };
    prisma = {
      generationIntent: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }), count: vi.fn().mockResolvedValue(0) },
      teamCreditTransaction: { findMany: vi.fn().mockResolvedValue([]) },
      teamMember: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      videoSeparateTask: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
      canvasProject: { findMany: vi.fn().mockResolvedValue([]) },
      $executeRaw: vi.fn().mockResolvedValue(0),
      // Y0b-1 F1/Z6：chargeRows 改 anti-join $queryRaw（未被冲销行）；mock 默认零命中
      $queryRaw: vi.fn().mockResolvedValue([]),
      // 退款/解冻事务：mock 透传 tx=prisma 直执回调（team-credit.service.spec 同款）
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    };
    queue = { getJob: vi.fn().mockResolvedValue(null) };
    imageEditQueue = { getJob: vi.fn().mockResolvedValue(null) };
    collabDoc = { withDoc: vi.fn() };
    redis = { exists: vi.fn().mockResolvedValue(0), decr: vi.fn().mockResolvedValue(0), set: vi.fn().mockResolvedValue('OK') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentReconcileService,
        { provide: PrismaService, useValue: prisma },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: CreditLedgerService, useValue: ledger },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: getQueueToken(EXECUTION_QUEUE_NAME), useValue: queue },
        { provide: getQueueToken(AI_IMAGE_EDIT_QUEUE_NAME), useValue: imageEditQueue },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    }).compile();
    service = module.get(IntentReconcileService);
  });

  describe('档一 verifyActive 三查（F13 判据④）', () => {
    it('扫描谓词锚：status=RUNNING 且 heartbeatAt<15min 截止（Y0b-2 T4 判据单源——外呼 tick 刷心跳；deadline 批谓词=deadlineAt<now 先跑）', async () => {
      await service.verifyActive();
      // verifyActive 双批两次 findMany：第一次 deadline 批（deadlineAt<now）、第二次 stale 批（heartbeatAt<cutoff）
      const deadlineWhere = prisma.generationIntent.findMany.mock.calls[0][0].where;
      expect(deadlineWhere.status).toBe('RUNNING');
      expect(deadlineWhere.deadlineAt.lt).toBeInstanceOf(Date);
      const staleWhere = prisma.generationIntent.findMany.mock.calls.map((c: any[]) => c[0].where).find((w: any) => w.heartbeatAt)!;
      expect(staleWhere.status).toBe('RUNNING');
      expect(staleWhere.heartbeatAt.lt).toBeInstanceOf(Date);
      expect(Date.now() - staleWhere.heartbeatAt.lt.getTime()).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    });

    it('① 已扣+resultRef 非空 → SUCCEEDED 回填，零退款', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ resultRef: 'm-1' })]);
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING' },
        data: { status: 'SUCCEEDED', completedAt: expect.any(Date) },
      });
      expect(ledger.mutate).not.toHaveBeenCalled(); // 无退款
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('② 已扣无产物 → 退款事务（Z13 锁序 lockBalance 前置+守卫 CAS 补 creditsConsumed>0+refund mutate——Y0b-2 T0：monthlyUsed 已派生无列回滚写点）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent()]);
      // $queryRaw 按查询域分派：三查 chargeRows（SELECT r.* …）命中；Z11 孤儿巡检查询（SELECT r.id …）空——非本测试域
      prisma.$queryRaw.mockImplementation(async (tpl: any) => (String(tpl?.[0]).includes('r.*') ? [chargeRow()] : []));
      prisma.generationIntent.updateMany.mockResolvedValueOnce({ count: 1 }); // 守卫 CAS 拿到执行权

      await service.verifyActive();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Z13 锁序①：lockBalance 先于守卫 CAS
      expect(ledger.lockBalance).toHaveBeenCalledWith(expect.anything(), 't1');
      expect(ledger.lockBalance.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.generationIntent.updateMany.mock.invocationCallOrder[0]);
      // 写1：守卫式 CAS 二次判龄 + creditsConsumed>0 语义条件 + 归零（退款后同 intentId 重试 ⇒ consume CAS 门 where creditsConsumed:0 重开——F13 补强锚）
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING', heartbeatAt: { lt: expect.any(Date) }, creditsConsumed: { gt: 0 } },
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: expect.any(Date) },
      });
      // 写2：refund mutate（真值表 (+c,0)+reversesId 配对原 settle 行——Z6 反向记账轴）
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'refund', creditType: 'regular',
        balanceDelta: 10, frozenDelta: 0, referenceId: 'intent:gi-1', reversesId: 'tx-1',
      });
      // Y0b-2 T0：monthlyUsed 派生化——无列回滚写点（refund 落行即回落）
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('③ 未扣 → VOIDED 免费放行（守卫同款），零退款流水', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ creditsConsumed: 0 })]);
      prisma.$queryRaw.mockResolvedValue([]); // 无扣费流水

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING', heartbeatAt: { lt: expect.any(Date) } },
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: expect.any(Date) },
      });
      expect(ledger.mutate).not.toHaveBeenCalled();
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('④ 退款幂等：同孤儿连续两轮，第二轮守卫 count=0 → 零新增流水零回滚', async () => {
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      prisma.generationIntent.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
      // 两轮都扫到同一行（崩溃重扫窗口：行读在前、退款提交在后的竞态模拟）
      prisma.generationIntent.findMany.mockResolvedValue([intent()]);

      await service.verifyActive();
      await service.verifyActive();

      expect(ledger.mutate).toHaveBeenCalledTimes(1); // 只第一轮退
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled(); // Y0b-2 T0：无列回滚写点
    });

    it('⑦ 退款两池拆分：refund mutate 金额=原流水 credits/subscriptionCredits 各自值（非 creditsConsumed 单值）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ creditsConsumed: 10 })]);
      prisma.$queryRaw.mockResolvedValue([
        chargeRow({ id: 'tx-s', amount: -3, creditType: 'subscription', balanceAfter: 47 }),
        chargeRow({ id: 'tx-r', amount: -7, creditType: 'regular', balanceAfter: 93 }),
      ]);
      prisma.generationIntent.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.verifyActive();

      // 两池各自 refund mutate（reversesId 配对原行——事务内重读口径一致）
      expect(ledger.mutate).toHaveBeenCalledTimes(2);
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        type: 'refund', creditType: 'subscription', balanceDelta: 3, reversesId: 'tx-s',
      }));
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        type: 'refund', creditType: 'regular', balanceDelta: 7, reversesId: 'tx-r',
      }));
      // Y0b-2 T0：monthlyUsed 派生化——无列回滚写点
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('⑥ rearm 竞态：heartbeatAt 新鲜的 RUNNING 行守卫 count=0 → 零动作（where 含 heartbeatAt lt——Y0b-2 T4 判据）', async () => {
      // 竞态模拟：扫描捕获行后、三查执行前，rearm/外呼 tick 刷新了 heartbeatAt
      prisma.generationIntent.findMany.mockResolvedValue([intent({ heartbeatAt: new Date() })]);
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 }); // 真库行为：新鲜行不匹配 where

      await service.verifyActive();

      const where = prisma.generationIntent.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({ id: 'gi-1', status: 'RUNNING', heartbeatAt: { lt: expect.any(Date) }, creditsConsumed: { gt: 0 } });
      expect(ledger.mutate).not.toHaveBeenCalled();
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('批0.5-9 ② reserve-only（有 reserve 无 settle）超龄 → 解冻非补记：VOIDED+reservedCredits 归零+release 冲销 mutate（reversesId 配对）——Y0b-2 T0：monthlyUsed 已派生无列回滚写点', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ reservedCredits: 10 })]); // reserve 后进程死
      // $queryRaw 按查询域分派：三查 chargeRows（SELECT r.* …）命中；Z11 孤儿巡检查询（SELECT r.id …）空——非本测试域
      prisma.$queryRaw.mockImplementation(async (tpl: any) => (String(tpl?.[0]).includes('r.*') ? [reserveRow()] : []));
      prisma.generationIntent.updateMany.mockResolvedValueOnce({ count: 1 }); // 守卫 CAS 拿到执行权

      await service.verifyActive();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Z13 锁序①：lockBalance 先于守卫 CAS
      expect(ledger.lockBalance.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.generationIntent.updateMany.mock.invocationCallOrder[0]);
      // 守卫 CAS 判龄 + reservedCredits>0 语义条件 + 归零（重试重 reserve 的 CAS 锚复位——约束①闭环）
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING', heartbeatAt: { lt: expect.any(Date) }, reservedCredits: { gt: 0 } },
        data: { status: 'VOIDED', reservedCredits: 0, completedAt: expect.any(Date) },
      });
      // release 冲销 mutate——约束②锚：type=release 非 refund（真值表 (+c,−c)+reversesId 配对原 reserve 行）
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), {
        teamId: 't1', operatorUserId: 'u1', type: 'release', creditType: 'regular',
        balanceDelta: 10, frozenDelta: -10, referenceId: 'intent:gi-1', reversesId: 'tx-r1',
      });
      // Y0b-2 T0：monthlyUsed 派生化——无列回滚写点
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('批0.5-9 ① isCharged 两阶段口径：reserve-only + resultRef → SUCCEEDED 回填零退款', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ resultRef: 'm-1', reservedCredits: 10 })]);
      prisma.$queryRaw.mockResolvedValue([reserveRow()]);

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING' },
        data: { status: 'SUCCEEDED', completedAt: expect.any(Date) },
      });
      expect(ledger.mutate).not.toHaveBeenCalled();
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('批0.5-9 ② settle 后无产物 → refund 正向记账（只按 settle 终态行，reserve 行不计——防双倍回滚；事务内重读只命中 settle）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ creditsConsumed: 10, reservedCredits: 0 })]);
      // 首查（threeCheck）：reserve+settle 都命中；事务内重读（refund）：anti-join 查询只过滤 settle
      prisma.$queryRaw
        .mockResolvedValueOnce([reserveRow(), chargeRow({ id: 'tx-s1', type: 'settle' })])
        .mockResolvedValue([chargeRow({ id: 'tx-s1', type: 'settle' })]);
      prisma.generationIntent.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.verifyActive();

      // 一条 refund（amount=10=settle 行数额；reserve 行是冻结轨迹非终态账）
      expect(ledger.mutate).toHaveBeenCalledTimes(1);
      expect(ledger.mutate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        type: 'refund', balanceDelta: 10, reversesId: 'tx-s1',
      }));
      // Y0b-2 T0：monthlyUsed 派生化——无列回滚写点
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled();
    });

    it('批0.5-9 解冻幂等：同 reserve-only 孤儿连续两轮，第二轮守卫 count=0 → 零新增流水零回滚（崩溃重扫不双解冻）', async () => {
      prisma.$queryRaw.mockResolvedValue([reserveRow()]);
      prisma.generationIntent.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
      prisma.generationIntent.findMany.mockResolvedValue([intent({ reservedCredits: 10 })]);

      await service.verifyActive();
      await service.verifyActive();

      expect(ledger.mutate).toHaveBeenCalledTimes(1); // 只第一轮解冻
      expect(prisma.teamMember.updateMany).not.toHaveBeenCalled(); // Y0b-2 T0：无列回滚写点
    });
  });

  describe('A 路径：有 jobId 查 BullMQ 真实状态', () => {
    it('job completed → SUCCEEDED 回填（resultRef 取 returnvalue.results 本节点条目）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-1' })]);
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { success: true, errors: [], results: [{ nodeId: 'n1', type: 'image', resultUrl: 'http://x/a.png' }] },
      });

      await service.verifyActive();

      expect(queue.getJob).toHaveBeenCalledWith('job-1');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING' },
        data: { status: 'SUCCEEDED', resultRef: 'http://x/a.png', completedAt: expect.any(Date) },
      });
    });

    it('job completed 但无本节点产物条目 → resultRef 留 null 回填', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-1' })]);
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { success: true, errors: [], results: [{ nodeId: 'other', resultUrl: 'http://x/b.png' }] },
      });

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING' },
        data: { status: 'SUCCEEDED', resultRef: null, completedAt: expect.any(Date) },
      });
    });

    it('job failed → 走三查（已扣无产物 → 退款发生）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-1' })]);
      queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('failed'), returnvalue: null });
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      prisma.generationIntent.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: expect.any(Date) },
      }));
      expect(ledger.mutate).toHaveBeenCalledTimes(1);
    });

    it('job 不存在（removeOnComplete 清理歧义）→ 也走三查，禁"不存在即判死"单查', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-gone', creditsConsumed: 0 })]);
      queue.getJob.mockResolvedValue(undefined);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.verifyActive();

      expect(queue.getJob).toHaveBeenCalledWith('job-gone');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: expect.any(Date) },
      }));
    });

    it('job active（长任务合法在飞）→ 零动作不误杀', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-2' })]);
      queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('active'), returnvalue: null });

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
      // 三查未进入——$queryRaw 仅 Z11 孤儿巡检（SELECT r.id …）合法在场，chargeRows 形态（SELECT r.* …）零命中
      expect(prisma.$queryRaw.mock.calls.filter((c: any[]) => String(c[0]?.[0]).includes('r.*'))).toHaveLength(0);
    });
  });

  describe('A 路径 kind 路由（attachJob 盲区另一半——他队列 job 在 execution 队列查得 null，禁误落三查误杀长任务）', () => {
    it("kind='lighting' 有 jobId → 路由 ai-image-edit 队列（lighting 与 outpaint/erase/redraw 同队列）且 active → 零动作（20min 打光任务第 15min 防误杀锚）", async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ kind: 'lighting', jobId: 'job-l' })]);
      imageEditQueue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('active'), returnvalue: null });

      await service.verifyActive();

      expect(imageEditQueue.getJob).toHaveBeenCalledWith('job-l');
      expect(queue.getJob).not.toHaveBeenCalled(); // execution 队列不被查——kind 已路由
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
      // 三查未进入——$queryRaw 仅 Z11 孤儿巡检（SELECT r.id …）合法在场，chargeRows 形态（SELECT r.* …）零命中
      expect(prisma.$queryRaw.mock.calls.filter((c: any[]) => String(c[0]?.[0]).includes('r.*'))).toHaveLength(0);
    });

    it("kind='outpaint' → ai-image-edit 队列 completed → SUCCEEDED 回填（resultRef 取 returnvalue.fileId——ai-image-edit 产物形状）", async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ kind: 'outpaint', jobId: 'job-o' })]);
      imageEditQueue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { status: 'completed', fileId: 'm-9' },
      });

      await service.verifyActive();

      expect(imageEditQueue.getJob).toHaveBeenCalledWith('job-o');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: 'RUNNING' },
        data: { status: 'SUCCEEDED', resultRef: 'm-9', completedAt: expect.any(Date) },
      });
    });

    it('kind 不在路由表（防御）→ 不猜队列，告警+落三查（未扣 → VOIDED 免费放行）', async () => {
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      prisma.generationIntent.findMany.mockResolvedValue([intent({ kind: 'weird', jobId: 'job-x', creditsConsumed: 0 })]);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.verifyActive();

      expect(queue.getJob).not.toHaveBeenCalled();
      expect(imageEditQueue.getJob).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('weird'));
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: expect.any(Date) },
      }));
      warnSpy.mockRestore();
    });
  });

  describe('档二 reconcileDaily', () => {
    it('三方对账：creditsConsumed 与流水数额不一致 → 告警带 intentId（资损前兆）', async () => {
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      prisma.generationIntent.findMany.mockResolvedValue([{ id: 'gi-1', intentId: 'i1', creditsConsumed: 10 }]);   // Y0b-1 锚切换：台账锚=intentRowId
      prisma.teamCreditTransaction.findMany.mockResolvedValue([chargeRow({ amount: -6 })]); // 流水只有 6 ≠ 10

      await service.reconcileDaily();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('i1'));
      warnSpy.mockRestore();
    });

    it('三方对账：数额一致 → 零告警', async () => {
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      prisma.generationIntent.findMany.mockResolvedValue([{ id: 'gi-1', intentId: 'i1', creditsConsumed: 10 }]);
      prisma.teamCreditTransaction.findMany.mockResolvedValue([chargeRow({ amount: -10 })]);

      await service.reconcileDaily();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('批0.5-9 三方对账：settle 流水计入终态消费（reserve 行不计——防 2 倍差异误报）', async () => {
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      prisma.generationIntent.findMany.mockResolvedValue([{ id: 'gi-1', intentId: 'i1', creditsConsumed: 10 }]);
      // mock 按 where.type.in 过滤——真库语义：查询只命中 settle，reserve 行被排除
      prisma.teamCreditTransaction.findMany.mockImplementation(async ({ where }: any) => {
        const all = [reserveRow(), chargeRow({ id: 'tx-s1', type: 'settle', amount: -10 })];
        return all.filter((r) => !where?.type?.in || where.type.in.includes(r.type));
      });

      await service.reconcileDaily();

      expect(warnSpy).not.toHaveBeenCalled(); // reserve(-10)+settle(-10) 若都计入则 20≠10 误报
      warnSpy.mockRestore();
    });

    it('终态行 7 天保留期清理（F1 保留策略+F7 守卫：冻结未销 reservedCredits>0 禁删）', async () => {
      await service.reconcileDaily();

      expect(prisma.generationIntent.deleteMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['SUCCEEDED', 'FAILED', 'VOIDED'] },
          reservedCredits: 0,
          completedAt: { lt: expect.any(Date) },
        },
      });
      const lt = prisma.generationIntent.deleteMany.mock.calls[0][0].where.completedAt.lt as Date;
      expect(Date.now() - lt.getTime()).toBeGreaterThanOrEqual(7 * 24 * 3600_000 - 1000);
    });

    it('exec map 孤儿清理：nodes 无该 nodeId 的 exec 条目经 withDoc 删除（F2 GC）', async () => {
      prisma.canvasProject.findMany.mockResolvedValue([{ id: 'p1' }]);
      const doc = new Y.Doc();
      doc.getMap('nodes').set('n1', new Y.Map());
      doc.getMap('exec').set('n1', new Y.Map());
      doc.getMap('exec').set('ghost-1', new Y.Map()); // 孤儿：nodes 无此节点
      collabDoc.withDoc.mockImplementation(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));

      await service.reconcileDaily();

      expect(collabDoc.withDoc).toHaveBeenCalledWith('p1', expect.any(Function));
      expect(doc.getMap('exec').get('ghost-1')).toBeUndefined(); // 孤儿已删
      expect(doc.getMap('exec').get('n1')).toBeDefined(); // 在册保留
    });

    it('Y0a-3 V20：withDoc 抛 503（lease 失守）→ 捕获后延后重试——单项目失败不阻塞整批，零意图终态误判', async () => {
      prisma.canvasProject.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      collabDoc.withDoc.mockRejectedValueOnce(
        new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' }),
      );

      await expect(service.reconcileDaily()).resolves.toBeUndefined(); // 503 被捕获——不外抛

      expect(collabDoc.withDoc).toHaveBeenCalledTimes(2); // p1 失败不阻塞 p2（p1 留待下轮=延后重试）
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled(); // 零终态写——未完成投影不被判死
    });

    it('video-separate 陈旧任务对账+并发额度归还（自 video-separate.cron 搬入）', async () => {
      prisma.videoSeparateTask.findMany.mockResolvedValue([{ id: 't1', userId: 'u1' }]);
      redis.exists.mockResolvedValue(1);
      redis.decr.mockResolvedValue(1);

      await service.reconcileDaily();

      expect(prisma.videoSeparateTask.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({ status: 'error', errorType: 'TASK_TIMEOUT' }),
      });
      expect(redis.decr).toHaveBeenCalledWith('user:video-separate:u1');
    });

    it('计数器归还后 <0 → 重置 0（防负数泄漏）', async () => {
      prisma.videoSeparateTask.findMany.mockResolvedValue([{ id: 't1', userId: 'u1' }]);
      redis.exists.mockResolvedValue(1);
      redis.decr.mockResolvedValue(-1);

      await service.reconcileDaily();

      expect(redis.set).toHaveBeenCalledWith('user:video-separate:u1', '0', 'EX', 86400);
    });
  });

  describe('生命周期（R28 纪律：原生 setInterval+unref）', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('onModuleInit 启动即全量扫 + 5min/24h 双档定时', async () => {
      vi.useFakeTimers();
      const verifySpy = vi.spyOn(service, 'verifyActive').mockResolvedValue(undefined);
      const dailySpy = vi.spyOn(service, 'reconcileDaily').mockResolvedValue(undefined);

      service.onModuleInit();
      expect(verifySpy).toHaveBeenCalledTimes(1); // 启动全量扫（覆盖"部署杀在飞任务"）

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(verifySpy).toHaveBeenCalledTimes(2); // 档一 5min

      vi.advanceTimersByTime(24 * 3600 * 1000);
      expect(dailySpy).toHaveBeenCalledTimes(1); // 档二 24h
    });

    it('onApplicationShutdown 停扫（推进时钟零新增调用）', async () => {
      vi.useFakeTimers();
      const verifySpy = vi.spyOn(service, 'verifyActive').mockResolvedValue(undefined);
      vi.spyOn(service, 'reconcileDaily').mockResolvedValue(undefined);

      service.onModuleInit();
      service.onApplicationShutdown();
      vi.advanceTimersByTime(24 * 3600 * 1000);

      expect(verifySpy).toHaveBeenCalledTimes(1); // 仅启动那次，定时器已清
    });
  });
});
