// apps/api/src/modules/video-project/video-project.service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';

const mkPrisma = (over: any = {}) => ({
  videoProject: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...over,
  },
  canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) }, // teamId 派生查询
});
const perm = { assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR') };
const collab = { readCanvas: vi.fn() };
const execution = { execute: vi.fn() }; // 第 4 参——Task 11 regenerate 用，签名一次到位（避免中途改构造器）

describe('VideoProjectService', () => {
  let svc: VideoProjectService; let prisma: any;
  beforeEach(() => {
    prisma = mkPrisma();
    svc = new VideoProjectService(prisma, perm as any, collab as any, execution as any);
  });

  it('upsertByNode 幂等：并发双调用只产生一条记录 + teamId 服务端派生', async () => {
    prisma.videoProject.upsert.mockResolvedValue({ id: 'p1', sourceNodeId: 'n1', data: { version: 1 } });
    const r = await svc.upsertByNode({ workflowId: 'w1', sourceNodeId: 'n1', userId: 'u1', title: 'x' });
    expect(prisma.videoProject.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.videoProject.upsert.mock.calls[0][0].where).toEqual({ sourceNodeId: 'n1' });
    expect(prisma.videoProject.upsert.mock.calls[0][0].create).toMatchObject({ teamId: 't1' }); // 派生值（勿信客户端——assertEditor 只验 workflow 编辑权不验 teamId 归属）
    expect(r.id).toBe('p1');
  });

  it('upsertByNode 缺省 data 用 shared 默认工程（4 轨——Plan 2 浏览器验收发现原字面量 tracks:[] 脱节）', async () => {
    prisma.videoProject.upsert.mockResolvedValue({ id: 'p1' });
    await svc.upsertByNode({ workflowId: 'w1', sourceNodeId: 'n1', userId: 'u1', title: 'x' });
    const created = prisma.videoProject.upsert.mock.calls[0][0].create;
    expect(created.data.version).toBe(1);
    expect(created.data.tracks).toHaveLength(4); // 1 video + 1 subtitle + 2 audio
    expect(created.data.tracks.map((t: any) => t.type)).toEqual(['video', 'subtitle', 'audio', 'audio']);
  });

  it('upsertByNode 归属校验：sourceNodeId 已属于其他画布 → 403 不返回数据', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p9', workflowId: 'other-workflow' });
    await expect(svc.upsertByNode({ workflowId: 'w1', sourceNodeId: 'n1', userId: 'u1', title: 'x' }))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.videoProject.upsert).not.toHaveBeenCalled();
  });

  it('patch 乐观锁：updatedAt 不匹配抛 409', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1', updatedAt: new Date('2026-09-10T01:00:00Z') });
    await expect(svc.patch('p1', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T00:00:00Z' }))
      .rejects.toThrow(ConflictException);
    expect(perm.assertEditor).toHaveBeenCalledWith('w1', 'u1'); // 权限先于时戳比对
    expect(prisma.videoProject.update).not.toHaveBeenCalled();
  });

  it('patch 成功返回新 updatedAt 供前端回填', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1', updatedAt: new Date('2026-09-10T01:00:00Z') });
    prisma.videoProject.update.mockResolvedValue({ id: 'p1', updatedAt: new Date('2026-09-10T02:00:00Z') });
    const r = await svc.patch('p1', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T01:00:00Z' });
    expect(perm.assertEditor).toHaveBeenCalledWith('w1', 'u1');
    expect(prisma.videoProject.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { data: {} } });
    expect(r.updatedAt).toEqual(new Date('2026-09-10T02:00:00Z'));
  });

  it('patch 记录不存在 → 404', async () => {
    prisma.videoProject.findUnique.mockResolvedValue(null);
    await expect(svc.patch('p404', 'u1', { data: {}, baseUpdatedAt: '2026-09-10T00:00:00Z' }))
      .rejects.toThrow(NotFoundException);
    expect(prisma.videoProject.update).not.toHaveBeenCalled();
  });

  it('deleteByNode 记录不存在静默返回', async () => {
    prisma.videoProject.findUnique.mockResolvedValue(null);
    await svc.deleteByNode('n404', 'u1');
    expect(prisma.videoProject.delete).not.toHaveBeenCalled();
  });

  it('deleteByNode 仅删记录不级联 Media', async () => {
    prisma.videoProject.findUnique.mockResolvedValue({ id: 'p1', workflowId: 'w1' });
    await svc.deleteByNode('n1', 'u1');
    expect(prisma.videoProject.delete).toHaveBeenCalledWith({ where: { sourceNodeId: 'n1' } });
  });
});
