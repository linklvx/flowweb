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
  intentId: 'i1',
  kind: 'image',
  paramsHash: 'h1',
  status: 'RUNNING',
  jobId: null,
  creditsConsumed: 0,
  attempts: 1,
  resultRef: null,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  ...over,
});

/** claim 输入（默认与 row 同上下文） */
const input = (over: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  nodeId: 'n1',
  userId: 'u1',
  intentId: 'i1',
  kind: 'image',
  paramsHash: 'h1',
  ...over,
});

/** Prisma P2002（唯一约束冲突）错误 */
const p2002 = (target: unknown) => {
  const err: any = new Error('Unique constraint failed');
  err.code = 'P2002';
  err.meta = { target };
  return err;
};

describe('GenerationIntentService claim 状态机（F13）', () => {
  let service: GenerationIntentService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      generationIntent: {
        findUnique: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GenerationIntentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(GenerationIntentService);
  });

  describe('① 无行 → create RUNNING = 新执行权', () => {
    it('findUnique 空 → create RUNNING → created:true', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      const created = row({ id: 'gi-new' });
      prisma.generationIntent.create.mockResolvedValue(created);

      const r = await service.claim(input());

      expect(r.created).toBe(true);
      expect(r.intent).toBe(created);
      expect(prisma.generationIntent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'p1', nodeId: 'n1', userId: 'u1', intentId: 'i1',
          kind: 'image', paramsHash: 'h1', jobId: null, status: 'RUNNING',
        }),
      });
    });

    it('带 jobId → create data 写入 jobId', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null);
      prisma.generationIntent.create.mockResolvedValue(row({ jobId: 'job-9' }));

      await service.claim(input({ jobId: 'job-9' }));

      expect(prisma.generationIntent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ jobId: 'job-9', status: 'RUNNING' }),
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

  describe('⑧ create P2002 撞 partial unique（同节点异 intentId 在飞）→ NodeBusy', () => {
    it('真库实测形态 meta.target=null 且本 intentId 无行 → 约束排除 NODE_BUSY', async () => {
      prisma.generationIntent.findUnique.mockResolvedValue(null); // 本 intentId 无行（异 intentId 才是在飞方）
      prisma.generationIntent.create.mockRejectedValue(p2002(null)); // int 实测：target 恒 null（partial/复合唯一皆然）

      await expect(service.claim(input({ intentId: 'i2' }))).rejects.toMatchObject({ errorCode: 'NODE_BUSY' });
    });
  });

  describe('⑨ P2002 catch 路径：同上下文异 jobId（并发同 intentId 超时重发）→ NodeBusy 非 mismatch', () => {
    it('撞复合唯一 + again 行 RUNNING 异 jobId → NODE_BUSY（mismatch 标签对在飞请求是误导）', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null) // 首查无行 → 走 create
        .mockResolvedValueOnce(row({ status: 'RUNNING', jobId: 'job-first' })); // catch 后复查=并发赢家
      prisma.generationIntent.create.mockRejectedValue(p2002(null)); // int 实测：target 恒 null

      let err: any;
      try {
        await service.claim(input({ jobId: 'job-second' }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(NodeBusyError);
      expect(err).not.toBeInstanceOf(IntentContextMismatchError);
    });

    it('P2002 catch 路径同 jobId 同 RUNNING → 可重入（create 与重入并发）', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ status: 'RUNNING', jobId: 'job-1' }));
      prisma.generationIntent.create.mockRejectedValue(p2002(null)); // int 实测：target 恒 null

      const r = await service.claim(input({ jobId: 'job-1' }));
      expect(r.created).toBe(true);
    });

    it('P2002 catch 路径 again 行异上下文 → INTENT_CONTEXT_MISMATCH', async () => {
      prisma.generationIntent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ status: 'RUNNING', nodeId: 'n2' }));
      prisma.generationIntent.create.mockRejectedValue(p2002(null)); // int 实测：target 恒 null

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

    it('fail 幂等：终态行再 fail → where ACTIVE 零匹配（updateMany 守卫即幂等）', async () => {
      prisma.generationIntent.updateMany.mockResolvedValue({ count: 0 });
      await service.fail('gi-1', 'boom');
      expect(prisma.generationIntent.updateMany).toHaveBeenCalledWith({
        where: { id: 'gi-1', status: { in: ['RUNNING'] } },
        data: expect.objectContaining({ status: 'FAILED' }),
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
