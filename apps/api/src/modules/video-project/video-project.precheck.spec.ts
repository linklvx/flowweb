// apps/api/src/modules/video-project/video-project.precheck.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoProjectService } from './video-project.service';

const mkPrisma = (over: any = {}) => ({
  videoProject: { findUnique: vi.fn() },
  canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) }, // teamId 派生查询（与 register 同款）
  media: { create: vi.fn() },
  ...over,
});
const perm = { assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
const collab = { readCanvas: vi.fn() };
const execution = { execute: vi.fn() };
const quota = { assertCanUpload: vi.fn() }; // 第 5 参——exportPrecheck 配额预检

describe('exportPrecheck（导出配额预检）', () => {
  let svc: VideoProjectService; let prisma: any;
  beforeEach(() => {
    prisma = mkPrisma();
    perm.assertEditor.mockResolvedValue('PROJECT_EDITOR');
    quota.assertCanUpload.mockResolvedValue(undefined);
    svc = new VideoProjectService(prisma, perm as any, collab as any, execution as any, quota as any);
  });

  it('配额充足 → { ok: true }，不建任何 Media', async () => {
    const r = await svc.exportPrecheck('u1', { workflowId: 'w1', estimatedSize: 1024 });
    expect(r).toEqual({ ok: true });
    expect(prisma.media.create).not.toHaveBeenCalled(); // 预检只读——Media 落库留给 register
    expect(quota.assertCanUpload).toHaveBeenCalledWith('t1', 1024); // teamId 服务端从 workflowId 派生
  });

  it('配额不足 → 抛原异常（HTTP 层转 4xx）', async () => {
    quota.assertCanUpload.mockRejectedValue(new Error('存储配额不足'));
    await expect(svc.exportPrecheck('u1', { workflowId: 'w1', estimatedSize: 1024 })).rejects.toThrow('存储配额不足');
  });

  it('先鉴权再查库（assertEditor 在 findUnique 之前调用）', async () => {
    await svc.exportPrecheck('u1', { workflowId: 'w1', estimatedSize: 1 });
    const ordPerm = perm.assertEditor.mock.invocationCallOrder[0];
    const ordFind = prisma.canvasProject.findUnique.mock.invocationCallOrder[0];
    expect(ordPerm).toBeLessThan(ordFind); // 防未授权存在性探测
  });

  it('工程不存在 → NotFoundException（鉴权通过后）', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(svc.exportPrecheck('u1', { workflowId: 'w1', estimatedSize: 1 })).rejects.toThrow('画布不存在');
  });
});
