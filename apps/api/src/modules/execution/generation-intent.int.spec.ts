import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerationIntentService,
  NodeBusyError,
  IntentContextMismatchError,
} from './generation-intent.service';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
// 本地真库可能有开发数据——全部测试行收拢到专属 projectId，清理只删该前缀
const PID = 'int-gi-053';

const svc = new GenerationIntentService(prisma as unknown as PrismaService);

const input = (over: Record<string, unknown> = {}) => ({
  projectId: PID,
  nodeId: 'n1',
  userId: 'u1',
  intentId: 'i1',
  kind: 'image',
  paramsHash: 'h1',
  ...over,
});

(hasDb ? describe : describe.skip)('GenerationIntent 真库并发行为（int）', () => {
  afterAll(async () => {
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await prisma.$disconnect();
  });

  it('同节点两个不同 intentId → 第二个撞活跃 partial unique：P2002 meta.target 实测形态 + NodeBusy', async () => {
    // 先占住 n-meta 节点的活跃槽
    await svc.claim(input({ intentId: 'i-meta-a', nodeId: 'n-meta' }));

    // 直接裸 create 复现 P2002——绕过 service catch，捕获 meta.target 原始形态（关键产出）
    let raw: any;
    try {
      await prisma.generationIntent.create({
        data: { projectId: PID, nodeId: 'n-meta', userId: 'u1', intentId: 'i-meta-b', kind: 'image', paramsHash: 'h1' },
      });
      expect.unreachable('应撞活跃 partial unique');
    } catch (e: any) {
      expect(e.code).toBe('P2002');
      raw = e;
    }
    // 实测形态原文（字符串 or 数组——service 等值分义以此为准）
    console.log('[int] P2002 meta.target 实测形态:', JSON.stringify(raw.meta?.target), '| typeof:', typeof raw.meta?.target);

    // service 分义路径：异 intentId claim → NodeBusy（非原始 P2002 透传）
    await expect(svc.claim(input({ intentId: 'i-meta-c', nodeId: 'n-meta' }))).rejects.toBeInstanceOf(NodeBusyError);
  });

  it('同 intentId 异参数第二次 claim → INTENT_CONTEXT_MISMATCH（真库复合唯一命中路径）', async () => {
    await svc.claim(input({ intentId: 'i-ctx', nodeId: 'n-ctx', paramsHash: 'h1' }));

    await expect(
      svc.claim(input({ intentId: 'i-ctx', nodeId: 'n-ctx', paramsHash: 'h2' })),
    ).rejects.toBeInstanceOf(IntentContextMismatchError);
  });

  it('真库 rearm 原子性：FAILED 行并发双 claim → 恰一个 created:true 一个 NodeBusy，attempts 只 +1', async () => {
    const first = await svc.claim(input({ intentId: 'i-rearm', nodeId: 'n-rearm' }));
    expect(first.created).toBe(true);
    await svc.fail(first.intent.id, 'boom');

    const results = await Promise.allSettled([
      svc.claim(input({ intentId: 'i-rearm', nodeId: 'n-rearm', jobId: 'job-a' })),
      svc.claim(input({ intentId: 'i-rearm', nodeId: 'n-rearm', jobId: 'job-b' })),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.created === true);
    const busy = results.filter((r) => r.status === 'rejected' && r.reason instanceof NodeBusyError);
    expect(ok.length).toBe(1);
    expect(busy.length).toBe(1);

    const after = await prisma.generationIntent.findUnique({
      where: { projectId_intentId: { projectId: PID, intentId: 'i-rearm' } },
    });
    expect(after?.status).toBe('RUNNING');
    expect(after?.attempts).toBe(2); // 双并发只赢一次——守卫式 updateMany 原子性
  });
});
