import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ServiceUnavailableException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabWritePort } from '../collab/collab-write.port';
import { CollabDocWriterService } from '../collab/collab-doc-writer.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ArtifactCommitService } from '../artifact-core/artifact-commit.service';
import { EXECUTION_QUEUE_NAME } from './execution.constants';
import { AI_IMAGE_EDIT_QUEUE_NAME } from '../ai-image-edit/ai-image-edit.constants';
import { IntentReconcileService } from './intent-reconcile.service';

/** 构造一行 RUNNING 意图（默认心跳超龄 20min——Y0b-2 T4 判据单源 heartbeatAt；deadlineAt 更旧
 *  （30min 前）⇒ 心跳新于 deadline=轮询活着——deadline 批跳过，本档只测 stale 批收敛） */
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
  traceId: null,
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

describe('IntentReconcileService（F12/F13 两档收敛——T13 R3 重写后语义）', () => {
  let service: IntentReconcileService;
  let prisma: any;
  let ledger: any;
  let teamCredit: any;
  let queue: any;
  let imageEditQueue: any;
  let collabDoc: any;
  let collabWriter: { writeBatch: ReturnType<typeof vi.fn> };
  let artifactCommit: any;
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
      voidInTx: vi.fn().mockResolvedValue(undefined),
      settleInTx: vi.fn().mockResolvedValue({ success: true, settled: true }),
      rollbackStranded: vi.fn().mockResolvedValue(false),
      // Y0b-2 T5（Z92）：收敛② rollbackRunning 委派（内部锁序/冲销形状归 doRollback——真库锚 deliver-refund）
      rollbackRunning: vi.fn().mockResolvedValue(false),
    };
    prisma = {
      generationIntent: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }), count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
      teamCreditTransaction: { findMany: vi.fn().mockResolvedValue([]) },
      teamMember: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      videoSeparateTask: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({}) },
      canvasProject: { findMany: vi.fn().mockResolvedValue([]) },
      nodeArtifact: { findUnique: vi.fn().mockResolvedValue(null) },
      artifactProjection: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      mediaFactOutbox: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), count: vi.fn().mockResolvedValue(0) },
      reconcileAction: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $executeRaw: vi.fn().mockResolvedValue(0),
      // Y0b-1 F1/Z6：chargeRows 改 anti-join $queryRaw（未被冲销行）；mock 默认零命中
      $queryRaw: vi.fn().mockResolvedValue([]),
      // 退款/解冻事务+R3 advisory 锁事务：mock 透传 tx=prisma 直执回调（team-credit.service.spec 同款）
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    };
    queue = { getJob: vi.fn().mockResolvedValue(null) };
    imageEditQueue = { getJob: vi.fn().mockResolvedValue(null) };
    // Y0b-2 T5（Z106/Z112）：reaper 投影分治消费面——isDocResident+writeExecStatus 可断言
    collabDoc = { withDoc: vi.fn(), isDocResident: vi.fn(() => true), writeExecStatus: vi.fn().mockResolvedValue(undefined) };
    // Y0c T12：sweepOrphanExec 改道 writeBatch——writer stub（结果断言在 writer spec 真判据，此处只断言改道）
    collabWriter = { writeBatch: vi.fn().mockResolvedValue([{ index: 0, op: 'deleteExecOrphans', written: true }]) };
    // T13 R3：动作表单入口 stub——默认 not-recoverable（stale RUNNING 无 stage 行——charge 剩余分支承接）
    artifactCommit = {
      finalizeFromExistingMediaOrText: vi.fn().mockResolvedValue({ action: 'not-recoverable' }),
      finalizeFromStage: vi.fn().mockResolvedValue({ outcome: 'committed' }),
    };
    redis = { exists: vi.fn().mockResolvedValue(0), decr: vi.fn().mockResolvedValue(0), set: vi.fn().mockResolvedValue('OK') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentReconcileService,
        { provide: PrismaService, useValue: prisma },
        { provide: CollabWritePort, useValue: collabDoc },
        { provide: CollabDocWriterService, useValue: collabWriter },
        { provide: CreditLedgerService, useValue: ledger },
        { provide: TeamCreditService, useValue: teamCredit },
        { provide: getQueueToken(EXECUTION_QUEUE_NAME), useValue: queue },
        { provide: getQueueToken(AI_IMAGE_EDIT_QUEUE_NAME), useValue: imageEditQueue },
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: ArtifactCommitService, useValue: artifactCommit },
      ],
    }).compile();
    service = module.get(IntentReconcileService);
  });

  describe('档一 verifyActive 扫描谓词+charge 剩余分支（resultRef 判族已删——T13 谎言链根修）', () => {
    it('扫描谓词锚：status=RUNNING 且 heartbeatAt<15min 截止（Y0b-2 T4 判据单源；deadline 批谓词=deadlineAt<now 先跑）', async () => {
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

    it('红·resultRef 判族删除：已扣+resultRef 非空（旧①分支=无条件 SUCCEEDED 回填的谎言链）⇒ 不回填——rollbackRunning 冲销（P2-③ 根修）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ resultRef: 'http://x/backfill-lie.png' })]);
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      teamCredit.rollbackRunning.mockResolvedValueOnce(true);

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }));   // 旧①「RUNNING→SUCCEEDED 回填」不再发生
      expect(teamCredit.rollbackRunning).toHaveBeenCalledWith('gi-1', expect.stringContaining('INTENT_STALE_REAPED'), expect.any(Date));
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('② 已扣无产物（R3 not-recoverable——无 stage 行）→ rollbackRunning 委派+投影分治', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent()]);
      // $queryRaw 按查询域分派：chargeRows（SELECT r.* …）命中；Z11 孤儿巡检查询（SELECT r.id …）空——非本测试域
      prisma.$queryRaw.mockImplementation(async (tpl: any) => (String(tpl?.[0]).includes('r.*') ? [chargeRow()] : []));
      teamCredit.rollbackRunning.mockResolvedValueOnce(true); // 冲销拿到执行权

      await service.verifyActive();

      expect(teamCredit.rollbackRunning).toHaveBeenCalledWith('gi-1', expect.stringContaining('INTENT_STALE_REAPED'), expect.any(Date));
      expect(ledger.mutate).not.toHaveBeenCalled(); // reconcile 零直写台账（Z92：单入口收敛）
      expect(collabDoc.writeExecStatus).toHaveBeenCalledWith('p1', 'n1', expect.objectContaining({
        status: 'error', errorCode: 'INTENT_STALE_REAPED', rearmable: true, attempts: 1,
      }));
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
    });

    it('④ 冲销幂等：同孤儿连续两轮，第二轮 CAS 未命中（false）→ 零重复投影零台账直写', async () => {
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      teamCredit.rollbackRunning.mockResolvedValueOnce(true).mockResolvedValue(false);
      prisma.generationIntent.findMany.mockResolvedValue([intent()]);

      await service.verifyActive();
      await service.verifyActive();

      expect(collabDoc.writeExecStatus).toHaveBeenCalledTimes(1); // 只第一轮投影（冲销成功侧）
      expect(ledger.mutate).not.toHaveBeenCalled();
    });

    it('⑥ rearm 竞态：heartbeatAt 新鲜的 RUNNING 行 → rollbackRunning CAS 判龄未命中（false）→ 零动作零投影', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ heartbeatAt: new Date() })]);
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      teamCredit.rollbackRunning.mockResolvedValue(false);

      await service.verifyActive();

      expect(teamCredit.rollbackRunning).toHaveBeenCalledWith('gi-1', expect.any(String), expect.any(Date));
      expect(collabDoc.writeExecStatus).not.toHaveBeenCalled();
    });

    it('批0.5-9 ② reserve-only（有 reserve 无 settle）超龄 → 同一 rollbackRunning 委派', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ reservedCredits: 10 })]);
      prisma.$queryRaw.mockImplementation(async (tpl: any) => (String(tpl?.[0]).includes('r.*') ? [reserveRow()] : []));
      teamCredit.rollbackRunning.mockResolvedValueOnce(true);

      await service.verifyActive();

      expect(teamCredit.rollbackRunning).toHaveBeenCalledWith('gi-1', expect.any(String), expect.any(Date));
      expect(ledger.mutate).not.toHaveBeenCalled();
    });
  });

  describe('A 路径：有 jobId 查 BullMQ 真实状态（T13：completed 不再回填——统一 PG 收敛）', () => {
    it('红·backfillSucceeded 删除：job completed ⇒ 不写 SUCCEEDED+resultRef（returnvalue 不再是回填源——谎言链根修）→ R3+charge 收敛（已扣→rollbackRunning）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-1' })]);
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { success: true, errors: [], results: [{ nodeId: 'n1', type: 'image', resultUrl: 'http://x/a.png' }] },
      });
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      teamCredit.rollbackRunning.mockResolvedValueOnce(true);

      await service.verifyActive();

      expect(queue.getJob).toHaveBeenCalledWith('job-1');
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }));   // 回填面删除
      expect(teamCredit.rollbackRunning).toHaveBeenCalledWith('gi-1', expect.stringContaining('INTENT_STALE_REAPED'), expect.any(Date));
    });

    it('job completed∧未扣 → VOIDED 免费放行（R3 not-recoverable+charge 空）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-1', creditsConsumed: 0 })]);
      queue.getJob.mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        returnvalue: { success: true, errors: [], results: [] },
      });
      prisma.$queryRaw.mockResolvedValue([]);

      await service.verifyActive();

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { status: 'VOIDED', creditsConsumed: 0, completedAt: expect.any(Date) },
      }));
    });

    it('R3 stage 收敛优先：job completed 但 R3 判 stage 行在（finalize-from-stage）→ charge 分支不进（provider 不重调）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-1', execSeq: 1n })]);
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'gi-1', intentId: 'i1', status: 'RUNNING', execSeq: 1n, reservedCredits: 10, creditsConsumed: 0, creditCost: 10, traceId: null });
      queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('completed'), returnvalue: null });
      artifactCommit.finalizeFromExistingMediaOrText.mockResolvedValueOnce({
        action: 'finalize-from-stage',
        stage: { intentRowId: 'gi-1', execSeq: '5', sourceUrl: 'http://provider/ok.png', projectId: 'p1', nodeId: 'n1', teamId: 't1', userId: 'u1', kind: 'image', sourceMimeType: null },
      });

      await service.verifyActive();

      expect(artifactCommit.finalizeFromStage).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'http://provider/ok.png', intentRowId: 'gi-1' }));
      expect(teamCredit.rollbackRunning).not.toHaveBeenCalled();   // R3 已收敛——charge 分支不进
    });

    it('job failed → 同一收敛（已扣无产物 → rollbackRunning 冲销委派）', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ jobId: 'job-1' })]);
      queue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('failed'), returnvalue: null });
      prisma.$queryRaw.mockResolvedValue([chargeRow()]);
      teamCredit.rollbackRunning.mockResolvedValueOnce(true);

      await service.verifyActive();

      expect(teamCredit.rollbackRunning).toHaveBeenCalledWith('gi-1', expect.stringContaining('INTENT_STALE_REAPED'), expect.any(Date));
    });

    it('job 不存在（removeOnComplete 清理歧义）→ 也走收敛，禁"不存在即判死"单查', async () => {
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
      // 收敛未进入——$queryRaw 仅 Z11 孤儿巡检（SELECT r.id …）合法在场，chargeRows 形态（SELECT r.* …）零命中
      expect(prisma.$queryRaw.mock.calls.filter((c: any[]) => String(c[0]?.[0]).includes('r.*'))).toHaveLength(0);
    });
  });

  describe('A 路径 kind 路由（attachJob 盲区另一半）', () => {
    it("kind='lighting' 有 jobId → 路由 ai-image-edit 队列且 active → 零动作（20min 打光任务第 15min 防误杀锚）", async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ kind: 'lighting', jobId: 'job-l' })]);
      imageEditQueue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue('active'), returnvalue: null });

      await service.verifyActive();

      expect(imageEditQueue.getJob).toHaveBeenCalledWith('job-l');
      expect(queue.getJob).not.toHaveBeenCalled(); // execution 队列不被查——kind 已路由
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
    });

    it('kind 不在路由表（防御）→ 不猜队列，告警+落收敛（未扣 → VOIDED 免费放行）', async () => {
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

  describe('T13 R3 reconcileOneIntent（advisory lock+审计行+auto/manual 分计数）', () => {
    it('settle-backfill（acted）→ 锁内审计行（reconcileAction.create 同事务）+计数；!acted（并发已抢）→ 零审计', async () => {
      prisma.generationIntent.findMany.mockResolvedValue([intent({ status: 'SUCCEEDED', reservedCredits: 10, creditsConsumed: 0, completedAt: new Date(Date.now() - 20 * 60_000) })]);
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'gi-1', intentId: 'i1', status: 'SUCCEEDED', execSeq: 1n, reservedCredits: 10, creditsConsumed: 0, creditCost: 10, traceId: 'tr-1' });
      artifactCommit.finalizeFromExistingMediaOrText.mockResolvedValueOnce({ action: 'settle-backfill', acted: true });
      teamCredit.settleInTx.mockResolvedValueOnce({ success: true, settled: true });

      await (service as any).reconcileOneIntent('gi-1', 1n);

      // 补核销在 finalizeFromExistingMediaOrText 事务内（真链锚 int spec）；本面断言=动作表入口+审计行
      expect(artifactCommit.finalizeFromExistingMediaOrText).toHaveBeenCalledWith(expect.anything(), 'gi-1', 1n);
      expect(prisma.reconcileAction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ intentRowId: 'gi-1', action: 'settle-backfill', traceId: 'tr-1' }),
      }));

      // 并发败者（settled:false——幂等未达）：零审计
      prisma.reconcileAction.create.mockClear();
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'gi-1', intentId: 'i1', status: 'SUCCEEDED', execSeq: 1n, reservedCredits: 10, creditsConsumed: 0, creditCost: 10, traceId: null });
      artifactCommit.finalizeFromExistingMediaOrText.mockResolvedValueOnce({ action: 'settle-backfill', acted: false });
      teamCredit.settleInTx.mockResolvedValueOnce({ success: true, settled: false });
      await (service as any).reconcileOneIntent('gi-1', 1n);
      expect(prisma.reconcileAction.create).not.toHaveBeenCalled();
    });

    it('void-terminal → 锁内 voidInTx+审计；manual-required → 不动钱（voidInTx 零调用）+审计', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue({ id: 'gi-1', intentId: 'i1', status: 'FAILED', execSeq: 1n, reservedCredits: 5, creditsConsumed: 0, creditCost: 5, traceId: null });
      artifactCommit.finalizeFromExistingMediaOrText.mockResolvedValueOnce({ action: 'void-terminal' });
      await (service as any).reconcileOneIntent('gi-1', 1n);
      expect(teamCredit.voidInTx).toHaveBeenCalledWith(expect.anything(), { intentRowId: 'gi-1', execSeq: 1n });
      expect(prisma.reconcileAction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'void-terminal' }),
      }));

      teamCredit.voidInTx.mockClear();
      prisma.reconcileAction.create.mockClear();
      artifactCommit.finalizeFromExistingMediaOrText.mockResolvedValueOnce({ action: 'manual-required', reason: 'FAILED/VOIDED 带 NodeArtifact 锚行' });
      await (service as any).reconcileOneIntent('gi-1', 1n);
      expect(teamCredit.voidInTx).not.toHaveBeenCalled();   // 歧义态不动钱（裁决 :27④）
      expect(prisma.reconcileAction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'manual-required' }),
      }));
    });

    it('advisory lock 面：每行收敛事务首句 pg_advisory_xact_lock(hashtext(intentRowId))——行灭失早退亦已取锁', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);   // 行灭失——早退
      await (service as any).reconcileOneIntent('gi-gone', 1n);
      const advisoryCalled = prisma.$executeRaw.mock.calls.some((c: any[]) => String(c[0]?.[0] ?? c[0]).includes('pg_advisory_xact_lock'));
      expect(advisoryCalled).toBe(true);
    });
  });

  describe('档二 reconcileDaily', () => {
    it('三方对账：creditsConsumed 与流水数额不一致 → 告警带 intentId（资损前兆）', async () => {
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      prisma.generationIntent.findMany.mockResolvedValue([{ id: 'gi-1', intentId: 'i1', creditsConsumed: 10 }]);
      prisma.teamCreditTransaction.findMany.mockResolvedValue([chargeRow({ amount: -6 })]);

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
      prisma.teamCreditTransaction.findMany.mockImplementation(async ({ where }: any) => {
        const all = [reserveRow(), chargeRow({ id: 'tx-s1', type: 'settle', amount: -10 })];
        return all.filter((r) => !where?.type?.in || where.type.in.includes(r.type));
      });

      await service.reconcileDaily();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('T13 保留矩阵：cleanTerminalIntents=raw DELETE（resultText 非空 90d 例外+NodeArtifact 锚行 NOT EXISTS 守护+冻结未销禁删计数）', async () => {
      await service.reconcileDaily();

      expect(prisma.generationIntent.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['SUCCEEDED', 'FAILED', 'VOIDED'] }, reservedCredits: { gt: 0 } }),
      }));   // F7 守卫（stranded 计数）
      const sqlText = (c: any[]) => (Array.isArray(c[0]) ? (c[0] as string[]).join('₇') : String(c[0]));   // Prisma tagged template=chunk 数组（插值分段——join 后全文匹配）
      const del = prisma.$executeRaw.mock.calls.map(sqlText).find((t: string) => t.includes('DELETE FROM "GenerationIntent"'));
      expect(del).toBeTruthy();
      expect(del).toContain('NOT EXISTS (SELECT 1 FROM "NodeArtifact" na WHERE na."sourceIntentRowId" = gi.id)');   // 有 artifact 的 intent 不物理删
      expect(del).toContain('"resultText" IS NOT NULL AND gi."completedAt" <');   // text 90d 例外面
      expect(del).toContain('"reservedCredits" = 0');   // 冻结未销禁删
    });

    it('T13 保留矩阵：projection 终态 30d/outbox published 7d 清理+dead-letter 告警计数', async () => {
      prisma.mediaFactOutbox.count.mockResolvedValueOnce(3);
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
      await service.reconcileDaily();

      expect(prisma.artifactProjection.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ state: { in: ['projected', 'orphaned', 'superseded', 'dead'] } }),
      }));
      expect(prisma.mediaFactOutbox.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ state: 'published' }),
      }));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dead-letter'));
      warnSpy.mockRestore();
    });

    it('红·Y0c T12 sweepOrphanExec 改道 writeBatch：逐项目 collabWriter.writeBatch([{op:deleteExecOrphans}]) 单点，直写收编后 withDoc 零触达', async () => {
      prisma.canvasProject.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      await (service as any).sweepOrphanExec();

      expect(collabWriter.writeBatch).toHaveBeenCalledTimes(2);
      expect(collabWriter.writeBatch).toHaveBeenNthCalledWith(1, 'p1', [{ op: 'deleteExecOrphans' }]);
      expect(collabWriter.writeBatch).toHaveBeenNthCalledWith(2, 'p2', [{ op: 'deleteExecOrphans' }]);
      expect(collabDoc.withDoc).not.toHaveBeenCalled();           // 直写收编后 withDoc 零触达
    });

    it('红·Y0c T11 Z56 游标轮转：满页推进游标/不足页回卷', async () => {
      prisma.canvasProject.findMany
        .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({ id: `p${String(i).padStart(3, '0')}` })))
        .mockResolvedValueOnce([{ id: 'pA' }, { id: 'pB' }])
        .mockResolvedValueOnce([]);

      await (service as any).sweepOrphanExec();
      await (service as any).sweepOrphanExec();
      await (service as any).sweepOrphanExec();

      const calls = prisma.canvasProject.findMany.mock.calls;
      expect(calls[0][0]).toEqual({ select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
      expect(calls[1][0]).toEqual({ where: { id: { gt: 'p099' } }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
      expect(calls[2][0]).toEqual({ select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
    });

    it('Y0a-3 V20：writeBatch 抛 503（lease 失守）→ 捕获后延后重试——单项目失败不阻塞整批', async () => {
      prisma.canvasProject.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      collabWriter.writeBatch.mockRejectedValueOnce(
        new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'collab not serving' }),
      );

      await expect(service.reconcileDaily()).resolves.toBeUndefined();

      expect(collabWriter.writeBatch).toHaveBeenCalledTimes(2);
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
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
