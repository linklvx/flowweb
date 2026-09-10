// apps/api/src/modules/video-project/video-project.regenerate.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { VideoProjectService } from './video-project.service';

describe('regenerate（A1 影子节点）', () => {
  let svc: VideoProjectService; let prisma: any; let collab: any; let execution: any;
  const perm = { assertEditor: vi.fn().mockResolvedValue('E') };

  beforeEach(() => {
    prisma = { videoProject: { findUnique: vi.fn() } };
    collab = { readCanvas: vi.fn(), insertNode: vi.fn(), removeNode: vi.fn() };
    execution = { execute: vi.fn().mockResolvedValue({ success: true }) };
    svc = new VideoProjectService(prisma, perm as any, collab as any, execution as any); // 构造器 4 参（Task 6 已一次到位）
  });

  it('源节点存在且为生成类型：克隆影子→直调 execute（不带 sv）→返回 shadowNodeId', async () => {
    collab.readCanvas.mockResolvedValue({
      nodes: [{ id: 'src1', type: 'videoGen', position: { x: 1, y: 2 }, data: { model: 'm', prompt: { text: 't' } } }],
      edges: [],
    });
    const r = await svc.regenerate('u1', { sourceNodeId: 'src1', workflowId: 'w1', kind: 'video' });
    expect(collab.insertNode).toHaveBeenCalledWith('w1', expect.objectContaining({
      id: expect.stringContaining('shadow-'),
      type: 'videoGen',
      data: expect.objectContaining({ __ephemeral: true, model: 'm' }), // JSON 整份深拷
    }));
    expect(execution.execute).toHaveBeenCalledWith('w1', expect.any(String), 'u1'); // 可选参不钉死为契约
    expect(r.shadowNodeId).toBeTruthy();
  });

  it('源节点类型不匹配：400（video/audio 两分支显式传 kind——防"缺省 kind 因错误原因通过"）', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [{ id: 'x', type: 'videoEdit', data: {} }], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'video' })).rejects.toThrow(BadRequestException);
    await expect(svc.regenerate('u1', { sourceNodeId: 'x', workflowId: 'w1', kind: 'audio' })).rejects.toThrow(BadRequestException);
  });
  it('源节点不存在：400', async () => {
    collab.readCanvas.mockResolvedValue({ nodes: [], edges: [] });
    await expect(svc.regenerate('u1', { sourceNodeId: 'nope', workflowId: 'w1', kind: 'video' })).rejects.toThrow(BadRequestException);
  });
});
