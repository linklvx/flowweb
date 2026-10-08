import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerationIntentService,
  NodeBusyError,
  IntentContextMismatchError,
  IntentExhaustedError,
} from './generation-intent.service';

/** 构造一行 GenerationIntent（默认值=RUNNING 在飞，覆盖式调整） */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'gi-1',
  projectId: 'p1',
  nodeId: 'n1',
  userId: 'u1',
  teamId: 'team-1',
  intentId: 'i1',
  kind: 'image',
  paramsHash: 'h1',
  status: 'RUNNING',
  jobId: null,
  pricingRuleId: 'pr1',
  modelId: 'm1',
  resolutionId: null,
  durationId: null,
  creditCost: 1,
  creditsConsumed: 0,
  attempts: 1,
  resultRef: null,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  ...over,
});

/** claim 输入（默认与 row 同上下文；Y0b-1：pricing/teamId 必填——固化入参） */
const input = (over: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  nodeId: 'n1',
  userId: 'u1',
  intentId: 'i1',
  kind: 'image',
  paramsHash: 'h1',
  teamId: 'team-1',
  pricing: { pricingRuleId: 'pr1', modelId: 'm1', resolutionId: null, durationId: null, creditCost: 1 },
  ...over,
});

describe('GenerationIntentService claim 状态机（F13）', () => {
  let service: GenerationIntentService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      generationIntent: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        createMany: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      // Y0b-1（Z26/Z33）：claim 交互式事务——mock 直通（tx=同一 mock 对象）
      $transaction: vi.fn((fn: (tx: any) => Promise<unknown>) => fn(prisma)),
      // Z26 准入谓词：FOR SHARE 查 Team.status——默认 ACTIVE 放行
      $queryRaw: vi.fn().mockResolvedValue([{ status: 'ACTIVE' }]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenerationIntentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(GenerationIntentService);
  });

  describe('Y0b-1（E1/Z26）：claim 无条件固化 + 团队准入谓词', () => {
    it('E1：creditCost:0 也固化——createMany data 带五字段快照+teamId，skipDuplicates 形态（Z33）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      const created = row({ creditCost: 0, pricingRuleId: 'pr1', modelId: 'm1' });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(created);

      const r = await service.claim(input({ pricing: { pricingRuleId: 'pr1', modelId: 'm1', resolutionId: null, durationId: null, creditCost: 0 } }));

      expect(r.created).toBe(true);
      expect(r.intent).toBe(created);
      expect(prisma.generationIntent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          projectId: 'p1', nodeId: 'n1', userId: 'u1', intentId: 'i1',
          kind: 'image', paramsHash: 'h1', jobId: null, status: 'RUNNING',
          teamId: 'team-1',
          pricingRuleId: 'pr1', modelId: 'm1', resolutionId: null, durationId: null, creditCost: 0,
        })],
        skipDuplicates: true,
      });
    });

    it('pricing 缺省 ⇒ 编译期即拒（必填参数——无条件固化由类型保证非运行时约定）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(row());
      await expect(
        // @ts-expect-error pricing 必填——缺省即类型错误（tsc --noEmit 红相=本用例红相）
        service.claim({ projectId: 'p1', nodeId: 'n1', userId: 'u1', intentId: 'i1', kind: 'image', paramsHash: 'h1', teamId: 'team-1' }),
      ).rejects.toThrow(); // 运行时：pricing undefined → 固化字段访问 TypeError → 拒绝（无静默免费路径）
    });

    it('Z26：团队非 ACTIVE（FOR SHARE 谓词）⇒ TEAM_CLOSED 409——零意图行写入', async () => {
      prisma.$queryRaw.mockResolvedValue([{ status: 'DISBANDED' }]);
      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'TEAM_CLOSED',
        status: HttpStatus.CONFLICT,
      });
      expect(prisma.generationIntent.createMany).not.toHaveBeenCalled();
    });
  });

  describe('① 无行 → create RUNNING = 新执行权', () => {
    it('findUnique 空 → createMany RUNNING（skipDuplicates）→ created:true', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      const created = row({ id: 'gi-new' });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(created);

      const r = await service.claim(input());

      expect(r.created).toBe(true);
      expect(r.intent).toBe(created);
      expect(prisma.generationIntent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          projectId: 'p1', nodeId: 'n1', userId: 'u1', intentId: 'i1',
          kind: 'image', paramsHash: 'h1', jobId: null, status: 'RUNNING',
        })],
        skipDuplicates: true,
      });
    });

    it('带 jobId → createMany data 写入 jobId', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.createMany.mockResolvedValue({ count: 1 });
      prisma.generationIntent.findUniqueOrThrow.mockResolvedValue(row({ jobId: 'job-9' }));

      await service.claim(input({ jobId: 'job-9' }));

      expect(prisma.generationIntent.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ jobId: 'job-9', status: 'RUNNING' })],
        skipDuplicates: true,
      });
    });
  });

  describe('② RUNNING 同 jobId → 可重入续跑（stalled 重排不自锁）', () => {
    it('input.jobId 与 existing.jobId 相等 → created:true 且不写库', async () => {
      const existing = row({ status: 'RUNNING', jobId: 'job-1' });
      prisma.generationIntent.findUnique.mockResolvedValue(existing);

      const r = await service.claim(input({ jobId: 'job-1' }));

      expect(r.created).toBe(true);
      expect(r.intent).toBe(existing);
      expect(prisma.generationIntent.create).not.toHaveBeenCalled();
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('③ RUNNING 异 jobId → NodeBusy（双击互斥）', () => {
    it('异 jobId → NODE_BUSY 409', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(row({ status: 'RUNNING', jobId: 'job-1' }));

      await expect(service.claim(input({ jobId: 'job-2' }))).rejects.toMatchObject({
        errorCode: 'NODE_BUSY',
        status: HttpStatus.CONFLICT,
      });
      await expect(service.claim(input({ jobId: 'job-2' }))).rejects.toBeInstanceOf(NodeBusyError);
    });

    it('无 jobId（同步路径双击）→ NODE_BUSY 默认文案', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(row({ status: 'RUNNING', jobId: null }));

      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'NODE_BUSY',
        message: '该节点正在生成中',
      });
    });

    it('updatedAt 龄 >10min（同步孤儿）→ 回收窗口文案分义', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(
        row({ status: 'RUNNING', jobId: null, updatedAt: new Date(Date.now() - 11 * 60_000) }),
      );

      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'NODE_BUSY',
        message: '系统回收中（约 15 分钟），请稍后重试',
      });
    });
  });

  describe('④ FAILED/VOIDED 同上下文 → 守卫式原子再激活', () => {
    it.each([['FAILED'], ['VOIDED']])('%s 且 count===1 → created:true + attempts 自增', async (status) => {
      const existing = row({ status, attempts: 1, jobId: 'job-old', error: 'x', completedAt: new Date() });
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(existing) // claim 首查
        .mockResolvedValueOnce(row({ status: 'RUNNING', attempts: 2, jobId: 'job-1', error: null, completedAt: null })); // rearm 后回读
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      const r = await service.claim(input({ jobId: 'job-1' }));

      expect(r.created).toBe(true);
      expect(r.intent.attempts).toBe(2);
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: existing.id, status: { in: ['FAILED', 'VOIDED'] } },
        data: {
          status: 'RUNNING',
          error: null,
          jobId: 'job-1',
          completedAt: null,
          attempts: { increment: 1 },
        },
      });
    });

    it('并发抢走（count===0）→ NodeBusy', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(row({ status: 'FAILED' }));
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.claim(input())).rejects.toMatchObject({ errorCode: 'NODE_BUSY' });
    });
  });

  describe('⑤ SUCCEEDED 同上下文 → created:false 幂等重放', () => {
    it('返回既有行（含 resultRef），零外呼零写库', async () => {
      const existing = row({ status: 'SUCCEEDED', resultRef: 'media-123' });
      prisma.generationIntent.findUnique.mockResolvedValue(existing);

      const r = await service.claim(input());

      expect(r.created).toBe(false);
      expect(r.intent.resultRef).toBe('media-123');
      expect(prisma.generationIntent.create).not.toHaveBeenCalled();
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('⑥ attempts≥3 的 FAILED/VOIDED → INTENT_EXHAUSTED', () => {
    it.each([['FAILED'], ['VOIDED']])('%s attempts=3 → 409 且不再激活', async (status) => {
      prisma.generationIntent.findUnique.mockResolvedValue(row({ status, attempts: 3 }));

      await expect(service.claim(input())).rejects.toBeInstanceOf(IntentExhaustedError);
      await expect(service.claim(input())).rejects.toMatchObject({
        errorCode: 'INTENT_EXHAUSTED',
        status: HttpStatus.CONFLICT,
      });
      expect(prisma.generationIntent.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('①→异上下文：同 intentId 上下文不匹配 → 409 INTENT_CONTEXT_MISMATCH', () => {
    it.each([
      ['nodeId 漂移', { nodeId: 'n2' }],
      ['kind 漂移', { kind: 'redraw' }],
      ['paramsHash 漂移（客户端改参复用 intentId）', { paramsHash: 'h2' }],
    ])('%s → INTENT_CONTEXT_MISMATCH 409（不静默按已扣费跳过）', async (_name, over) => {
      prisma.generationIntent.findUnique.mockResolvedValue(row({ status: 'RUNNING', jobId: 'job-1' }));

      await expect(service.claim(input(over))).rejects.toBeInstanceOf(IntentContextMismatchError);
      await expect(service.claim(input(over))).rejects.toMatchObject({
        errorCode: 'INTENT_CONTEXT_MISMATCH',
        status: HttpStatus.CONFLICT,
      });
    });
  });

  describe('⑧ createMany 撞 active partial unique（同节点异 intentId 在飞）→ count=0 → NodeBusy', () => {
    it('count=0 且本 intentId 无行（again=null）→ NODE_BUSY（Z33：健康事务内分义非 25P02）', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null); // 本 intentId 无行（异 intentId 才是在飞方）
      prisma.generationIntent.createMany.mockResolvedValue({ count: 0 }); // ON CONFLICT DO NOTHING 吞撞

      await expect(service.claim(input({ intentId: 'i2' }))).rejects.toMatchObject({ errorCode: 'NODE_BUSY' });
    });
  });

  describe('⑨ createMany count=0 路径：同上下文异 jobId（并发同 intentId 超时重发）→ NodeBusy 非 mismatch', () => {
    it('撞复合唯一 + again 行 RUNNING 异 jobId → NODE_BUSY（mismatch 标签对在飞请求是误导）', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null) // 首查无行 → 走 createMany
        .mockResolvedValueOnce(row({ status: 'RUNNING', jobId: 'job-first' })); // count=0 后复查=并发赢家
      prisma.generationIntent.createMany.mockResolvedValue({ count: 0 });

      let err: any;
      try {
        await service.claim(input({ jobId: 'job-second' }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(NodeBusyError);
      expect(err).not.toBeInstanceOf(IntentContextMismatchError);
    });

    it('count=0 路径同 jobId 同 RUNNING → 可重入（create 与重入并发）', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ status: 'RUNNING', jobId: 'job-1' }));
      prisma.generationIntent.createMany.mockResolvedValue({ count: 0 });

      const r = await service.claim(input({ jobId: 'job-1' }));
      expect(r.created).toBe(true);
    });

    it('count=0 路径 again 行异上下文 → INTENT_CONTEXT_MISMATCH', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ status: 'RUNNING', nodeId: 'n2' }));
      prisma.generationIntent.createMany.mockResolvedValue({ count: 0 });

      await expect(service.claim(input({ jobId: 'job-1' }))).rejects.toMatchObject({
        errorCode: 'INTENT_CONTEXT_MISMATCH',
      });
    });
  });

  describe('complete/fail 幂等迁移（where ACTIVE 守卫）', () => {
    it('complete：RUNNING 行 → SUCCEEDED 返回 count=1', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.complete('gi-1', 'media-9');

      expect(count).toBe(1);
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: { status: 'SUCCEEDED', resultRef: 'media-9', completedAt: expect.any(Date) },
      });
    });

    it('complete 幂等：行已 SUCCEEDED（被 VOIDED/已完成）→ where 零匹配 count=0', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      // 真库语义：where status in ACTIVE 对终态行匹配零行——mock 直接以 count=0 表达
      const count = await service.complete('gi-1', 'media-9');
      expect(count).toBe(0);
    });

    it('fail：RUNNING 行 → FAILED 且 error 截断 500', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      const longError = 'x'.repeat(600);

      await service.fail('gi-1', longError);

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: { status: 'FAILED', error: 'x'.repeat(500), completedAt: expect.any(Date) },
      });
    });

    it('Y0b-1（Z27）：fail 带 jobId → where 补 jobId 限定（迟到钩子不误杀 rearm 换 job 的新活意图）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });

      await service.fail('gi-1', 'late hook', 'job-old');

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] }, jobId: 'job-old' },
        data: { status: 'FAILED', error: 'late hook', completedAt: expect.any(Date) },
      });
    });

    it('Y0b-1（N4）：findByActiveNode 反查 RUNNING 行——projectId/nodeId/jobId 三键', async () => {
      prisma.generationIntent.findFirst.mockResolvedValue(row());

      const r = await service.findByActiveNode('p1', 'n1', 'job-1');

      expect(r).toEqual(row());
      expect(prisma.generationIntent.findFirst).toHaveBeenCalledWith({
        where: { projectId: 'p1', nodeId: 'n1', status: 'RUNNING', jobId: 'job-1' },
      });
    });

    it('fail 幂等：终态行再 fail → where ACTIVE 零匹配（updateMany 守卫即幂等）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      await service.fail('gi-1', 'boom');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: expect.objectContaining({ status: 'FAILED' }),
      });
    });

    it('批0.5-9 void_：RUNNING 行 → VOIDED 且 error 截断 500（reserve 失败——零扣费终态，重试照常扣费）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 1 });
      const longError = 'x'.repeat(600);

      await service.void_('gi-1', longError);

      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: { status: 'VOIDED', error: 'x'.repeat(500), completedAt: expect.any(Date) },
      });
    });

    it('批0.5-9 void_ 幂等：终态行再 void → where ACTIVE 零匹配', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      await service.void_('gi-1', 'boom');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: expect.objectContaining({ status: 'VOIDED' }),
      });
    });
  });

  describe('attachJob/listByNode 冒烟', () => {
    it('attachJob → update 回写 jobId（reconcile A 路径前提）', async () => {
      prisma.generationIntent.update.mockResolvedValue(row({ jobId: 'job-1' }));

      await service.attachJob('gi-1', 'job-1');

      expect(prisma.generationIntent.update).toHaveBeenCalledWith({
        where: { id: 'gi-1' },
        data: { jobId: 'job-1' },
      });
    });

    it('listByNode → take 20 + 投影 select', async () => {
      const list = [row()];
      prisma.generationIntent.findMany.mockResolvedValue(list);

      const r = await service.listByNode('p1', 'n1');

      expect(r).toBe(list);
      expect(prisma.generationIntent.findMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', nodeId: 'n1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, intentId: true, kind: true, status: true, resultRef: true,
          error: true, creditsConsumed: true, createdAt: true, completedAt: true,
        },
      });
    });
  });
});
