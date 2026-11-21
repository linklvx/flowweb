// apps/api/src/modules/collab/lifecycle-obligation.sweeper.spec.ts
// Y4a T8（spec §0 条 9）：VideoProject 表整删——NODE_DELETED 义务的 VideoProject 级联臂随表消失。
// 红相：mock prisma 带 videoProject deleteMany spy——修前 sweeper ③臂照调（红）；修后零调用（绿）。
// 留存臂行为锚：ArtifactProjection 置 orphaned+MediaBinding reconcile 入队两臂仍在。
import { describe, it, expect, vi } from 'vitest';
import { LifecycleObligationSweeper } from './lifecycle-obligation.sweeper';

function mkSweeper() {
  const prisma: any = {
    artifactProjection: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    videoProject: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    lifecycleObligation: {
      findUnique: vi.fn().mockResolvedValue({ state: 'DONE', attempts: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    $queryRaw: vi.fn(),
  };
  const feed: any = { appendEvent: vi.fn(), notifyProject: vi.fn() };
  const reconciler = { requestReconcile: vi.fn() };
  const sweeper = new LifecycleObligationSweeper(prisma, feed, reconciler as never);
  return { prisma, feed, reconciler, sweeper };
}

describe('LifecycleObligationSweeper NODE_DELETED（Y4a T8：VideoProject 级联臂随表删）', () => {
  it('NODE_DELETED 处理后 prisma.videoProject 零调用（mock spy——表已整删）', async () => {
    const { prisma, reconciler, sweeper } = mkSweeper();
    const ok = await (sweeper as unknown as { executeNodeDeletedCleanup: (pid: string, nodeId: string) => Promise<boolean> })
      .executeNodeDeletedCleanup('p1', 'n1');
    expect(ok).toBe(true);
    expect(prisma.videoProject.deleteMany).not.toHaveBeenCalled();   // ③级联臂已随表消失
    expect(prisma.artifactProjection.updateMany).toHaveBeenCalledWith({   // ②投影拦截臂留存
      where: { projectId: 'p1', nodeId: 'n1', state: { in: ['pending', 'projecting'] } },
      data: { state: 'orphaned', lastError: 'node-deleted:obligation-sweep' },
    });
    expect(reconciler.requestReconcile).toHaveBeenCalledWith('p1');   // ①MediaBinding 入队臂留存
  });
});
